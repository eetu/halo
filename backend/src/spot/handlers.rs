use std::{sync::Arc, time::Duration};

use actix_web::{web, HttpResponse};

use crate::AppState;

/// A spot response is a full day-ahead array, so it stays useful for hours past
/// the 10-min TTL — but not across midnight, where "today" silently becomes
/// yesterday's prices.
const MAX_STALE: Duration = Duration::from_secs(6 * 3600);

#[utoipa::path(
    get,
    path = "/api/spot",
    responses(
        (status = 200, description = "Finnish spot prices, today + tomorrow hourly", body = super::models::SpotResponse),
        (status = 502, description = "Failed to fetch spot prices"),
    )
)]
pub async fn get_spot(state: web::Data<Arc<AppState>>) -> HttpResponse {
    if let Some(cached) = state.spot_cache.get("spot").await {
        return HttpResponse::Ok().json(cached);
    }

    match super::client::fetch(&state.http_client, &state.settings.spot_base_url).await {
        Ok(data) => {
            state.spot_cache.set("spot".into(), data.clone()).await;
            HttpResponse::Ok().json(data)
        }
        Err(e) => {
            tracing::error!("Failed to fetch spot prices: {e}");
            if let Some(stale) = state.spot_cache.get_stale("spot", MAX_STALE).await {
                tracing::warn!("Returning stale spot prices");
                return HttpResponse::Ok().json(stale);
            }
            HttpResponse::BadGateway().json(serde_json::json!({"error": e.to_string()}))
        }
    }
}
