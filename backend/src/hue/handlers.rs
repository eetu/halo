use std::sync::Arc;

use actix_web::{web, HttpResponse};
use actix_web_lab::sse;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio_stream::wrappers::BroadcastStream;
use utoipa::ToSchema;

use crate::AppState;

use super::client::{hue_fetch, hue_put};
use super::data::fetch_hue_data;
use super::events::{subscribe, HueLiveEvent};
use super::models::{BehaviorInstanceResource, GroupedLightResource, MotionMemberKind};
use super::motion::{set_dark_threshold, DAYLIGHT_OFF};

// ---- GET /api/hue ----

#[utoipa::path(
    get,
    path = "/api/hue",
    responses(
        (status = 200, description = "Hue sensors and light groups", body = super::models::HueResponse),
        (status = 502, description = "Failed to fetch Hue data")
    )
)]
pub async fn get_data(state: web::Data<Arc<AppState>>) -> HttpResponse {
    match fetch_hue_data(&state).await {
        Ok(data) => HttpResponse::Ok().json(data),
        Err(e) => {
            tracing::error!("Failed to fetch Hue data: {e}");
            HttpResponse::BadGateway().json(serde_json::json!({"error": e.to_string()}))
        }
    }
}

// ---- GET /api/hue/events (SSE) ----

#[utoipa::path(
    get,
    path = "/api/hue/events",
    responses(
        (status = 200, description = "Server-sent events stream of Hue device changes")
    )
)]
pub async fn events_sse(
    state: web::Data<Arc<AppState>>,
) -> sse::Sse<impl futures_util::Stream<Item = Result<sse::Event, std::convert::Infallible>>> {
    let rx = subscribe(&state.hue_events_tx);
    let stream = BroadcastStream::new(rx).filter_map(|result| async move {
        match result {
            Ok(event) => {
                let json = serde_json::to_string(&event).ok()?;
                Some(Ok::<_, std::convert::Infallible>(sse::Event::Data(
                    sse::Data::new(json),
                )))
            }
            Err(_) => None,
        }
    });

    sse::Sse::from_stream(stream).with_keep_alive(std::time::Duration::from_secs(30))
}

// ---- POST /api/hue/pair ----

#[derive(Debug, Deserialize, ToSchema)]
pub struct PairRequest {
    #[serde(rename = "bridgeIp")]
    pub bridge_ip: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PairResponse {
    pub message: String,
    #[serde(rename = "HUE_BRIDGE_ADDRESS")]
    pub hue_bridge_address: String,
    #[serde(rename = "HUE_BRIDGE_USER")]
    pub hue_bridge_user: String,
    #[serde(rename = "HUE_BRIDGE_USER_CLIENT_KEY")]
    pub hue_bridge_user_client_key: String,
}

#[utoipa::path(
    post,
    path = "/api/hue/pair",
    request_body = PairRequest,
    responses(
        (status = 200, description = "Pairing successful", body = PairResponse),
        (status = 400, description = "Pairing failed")
    )
)]
pub async fn pair(state: web::Data<Arc<AppState>>, body: web::Json<PairRequest>) -> HttpResponse {
    let bridge_ip = body
        .bridge_ip
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| state.settings.hue_bridge_address.clone());

    if bridge_ip.is_empty() {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({"error": "bridgeIp required (or set HUE_BRIDGE_ADDRESS)"}));
    }

    let url = if bridge_ip.starts_with("http://") || bridge_ip.starts_with("https://") {
        format!("{bridge_ip}/api")
    } else {
        format!("https://{bridge_ip}/api")
    };
    let payload = serde_json::json!({
        "devicetype": "halo#server",
        "generateclientkey": true,
    });

    let res = match state.hue_client.post(&url).json(&payload).send().await {
        Ok(r) => r,
        Err(e) => {
            return HttpResponse::BadRequest().json(serde_json::json!({"error": e.to_string()}));
        }
    };

    let entries: Vec<serde_json::Value> = match res.json().await {
        Ok(v) => v,
        Err(e) => {
            return HttpResponse::BadRequest().json(serde_json::json!({"error": e.to_string()}));
        }
    };

    let entry = &entries[0];
    if let Some(error) = entry.get("error") {
        let desc = error
            .get("description")
            .and_then(|d| d.as_str())
            .unwrap_or("Pairing failed");
        return HttpResponse::BadRequest().json(serde_json::json!({"error": desc}));
    }

    if let Some(success) = entry.get("success") {
        let username = success
            .get("username")
            .and_then(|u| u.as_str())
            .unwrap_or_default();
        let clientkey = success
            .get("clientkey")
            .and_then(|c| c.as_str())
            .unwrap_or_default();

        return HttpResponse::Ok().json(PairResponse {
            message: "Pairing successful. Add these to your .env:".into(),
            hue_bridge_address: bridge_ip,
            hue_bridge_user: username.into(),
            hue_bridge_user_client_key: clientkey.into(),
        });
    }

    HttpResponse::BadRequest().json(serde_json::json!({"error": "Unexpected response"}))
}

// ---- POST /api/hue/toggleGroup/{id} ----

#[utoipa::path(
    post,
    path = "/api/hue/toggleGroup/{id}",
    params(("id" = String, Path, description = "Grouped light resource ID")),
    responses(
        (status = 200, description = "Group toggled"),
        (status = 502, description = "Failed to toggle group")
    )
)]
pub async fn toggle_group(
    state: web::Data<Arc<AppState>>,
    path: web::Path<String>,
) -> HttpResponse {
    let group_id = path.into_inner();

    let current = match hue_fetch::<GroupedLightResource>(
        &state,
        &format!("/clip/v2/resource/grouped_light/{group_id}"),
    )
    .await
    {
        Ok(res) => res,
        Err(e) => {
            tracing::error!("Failed to get group {group_id}: {e}");
            return HttpResponse::BadGateway().json(serde_json::json!({"error": e.to_string()}));
        }
    };

    let is_on = current.data[0].on.on;
    let body = serde_json::json!({"on": {"on": !is_on}});

    match hue_put(
        &state,
        &format!("/clip/v2/resource/grouped_light/{group_id}"),
        &body,
    )
    .await
    {
        Ok(()) => HttpResponse::Ok().finish(),
        Err(e) => {
            tracing::error!("Failed to toggle group {group_id}: {e}");
            HttpResponse::BadGateway().json(serde_json::json!({"error": e.to_string()}))
        }
    }
}

// ---- POST /api/hue/setBrightness/{id} ----

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetBrightnessRequest {
    /// Target brightness percentage (0..=100). 0 turns the group off.
    pub brightness: f64,
}

#[utoipa::path(
    post,
    path = "/api/hue/setBrightness/{id}",
    params(("id" = String, Path, description = "Grouped light resource ID")),
    request_body = SetBrightnessRequest,
    responses(
        (status = 200, description = "Brightness set"),
        (status = 400, description = "Invalid brightness"),
        (status = 502, description = "Failed to set brightness")
    )
)]
pub async fn set_brightness(
    state: web::Data<Arc<AppState>>,
    path: web::Path<String>,
    body: web::Json<SetBrightnessRequest>,
) -> HttpResponse {
    let group_id = path.into_inner();
    let brightness = body.brightness;

    if !(0.0..=100.0).contains(&brightness) || brightness.is_nan() {
        return HttpResponse::BadRequest()
            .json(serde_json::json!({"error": "brightness must be 0..=100"}));
    }

    // Hue rejects dimming.brightness == 0; use on:false for that case.
    // Otherwise force on:true so dragging from 0 also turns the group on.
    let payload = if brightness <= 0.0 {
        serde_json::json!({"on": {"on": false}})
    } else {
        serde_json::json!({
            "on": {"on": true},
            "dimming": {"brightness": brightness},
        })
    };

    match hue_put(
        &state,
        &format!("/clip/v2/resource/grouped_light/{group_id}"),
        &payload,
    )
    .await
    {
        Ok(()) => HttpResponse::Ok().finish(),
        Err(e) => {
            tracing::error!("Failed to set brightness for {group_id}: {e}");
            HttpResponse::BadGateway().json(serde_json::json!({"error": e.to_string()}))
        }
    }
}

// ---- motion unit settings ----

/// Bridge resource IDs are UUIDs; anything else must not reach a bridge path.
fn is_resource_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn invalid_id() -> HttpResponse {
    HttpResponse::BadRequest().json(serde_json::json!({"error": "invalid resource id"}))
}

/// The bridge echoes a write on its event stream too; announcing it here
/// updates every open dashboard without waiting for that.
async fn announce(state: &AppState, event: HueLiveEvent) {
    state.hue_cache.invalidate("hue").await;
    let _ = state.hue_events_tx.send(event);
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetMotionEnabledRequest {
    pub kind: MotionMemberKind,
    pub enabled: bool,
}

#[utoipa::path(
    post,
    path = "/api/hue/setMotionEnabled/{id}",
    params(("id" = String, Path, description = "Motion unit member service ID")),
    request_body = SetMotionEnabledRequest,
    responses(
        (status = 200, description = "Member enabled or disabled"),
        (status = 400, description = "Invalid ID"),
        (status = 502, description = "Bridge refused the change")
    )
)]
pub async fn set_motion_enabled(
    state: web::Data<Arc<AppState>>,
    path: web::Path<String>,
    body: web::Json<SetMotionEnabledRequest>,
) -> HttpResponse {
    let id = path.into_inner();
    if !is_resource_id(&id) {
        return invalid_id();
    }
    let payload = serde_json::json!({"enabled": body.enabled});

    match hue_put(&state, &body.kind.resource_path(&id), &payload).await {
        Ok(()) => {
            let enabled = body.enabled;
            announce(&state, HueLiveEvent::MotionEnabled { id, enabled }).await;
            HttpResponse::Ok().finish()
        }
        Err(e) => {
            tracing::error!("Failed to set motion enabled for {id}: {e}");
            HttpResponse::BadGateway().json(serde_json::json!({"error": e.to_string()}))
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SetMotionSensitivityRequest {
    pub kind: MotionMemberKind,
    /// 0..=the member's `sensitivity.max`; the bridge rejects anything above.
    pub sensitivity: u8,
}

#[utoipa::path(
    post,
    path = "/api/hue/setMotionSensitivity/{id}",
    params(("id" = String, Path, description = "Motion unit member service ID")),
    request_body = SetMotionSensitivityRequest,
    responses(
        (status = 200, description = "Sensitivity set"),
        (status = 400, description = "Invalid ID"),
        (status = 502, description = "Bridge refused the change")
    )
)]
pub async fn set_motion_sensitivity(
    state: web::Data<Arc<AppState>>,
    path: web::Path<String>,
    body: web::Json<SetMotionSensitivityRequest>,
) -> HttpResponse {
    let id = path.into_inner();
    if !is_resource_id(&id) {
        return invalid_id();
    }
    let payload = serde_json::json!({"sensitivity": {"sensitivity": body.sensitivity}});

    match hue_put(&state, &body.kind.resource_path(&id), &payload).await {
        Ok(()) => {
            let sensitivity = body.sensitivity;
            announce(&state, HueLiveEvent::MotionSensitivity { id, sensitivity }).await;
            HttpResponse::Ok().finish()
        }
        Err(e) => {
            tracing::error!("Failed to set motion sensitivity for {id}: {e}");
            HttpResponse::BadGateway().json(serde_json::json!({"error": e.to_string()}))
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetDaylightRequest {
    /// Hue light level below which motion counts as dark; `null` to ignore
    /// daylight.
    pub dark_threshold: Option<u32>,
}

#[utoipa::path(
    post,
    path = "/api/hue/setDaylight/{automationId}",
    params(("automationId" = String, Path, description = "Motion automation (behavior_instance) ID")),
    request_body = SetDaylightRequest,
    responses(
        (status = 200, description = "Daylight threshold set"),
        (status = 400, description = "Invalid ID or threshold"),
        (status = 404, description = "Automation not found"),
        (status = 409, description = "Automation has no daylight setting"),
        (status = 502, description = "Bridge refused the change")
    )
)]
pub async fn set_daylight(
    state: web::Data<Arc<AppState>>,
    path: web::Path<String>,
    body: web::Json<SetDaylightRequest>,
) -> HttpResponse {
    let automation_id = path.into_inner();
    if !is_resource_id(&automation_id) {
        return invalid_id();
    }
    let dark_threshold = body.dark_threshold;
    if dark_threshold.is_some_and(|t| t >= DAYLIGHT_OFF) {
        return HttpResponse::BadRequest().json(
            serde_json::json!({"error": format!("darkThreshold must be below {DAYLIGHT_OFF}")}),
        );
    }

    // The bridge replaces `configuration` whole, so the write carries
    // everything else the automation holds alongside the new threshold.
    let resource_path = format!("/clip/v2/resource/behavior_instance/{automation_id}");
    let mut automations = match hue_fetch::<BehaviorInstanceResource>(&state, &resource_path).await
    {
        Ok(res) => res.data,
        Err(e) => {
            tracing::error!("Failed to get automation {automation_id}: {e}");
            return HttpResponse::BadGateway().json(serde_json::json!({"error": e.to_string()}));
        }
    };
    let Some(automation) = automations.first_mut() else {
        return HttpResponse::NotFound().json(serde_json::json!({"error": "automation not found"}));
    };
    if !set_dark_threshold(&mut automation.configuration, dark_threshold) {
        return HttpResponse::Conflict()
            .json(serde_json::json!({"error": "automation has no daylight setting"}));
    }
    let payload = serde_json::json!({"configuration": automation.configuration});

    match hue_put(&state, &resource_path, &payload).await {
        Ok(()) => {
            announce(
                &state,
                HueLiveEvent::Daylight {
                    automation_id,
                    dark_threshold,
                },
            )
            .await;
            HttpResponse::Ok().finish()
        }
        Err(e) => {
            tracing::error!("Failed to set daylight for {automation_id}: {e}");
            HttpResponse::BadGateway().json(serde_json::json!({"error": e.to_string()}))
        }
    }
}
