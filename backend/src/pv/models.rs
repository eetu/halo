use serde::Serialize;
use utoipa::ToSchema;

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PvPoint {
    /// ISO8601 UTC hour
    pub time: String,
    pub output_w: f64,
    pub temperature: Option<f64>,
    pub wind: Option<f64>,
    pub module_temp: Option<f64>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PvForecast {
    /// When the forecast run was generated (ISO8601 UTC)
    pub generated_at: String,
    pub points: Vec<PvPoint>,
}
