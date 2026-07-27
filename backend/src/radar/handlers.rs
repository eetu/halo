use std::{sync::Arc, time::Duration};

use actix_web::{http::StatusCode, web, HttpRequest, HttpResponse};
use chrono::{DateTime, Utc};
use serde::Deserialize;

use super::models::{PrecipForecast, DEFAULT_LAYER};
use crate::AppState;

/// Upper bound on the forecast we will fall back to when FMI is unreachable.
/// Frames are dropped individually as they age out (see [`future_frames`]), so
/// this is only a backstop against handing out a grid whose remaining frames
/// come from a model run too old to trust.
const FORECAST_MAX_STALE: Duration = Duration::from_secs(3 * 3600);

/// Frame timestamps go straight into the WMS `time` dimension, and FMI keeps
/// only a short window of radar composites online — an older list would just
/// render as empty tiles.
const FRAMES_MAX_STALE: Duration = Duration::from_secs(3600);

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
    let now = Utc::now();

    // Every exit trims against the *current* clock, and the cache keeps the
    // untrimmed grid — the same entry is served to a request an hour later
    // minus one more frame, rather than being frozen at whatever "future"
    // meant when it was fetched.
    if let Some(cached) = state.precip_forecast_cache.get(&key).await {
        if let Some(fresh) = future_frames(cached, now) {
            return HttpResponse::Ok().json(fresh);
        }
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
            match future_frames(forecast, now) {
                Some(fresh) => HttpResponse::Ok().json(fresh),
                None => no_forecast(),
            }
        }
        Err(e) => {
            tracing::error!("Failed to fetch precip forecast: {e}");
            match state
                .precip_forecast_cache
                .get_stale(&key, FORECAST_MAX_STALE)
                .await
                .and_then(|stale| future_frames(stale, now))
            {
                Some(stale) => {
                    tracing::warn!("Returning stale precip forecast");
                    HttpResponse::Ok().json(stale)
                }
                None => no_forecast(),
            }
        }
    }
}

fn no_forecast() -> HttpResponse {
    HttpResponse::BadGateway().json(serde_json::json!({"error": "No forecast available"}))
}

/// Keep only the frames whose valid time is still ahead.
///
/// Frames carry absolute times, so a cached grid ages out frame by frame rather
/// than all at once: at 22:30 a 20:00 model run is still a real forecast for
/// 23:00 onward. Without this, a cache entry that outlives its own horizon —
/// which is exactly what happens when FMI is down overnight — gets rendered as
/// "+1 h … +12 h" and shows last night's rain as tomorrow's.
///
/// `None` when nothing is left, so the caller can 502 instead of shipping an
/// empty timeline.
fn future_frames(mut fc: PrecipForecast, now: DateTime<Utc>) -> Option<PrecipForecast> {
    // An unparseable time is kept: it would mean the format changed and this
    // was not updated, and silently emptying the forecast is the worse failure.
    fc.frames
        .retain(|f| match DateTime::parse_from_rfc3339(&f.time) {
            Ok(t) => t.with_timezone(&Utc) > now,
            Err(_) => true,
        });
    (!fc.frames.is_empty()).then_some(fc)
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
            if let Some(stale) = state
                .radar_frames_cache
                .get_stale(&key, FRAMES_MAX_STALE)
                .await
            {
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
    use crate::radar::models::ForecastFrame;

    fn forecast(times: &[&str]) -> PrecipForecast {
        PrecipForecast {
            bbox: [59.0, 22.0, 61.0, 26.0],
            cols: 1,
            rows: 1,
            unit: "mm/h".into(),
            frames: times
                .iter()
                .map(|t| ForecastFrame {
                    time: (*t).into(),
                    max: 1.0,
                    values: vec![1.0],
                })
                .collect(),
        }
    }

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn future_frames_keeps_an_all_future_forecast_intact() {
        let fc = forecast(&["2026-06-22T19:00:00Z", "2026-06-22T20:00:00Z"]);
        let kept = future_frames(fc, at("2026-06-22T18:10:00Z")).unwrap();
        assert_eq!(kept.frames.len(), 2);
    }

    /// The overnight case: an evening model run reached from the morning has
    /// nothing left to say, and must not be served as "+1 h".
    #[test]
    fn future_frames_rejects_a_wholly_elapsed_forecast() {
        let fc = forecast(&["2026-06-22T19:00:00Z", "2026-06-22T20:00:00Z"]);
        assert!(future_frames(fc, at("2026-06-23T07:00:00Z")).is_none());
    }

    #[test]
    fn future_frames_drops_only_the_elapsed_head() {
        let fc = forecast(&[
            "2026-06-22T19:00:00Z",
            "2026-06-22T20:00:00Z",
            "2026-06-22T21:00:00Z",
        ]);
        let kept = future_frames(fc, at("2026-06-22T20:30:00Z")).unwrap();
        assert_eq!(
            kept.frames
                .iter()
                .map(|f| f.time.as_str())
                .collect::<Vec<_>>(),
            ["2026-06-22T21:00:00Z"],
        );
    }

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
