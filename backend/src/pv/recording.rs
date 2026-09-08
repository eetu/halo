//! Refresh loop for the PV forecast.
//!
//! Harmonie is rerun every three hours, so there is nothing to gain from asking
//! more often than that. The first pass runs at startup rather than after the
//! first interval, so a restart does not leave the dashboard without a forecast
//! for three hours.

use std::sync::Arc;
use std::time::Duration;

use crate::AppState;

use super::forecast::{self, ForecastError};

const TICK_SECS: u64 = 3 * 60 * 60;
const CACHE_KEY: &str = "pv";

pub fn start(state: Arc<AppState>) {
    if state.settings.pv_array.is_none() {
        tracing::info!("PV forecast disabled (PV_TILT/PV_AZIMUTH/PV_KW not set)");
        return;
    }

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(TICK_SECS));

        loop {
            interval.tick().await;
            refresh(&state).await;
        }
    });
}

async fn refresh(state: &AppState) {
    let forecast = match forecast::compute(state).await {
        Ok(forecast) => forecast,
        // Ordinary on a fresh install; the next tick picks it up.
        Err(ForecastError::NoPosition) => {
            tracing::info!("Skipping PV forecast refresh, no house position set yet");
            return;
        }
        Err(e) => {
            tracing::warn!("Skipping PV forecast refresh: {e}");
            return;
        }
    };

    if forecast.points.is_empty() {
        tracing::warn!("Skipping PV forecast refresh, model produced no usable points");
        return;
    }

    match state.storage.upsert_pv_forecast(&forecast).await {
        Ok(n) => tracing::info!("Upserted {n} PV forecast points"),
        Err(e) => {
            tracing::error!("Failed to store PV forecast: {e}");
            return;
        }
    }

    match state.storage.prune_pv_forecast().await {
        Ok(pruned) if pruned > 0 => tracing::info!("Pruned {pruned} stale PV forecast points"),
        Ok(_) => {}
        Err(e) => tracing::warn!("Failed to prune PV forecast: {e}"),
    }

    state.pv_cache.set(CACHE_KEY.into(), forecast).await;
}
