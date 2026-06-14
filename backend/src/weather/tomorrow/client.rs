use crate::AppState;

#[derive(Debug, thiserror::Error)]
pub enum TomorrowError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("API error: status {0}")]
    Api(u16),
}

const FIELDS: &[&str] = &[
    "precipitationProbabilityAvg",
    "precipitationIntensity",
    "precipitationType",
    "windSpeed",
    "windGust",
    "windDirection",
    "temperature",
    "temperatureApparent",
    "cloudCover",
    "cloudBase",
    "cloudCeiling",
    "weatherCode",
    "sunriseTime",
    "sunsetTime",
    "rainAccumulation",
    "snowAccumulation",
];

const TIMESTEPS: &str = "current,1d,1h";

pub async fn fetch(
    state: &AppState,
    lat: &str,
    lon: &str,
) -> Result<serde_json::Value, TomorrowError> {
    let settings = &state.settings;

    let url = format!(
        "{}/v4/timelines?location={},{}&apikey={}&timesteps={}&fields={}&timezone=Europe/Helsinki",
        settings.tomorrow_io_base_url,
        lat,
        lon,
        settings.tomorrow_io_api_key,
        TIMESTEPS,
        FIELDS.join(","),
    );

    let res = state.http_client.get(&url).send().await?;

    if !res.status().is_success() {
        return Err(TomorrowError::Api(res.status().as_u16()));
    }

    let data = res.json::<serde_json::Value>().await?;
    Ok(data)
}
