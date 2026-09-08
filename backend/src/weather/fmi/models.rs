use chrono::{DateTime, Utc};

#[derive(Debug, Clone)]
pub struct FmiObservation {
    pub time: DateTime<Utc>,
    pub temperature: Option<f64>,
    pub wind_speed: Option<f64>,
    pub wind_gust: Option<f64>,
    pub wind_direction: Option<f64>,
    pub humidity: Option<f64>,
    pub precipitation_1h: Option<f64>,
    pub cloud_cover: Option<f64>,
    pub pressure: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct FmiForecastPoint {
    pub time: DateTime<Utc>,
    pub temperature: Option<f64>,
    pub wind_speed: Option<f64>,
    pub wind_gust: Option<f64>,
    pub wind_direction: Option<f64>,
    pub precipitation_1h: Option<f64>,
    pub cloud_cover: Option<f64>,
    pub humidity: Option<f64>,
    pub weather_symbol: Option<i32>,
}

/// One hour of the Harmonie forecast as the PV model needs it.
///
/// The three radiation fields are accumulations since the model run started, in
/// J/m² — the PV model differences consecutive hours to recover instantaneous
/// irradiance.
#[derive(Debug, Clone)]
pub struct FmiRadiationPoint {
    pub time: DateTime<Utc>,
    pub temperature: Option<f64>,
    pub wind_speed: Option<f64>,
    /// Global (total) shortwave radiation accumulation.
    pub global_accumulation: Option<f64>,
    /// Net surface shortwave radiation accumulation — global minus what the
    /// ground reflects back, which is what gives us albedo.
    pub net_shortwave_accumulation: Option<f64>,
    /// Direct shortwave radiation accumulation.
    pub direct_accumulation: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct FmiWeatherData {
    pub observation: Option<FmiObservation>,
    pub forecasts: Vec<FmiForecastPoint>,
}
