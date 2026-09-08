use std::env;

use crate::pv::forecast::ArraySpec;

pub struct Settings {
    /// The PV array to forecast for. `None` disables the forecast loop. Its
    /// position is not here — that is the house position in `user_settings`.
    pub pv_array: Option<ArraySpec>,
    pub tomorrow_io_api_key: String,
    pub tomorrow_io_base_url: String,
    pub fmi_base_url: String,
    pub fmi_wms_base_url: String,
    pub fmi_download_base_url: String,
    pub language: String,
    pub hue_bridge_address: String,
    pub hue_bridge_user: String,
    pub hue_room_types: String,
    pub static_dir: String,
    pub port: u16,
    pub history_retention_days: u32,
    pub solis_key_id: String,
    pub solis_key_secret: String,
    pub solis_station_id: String,
    pub solis_base_url: String,
    /// Default provider key for the reserve tables. Generic default; a local
    /// deploy can set RESERVE_PROVIDER to a real name to match its updater.
    pub reserve_provider: String,
    pub spot_base_url: String,
}

impl Settings {
    pub fn test_defaults() -> Self {
        Self {
            pv_array: None,
            tomorrow_io_api_key: String::new(),
            tomorrow_io_base_url: "https://api.tomorrow.io".into(),
            fmi_base_url: "https://opendata.fmi.fi/wfs".into(),
            fmi_wms_base_url: "https://openwms.fmi.fi/geoserver/wms".into(),
            fmi_download_base_url: "https://opendata.fmi.fi/download".into(),
            language: "fi".into(),
            hue_bridge_address: String::new(),
            hue_bridge_user: String::new(),
            hue_room_types: "{}".into(),
            static_dir: "./dist".into(),
            port: 3000,
            history_retention_days: 0,
            solis_key_id: String::new(),
            solis_key_secret: String::new(),
            solis_station_id: String::new(),
            solis_base_url: "https://www.soliscloud.com:13333".into(),
            reserve_provider: "reserve".into(),
            spot_base_url: "https://dashboard.elering.ee".into(),
        }
    }

    pub fn from_env() -> Self {
        Self {
            pv_array: pv_array_from_env(),
            tomorrow_io_api_key: env::var("TOMORROW_IO_API_KEY").unwrap_or_default(),
            tomorrow_io_base_url: env::var("TOMORROW_IO_BASE_URL")
                .unwrap_or_else(|_| "https://api.tomorrow.io".into()),
            fmi_base_url: env::var("FMI_BASE_URL")
                .unwrap_or_else(|_| "https://opendata.fmi.fi/wfs".into()),
            fmi_wms_base_url: env::var("FMI_WMS_BASE_URL")
                .unwrap_or_else(|_| "https://openwms.fmi.fi/geoserver/wms".into()),
            fmi_download_base_url: env::var("FMI_DOWNLOAD_BASE_URL")
                .unwrap_or_else(|_| "https://opendata.fmi.fi/download".into()),
            language: env::var("LANGUAGE").unwrap_or_else(|_| "fi".into()),
            hue_bridge_address: env::var("HUE_BRIDGE_ADDRESS").unwrap_or_default(),
            hue_bridge_user: env::var("HUE_BRIDGE_USER").unwrap_or_default(),
            hue_room_types: env::var("HUE_ROOM_TYPES")
                .unwrap_or_else(|_| "{}".into())
                .trim_matches('\'')
                .trim_matches('"')
                .to_string(),
            static_dir: env::var("STATIC_DIR").unwrap_or_else(|_| "./dist".into()),
            port: env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3000),
            history_retention_days: env::var("HALO_HISTORY_RETENTION_DAYS")
                .ok()
                .and_then(|d| d.parse().ok())
                .unwrap_or(0),
            solis_key_id: env::var("SOLIS_KEY_ID").unwrap_or_default(),
            solis_key_secret: env::var("SOLIS_KEY_SECRET").unwrap_or_default(),
            solis_station_id: env::var("SOLIS_STATION_ID").unwrap_or_default(),
            solis_base_url: env::var("SOLIS_BASE_URL")
                .unwrap_or_else(|_| "https://www.soliscloud.com:13333".into()),
            reserve_provider: env::var("RESERVE_PROVIDER").unwrap_or_else(|_| "reserve".into()),
            spot_base_url: env::var("SPOT_BASE_URL")
                .unwrap_or_else(|_| "https://dashboard.elering.ee".into()),
        }
    }
}

/// Read the PV array from the environment.
///
/// All three values are required together — a partial set is a misconfiguration
/// rather than a reason to guess, so it is reported and the forecast stays off.
fn pv_array_from_env() -> Option<ArraySpec> {
    const KEYS: [&str; 3] = ["PV_TILT", "PV_AZIMUTH", "PV_KW"];

    let values: Vec<Option<f64>> = KEYS
        .iter()
        .map(|key| {
            env::var(key)
                .ok()
                .and_then(|v| v.trim().parse::<f64>().ok())
        })
        .collect();

    if values.iter().all(Option::is_none) {
        return None;
    }

    let missing: Vec<&str> = KEYS
        .iter()
        .zip(&values)
        .filter(|(_, value)| value.is_none())
        .map(|(key, _)| *key)
        .collect();
    if !missing.is_empty() {
        tracing::warn!(
            "PV forecast disabled: {} not set or not a number",
            missing.join(", ")
        );
        return None;
    }

    let array = ArraySpec {
        tilt: values[0].unwrap(),
        azimuth: values[1].unwrap(),
        rated_power_kw: values[2].unwrap(),
    };

    if !(0.0..=90.0).contains(&array.tilt) || !(0.0..=360.0).contains(&array.azimuth) {
        tracing::warn!(
            "PV forecast disabled: PV_TILT must be 0-90 and PV_AZIMUTH 0-360 (got {}, {})",
            array.tilt,
            array.azimuth
        );
        return None;
    }
    if array.rated_power_kw <= 0.0 {
        tracing::warn!(
            "PV forecast disabled: PV_KW must be positive (got {})",
            array.rated_power_kw
        );
        return None;
    }

    Some(array)
}
