use std::sync::Arc;

use crate::AppState;

use super::discovery::get_bridge_address;
use super::models::HueList;

#[derive(Debug, thiserror::Error)]
pub enum HueError {
    #[error("HUE_BRIDGE_USER must be set. Run pairing first.")]
    NoUser,
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Bridge error {status}: {body}")]
    Bridge { status: u16, body: String },
    #[error("Failed to decode response from {path}: {source} (body: {body})")]
    Decode {
        path: String,
        body: String,
        #[source]
        source: serde_json::Error,
    },
    #[error("Failed to decode {rtype} resources: {source}")]
    DecodeResource {
        rtype: String,
        #[source]
        source: serde_json::Error,
    },
}

pub async fn hue_fetch<T: serde::de::DeserializeOwned>(
    state: &Arc<AppState>,
    path: &str,
) -> Result<HueList<T>, HueError> {
    if state.settings.hue_bridge_user.is_empty() {
        return Err(HueError::NoUser);
    }

    let address = get_bridge_address(state).await?;
    let url = format!("{address}{path}");

    let res = state
        .hue_client
        .get(&url)
        .header("hue-application-key", &state.settings.hue_bridge_user)
        .send()
        .await
        .map_err(|e| {
            tracing::debug!("Hue fetch {path} failed: {e:#}");
            e
        })?;

    if !res.status().is_success() {
        let status = res.status().as_u16();
        let body = res.text().await.unwrap_or_default();
        tracing::error!(path, status, body = %truncate(&body, 500), "Hue bridge returned non-success");
        return Err(HueError::Bridge { status, body });
    }

    let body = res.text().await?;
    serde_json::from_str::<HueList<T>>(&body).map_err(|e| {
        tracing::error!(
            path,
            error = %e,
            body = %truncate(&body, 500),
            "Failed to decode Hue response"
        );
        HueError::Decode {
            path: path.to_string(),
            body,
            source: e,
        }
    })
}

fn truncate(s: &str, n: usize) -> String {
    if s.len() <= n {
        s.to_string()
    } else {
        format!("{}…[+{} bytes]", &s[..n], s.len() - n)
    }
}

pub async fn hue_put(
    state: &Arc<AppState>,
    path: &str,
    body: &serde_json::Value,
) -> Result<(), HueError> {
    let address = get_bridge_address(state).await?;
    let url = format!("{address}{path}");

    let res = state
        .hue_client
        .put(&url)
        .header("hue-application-key", &state.settings.hue_bridge_user)
        .json(body)
        .send()
        .await?;

    if !res.status().is_success() {
        let status = res.status().as_u16();
        let body = res.text().await.unwrap_or_default();
        return Err(HueError::Bridge { status, body });
    }

    Ok(())
}

pub async fn check_connection(state: &Arc<AppState>) -> bool {
    hue_fetch::<serde_json::Value>(state, "/clip/v2/resource/bridge")
        .await
        .is_ok()
}
