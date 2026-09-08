//! Print the PV forecast as JSON, without starting the server.
//!
//! Reads the same `PV_TILT` / `PV_AZIMUTH` / `PV_KW` variables the backend does,
//! queries FMI live, and writes the forecast to stdout. Progress goes to stderr,
//! so stdout stays a clean JSON document suitable for diffing.
//!
//! The running backend takes the site position from its saved settings; there is
//! no database here, so pass it as `PV_LAT` and `PV_LON`.
//!
//! ```text
//! cargo run --example pv_forecast > forecast.json
//! ```

use halo_backend::create_test_app_state_with;
use halo_backend::pv::forecast;
use halo_backend::settings::Settings;

#[tokio::main]
async fn main() -> std::process::ExitCode {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .init();

    let settings = Settings::from_env();
    if settings.pv_array.is_none() {
        eprintln!("set PV_TILT, PV_AZIMUTH and PV_KW first");
        return std::process::ExitCode::FAILURE;
    }

    let position = ["PV_LAT", "PV_LON"].map(|key| {
        std::env::var(key)
            .ok()
            .and_then(|v| v.trim().parse::<f64>().ok())
    });
    let [Some(lat), Some(lon)] = position else {
        eprintln!(
            "set PV_LAT and PV_LON — this tool has no saved settings to read a position from"
        );
        return std::process::ExitCode::FAILURE;
    };

    let state = create_test_app_state_with(settings);
    if let Err(e) = state
        .storage
        .save_settings(&serde_json::json!({ "location": { "lat": lat, "lon": lon } }).to_string())
        .await
    {
        eprintln!("could not seed the position: {e}");
        return std::process::ExitCode::FAILURE;
    }

    match forecast::compute(&state).await {
        Ok(forecast) => {
            println!("{}", serde_json::to_string(&forecast).unwrap());
            std::process::ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("forecast failed: {e}");
            std::process::ExitCode::FAILURE
        }
    }
}
