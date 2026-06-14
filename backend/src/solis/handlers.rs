use std::sync::Arc;

use actix_web::{web, HttpResponse};
use serde::Deserialize;
use utoipa::IntoParams;

use crate::AppState;

#[utoipa::path(
    get,
    path = "/api/solis",
    responses(
        (status = 200, description = "SolisCloud station widget data", body = super::models::SolisWidgetData),
        (status = 502, description = "Failed to fetch data from SolisCloud"),
        (status = 503, description = "SolisCloud not configured"),
    )
)]
pub async fn get_data(state: web::Data<Arc<AppState>>) -> HttpResponse {
    if state.settings.solis_key_id.is_empty() {
        return HttpResponse::ServiceUnavailable()
            .json(serde_json::json!({"error": "SolisCloud not configured"}));
    }

    if let Some(cached) = state.solis_cache.get("station").await {
        tracing::debug!("Returning cached SolisCloud data");
        return HttpResponse::Ok().json(cached);
    }

    match super::client::fetch_station_detail(&state).await {
        Ok(data) => {
            state.solis_cache.set("station".into(), data.clone()).await;
            HttpResponse::Ok().json(data)
        }
        Err(e) => {
            tracing::error!("Failed to fetch SolisCloud data: {e}");
            if let Some(stale) = state.solis_cache.get_stale("station").await {
                tracing::warn!("Returning stale SolisCloud data");
                return HttpResponse::Ok().json(stale);
            }
            HttpResponse::BadGateway().json(serde_json::json!({"error": e.to_string()}))
        }
    }
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct SolisHistoryQuery {
    /// Number of hours of history to return (default: 24, max: 720)
    pub hours: Option<u32>,
    /// Maximum number of data points to return via uniform sampling (optional)
    pub max_points: Option<u32>,
}

#[utoipa::path(
    get,
    path = "/api/history/solis",
    params(SolisHistoryQuery),
    responses(
        (status = 200, description = "Solis reading history", body = Vec<super::models::SolisReading>),
        (status = 500, description = "Database error"),
    )
)]
pub async fn get_history(
    state: web::Data<Arc<AppState>>,
    query: web::Query<SolisHistoryQuery>,
) -> HttpResponse {
    let hours = query.hours.unwrap_or(24).min(720);
    match state
        .storage
        .query_solis_readings(hours, query.max_points)
        .await
    {
        Ok(readings) => HttpResponse::Ok().json(readings),
        Err(e) => {
            tracing::error!("Failed to query Solis history: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}
