use std::sync::Arc;

use actix_web::{web, HttpResponse};
use serde::Deserialize;

use super::fmi::converter::FmiConverter;
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct LocationQuery {
    pub lat: String,
    pub lon: String,
}

fn cache_key(lat: &str, lon: &str) -> String {
    format!("{lat},{lon}")
}

// ---- FMI ----

#[utoipa::path(
    get,
    path = "/api/weather/fmi",
    params(
        ("lat" = String, Query, description = "Latitude"),
        ("lon" = String, Query, description = "Longitude"),
    ),
    responses(
        (status = 200, description = "Weather data from FMI"),
        (status = 502, description = "Failed to fetch weather data")
    )
)]
pub async fn fmi(
    state: web::Data<Arc<AppState>>,
    query: web::Query<LocationQuery>,
) -> HttpResponse {
    let settings = &state.settings;
    let key = cache_key(&query.lat, &query.lon);

    if let Some(cached) = state.weather_cache.get(&key).await {
        tracing::debug!("Returning cached FMI weather data");
        return HttpResponse::Ok().json(cached);
    }

    match super::fmi::client::fetch_all(
        &state.http_client,
        &settings.fmi_base_url,
        &query.lat,
        &query.lon,
    )
    .await
    {
        Ok(fmi_data) => {
            let lat: f64 = query.lat.parse().expect("lat must be a valid number");
            let lon: f64 = query.lon.parse().expect("lon must be a valid number");
            let converter = FmiConverter;
            let response = converter.convert(&fmi_data, lat, lon);
            state.weather_cache.set(key, response.clone()).await;
            HttpResponse::Ok().json(response)
        }
        Err(e) => {
            tracing::error!("Failed to fetch FMI weather data: {e}");
            fmi_fallback_or_error(&state, &key).await
        }
    }
}

async fn fmi_fallback_or_error(state: &AppState, key: &str) -> HttpResponse {
    if let Some(stale) = state.weather_cache.get_stale(key).await {
        tracing::warn!("Returning stale cached weather data");
        HttpResponse::Ok().json(stale)
    } else {
        HttpResponse::BadGateway().json(serde_json::json!({"error": "No cached data available"}))
    }
}

// ---- Tomorrow.io ----

#[utoipa::path(
    get,
    path = "/api/weather/tomorrow",
    params(
        ("lat" = String, Query, description = "Latitude"),
        ("lon" = String, Query, description = "Longitude"),
    ),
    responses(
        (status = 200, description = "Tomorrow.io weather data"),
        (status = 502, description = "Failed to fetch weather data")
    )
)]
pub async fn tomorrow(
    state: web::Data<Arc<AppState>>,
    query: web::Query<LocationQuery>,
) -> HttpResponse {
    let key = cache_key(&query.lat, &query.lon);

    if let Some(cached) = state.tomorrow_cache.get(&key).await {
        tracing::debug!("Returning cached Tomorrow.io weather data");
        return HttpResponse::Ok().json(cached);
    }

    match super::tomorrow::client::fetch(&state, &query.lat, &query.lon).await {
        Ok(data) => {
            state.tomorrow_cache.set(key, data.clone()).await;
            HttpResponse::Ok().json(data)
        }
        Err(e) => {
            tracing::error!("Failed to fetch Tomorrow.io weather: {e}");
            tomorrow_fallback_or_error(&state, &key).await
        }
    }
}

async fn tomorrow_fallback_or_error(state: &AppState, key: &str) -> HttpResponse {
    if let Some(stale) = state.tomorrow_cache.get_stale(key).await {
        tracing::warn!("Returning stale cached weather data");
        HttpResponse::Ok().json(stale)
    } else {
        HttpResponse::BadGateway().json(serde_json::json!({"error": "No cached data available"}))
    }
}
