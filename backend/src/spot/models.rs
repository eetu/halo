use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// One entry from Elering LIVE `/api/nps/price` — EUR/MWh ex-VAT, Unix-UTC ts.
#[derive(Debug, Deserialize)]
pub struct NpsEntry {
    pub timestamp: i64,
    pub price: f64,
}

/// `data` object: one array per bidding zone; we read Finland (`fi`).
#[derive(Debug, Default, Deserialize)]
pub struct NpsData {
    #[serde(default)]
    pub fi: Vec<NpsEntry>,
}

#[derive(Debug, Deserialize)]
pub struct NpsResponse {
    #[serde(default)]
    pub data: NpsData,
}

/// One hourly bar. `hour` is the local-time hour start (RFC3339); `price` is
/// c/kWh incl. VAT (the 15-min quarters averaged).
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct HourPrice {
    pub hour: String,
    pub price: f64,
}

/// Today + tomorrow hourly spot prices. `tomorrow` is empty until the day-ahead
/// auction publishes (~14:15 local).
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SpotResponse {
    pub unit: String,
    pub today: Vec<HourPrice>,
    pub tomorrow: Vec<HourPrice>,
    pub today_average: f64,
}
