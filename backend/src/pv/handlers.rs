use std::sync::Arc;

use actix_web::{web, HttpResponse};

use crate::AppState;

const CACHE_KEY: &str = "pv";

#[utoipa::path(
    get,
    path = "/api/pv/forecast",
    responses(
        (status = 200, description = "Latest PV forecast. Includes points from the past 24h so consumers can render today's full-day total after FMI's forecast window has moved past the morning hours.", body = super::models::PvForecast),
        (status = 503, description = "No forecast available yet"),
    )
)]
pub async fn get_forecast(state: web::Data<Arc<AppState>>) -> HttpResponse {
    if let Some(cached) = state.pv_cache.get(CACHE_KEY).await {
        return HttpResponse::Ok().json(cached);
    }

    match state.storage.read_pv_forecast().await {
        Ok(Some(forecast)) => {
            state.pv_cache.set(CACHE_KEY.into(), forecast.clone()).await;
            HttpResponse::Ok().json(forecast)
        }
        Ok(None) => HttpResponse::ServiceUnavailable()
            .json(serde_json::json!({"error": "no forecast available yet"})),
        Err(e) => {
            tracing::error!("Failed to read PV forecast: {e}");
            HttpResponse::InternalServerError().finish()
        }
    }
}
