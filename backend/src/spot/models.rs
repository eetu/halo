use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Raw entry from spot-hinta.fi `/TodayAndDayForward` (15-min resolution).
#[derive(Debug, Deserialize)]
pub struct SpotEntry {
    #[serde(rename = "DateTime")]
    pub date_time: String, // RFC3339 with local offset, e.g. 2026-06-14T00:15:00+03:00
    #[serde(rename = "PriceWithTax", default)]
    pub price_with_tax: f64, // €/kWh, incl. VAT
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
