use std::sync::Arc;

use actix_web::{http::StatusCode, web, HttpRequest, HttpResponse};
use serde::Deserialize;

use super::models::DEFAULT_LAYER;
use crate::AppState;

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct ForecastQuery {
    /// Latitude of the map centre.
    pub lat: f64,
    /// Longitude of the map centre.
    pub lon: f64,
    /// Forecast horizon in hours (default 12, max 24).
    pub hours: Option<u32>,
}

#[utoipa::path(
    get,
    path = "/api/radar/forecast",
    params(ForecastQuery),
    responses(
        (status = 200, description = "Gridded precipitation forecast", body = super::models::PrecipForecast),
        (status = 502, description = "Failed to fetch or decode forecast")
    )
)]
pub async fn forecast(
    state: web::Data<Arc<AppState>>,
    query: web::Query<ForecastQuery>,
) -> HttpResponse {
    let hours = query.hours.unwrap_or(12).clamp(1, 24);
    // Round the location into the cache key so small map nudges reuse the grid.
    let key = format!("{:.2},{:.2}:{hours}", query.lat, query.lon);

    if let Some(cached) = state.precip_forecast_cache.get(&key).await {
        return HttpResponse::Ok().json(cached);
    }

    match super::forecast::fetch_forecast(
        &state.http_client,
        &state.settings.fmi_download_base_url,
        query.lat,
        query.lon,
        hours,
    )
    .await
    {
        Ok(forecast) => {
            state.precip_forecast_cache.set(key, forecast.clone()).await;
            HttpResponse::Ok().json(forecast)
        }
        Err(e) => {
            tracing::error!("Failed to fetch precip forecast: {e}");
            if let Some(stale) = state.precip_forecast_cache.get_stale(&key).await {
                HttpResponse::Ok().json(stale)
            } else {
                HttpResponse::BadGateway()
                    .json(serde_json::json!({"error": "No forecast available"}))
            }
        }
    }
}

#[derive(Debug, Deserialize, utoipa::IntoParams)]
pub struct FramesQuery {
    /// WMS layer to animate (defaults to the nationwide reflectivity composite).
    pub layer: Option<String>,
    /// Number of frames to return (default 12, max 48).
    pub count: Option<u32>,
}

#[utoipa::path(
    get,
    path = "/api/radar/frames",
    params(FramesQuery),
    responses(
        (status = 200, description = "Radar animation frame timestamps", body = super::models::RadarFrames),
        (status = 502, description = "Failed to fetch radar capabilities")
    )
)]
pub async fn frames(
    state: web::Data<Arc<AppState>>,
    query: web::Query<FramesQuery>,
) -> HttpResponse {
    let layer = query.layer.as_deref().unwrap_or(DEFAULT_LAYER).to_string();
    let count = query.count.unwrap_or(12).clamp(1, 48);
    let key = format!("{layer}:{count}");

    if let Some(cached) = state.radar_frames_cache.get(&key).await {
        return HttpResponse::Ok().json(cached);
    }

    match super::client::fetch_frames(
        &state.http_client,
        &state.settings.fmi_wms_base_url,
        &layer,
        count,
    )
    .await
    {
        Ok(frames) => {
            state.radar_frames_cache.set(key, frames.clone()).await;
            HttpResponse::Ok().json(frames)
        }
        Err(e) => {
            tracing::error!("Failed to fetch radar frames: {e}");
            if let Some(stale) = state.radar_frames_cache.get_stale(&key).await {
                HttpResponse::Ok().json(stale)
            } else {
                HttpResponse::BadGateway()
                    .json(serde_json::json!({"error": "No radar frames available"}))
            }
        }
    }
}

/// Transparent proxy for FMI WMS `GetMap` tiles. The frontend's Leaflet WMS
/// layer points here; we forward the query string verbatim to a single fixed
/// upstream (no open proxy) and stream the image bytes back. Tiles are cached
/// by the browser/Leaflet, so no server-side tile cache is needed.
///
/// The frontend hands FMI its own colour map through `SLD_BODY` so the observed
/// and forecast halves of the timeline share one ramp. If FMI ever rejects that —
/// dynamic styling turned off, or a colour map it dislikes — we retry once
/// without it: the radar then renders in FMI's palette, which is worse than
/// halo's but far better than an empty map.
pub async fn wms(state: web::Data<Arc<AppState>>, req: HttpRequest) -> HttpResponse {
    let query = req.query_string();
    if let Some(tile) = fetch_tile(&state, query).await {
        return tile;
    }
    if let Some(plain) = without_sld_body(query) {
        tracing::warn!("radar tile rejected with SLD_BODY; retrying with FMI's own style");
        if let Some(tile) = fetch_tile(&state, &plain).await {
            return tile;
        }
    }
    HttpResponse::BadGateway().finish()
}

/// `Some` only when the upstream really returned an image. A WMS `ServiceException`
/// arrives as XML — sometimes with a 200 — so the content type is what decides.
async fn fetch_tile(state: &AppState, query: &str) -> Option<HttpResponse> {
    let url = format!("{}?{}", state.settings.fmi_wms_base_url, query);
    let resp = match state.http_client.get(&url).send().await {
        Ok(resp) => resp,
        Err(e) => {
            tracing::error!("Failed to proxy radar tile: {e}");
            return None;
        }
    };
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/png")
        .to_string();
    if !status.is_success() || !content_type.starts_with("image/") {
        tracing::error!("radar tile upstream returned {status} ({content_type})");
        return None;
    }
    match resp.bytes().await {
        Ok(bytes) => Some(
            HttpResponse::build(status)
                .insert_header(("Cache-Control", "public, max-age=300"))
                .content_type(content_type)
                .body(bytes),
        ),
        Err(e) => {
            tracing::error!("Failed to read radar tile body: {e}");
            None
        }
    }
}

/// Strip `sld_body`/`sld` from a query string. `None` when neither was there —
/// i.e. there is nothing to retry differently.
fn without_sld_body(query: &str) -> Option<String> {
    let mut stripped = false;
    let kept: Vec<&str> = query
        .split('&')
        .filter(|pair| {
            let key = pair.split('=').next().unwrap_or_default();
            let drop = key.eq_ignore_ascii_case("sld_body") || key.eq_ignore_ascii_case("sld");
            stripped |= drop;
            !drop
        })
        .collect();
    stripped.then(|| kept.join("&"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn without_sld_body_drops_only_the_style_param() {
        assert_eq!(
            without_sld_body("layers=Radar:x&SLD_BODY=%3Csld%2F%3E&time=now").as_deref(),
            Some("layers=Radar:x&time=now"),
        );
    }

    #[test]
    fn without_sld_body_is_none_when_unstyled() {
        assert_eq!(without_sld_body("layers=Radar:x&time=now"), None);
    }
}
