use std::env;

pub struct Settings {
    pub tomorrow_io_api_key: String,
    pub tomorrow_io_base_url: String,
    pub fmi_base_url: String,
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
            tomorrow_io_api_key: String::new(),
            tomorrow_io_base_url: "https://api.tomorrow.io".into(),
            fmi_base_url: "https://opendata.fmi.fi/wfs".into(),
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
            tomorrow_io_api_key: env::var("TOMORROW_IO_API_KEY").unwrap_or_default(),
            tomorrow_io_base_url: env::var("TOMORROW_IO_BASE_URL")
                .unwrap_or_else(|_| "https://api.tomorrow.io".into()),
            fmi_base_url: env::var("FMI_BASE_URL")
                .unwrap_or_else(|_| "https://opendata.fmi.fi/wfs".into()),
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
