//! PV output forecasting from the FMI Harmonie radiation forecast.
//!
//! The chain, per forecast hour:
//!
//! 1. `radiation` — difference the accumulated radiation into instantaneous
//!    global, direct and diffuse irradiance, and derive ground albedo.
//! 2. `transposition` — project each component onto the plane of the array.
//! 3. `reflection` — discount what the glass reflects rather than absorbs.
//! 4. `temperature` — estimate module temperature from absorbed irradiance,
//!    wind and air temperature.
//! 5. `output` — convert absorbed irradiance and module temperature to DC watts.

pub mod output;
pub mod radiation;
pub mod reflection;
pub mod solar;
pub mod temperature;
pub mod transposition;

#[cfg(test)]
pub mod test_fixtures;

use chrono::Utc;

use crate::pv::models::{PvForecast, PvPoint};
use crate::weather::fmi::client::{fetch_radiation, FmiError};
use crate::AppState;

use radiation::RadiationRow;

/// Height of the modules above the ground, metres. Scales the 10 m forecast wind
/// down to panel height; a lower value models a sheltered installation.
const MODULE_ELEVATION_M: f64 = 7.0;

/// How the panels are mounted.
#[derive(Debug, Clone, Copy)]
pub struct ArraySpec {
    /// Degrees from horizontal: 0 flat, 90 vertical.
    pub tilt: f64,
    /// Degrees clockwise from north: 180 faces south.
    pub azimuth: f64,
    /// Nominal DC power at standard test conditions.
    pub rated_power_kw: f64,
}

/// The array plus where it stands. The position is the dashboard's saved house
/// pin, shared with the weather and sunrise views.
#[derive(Debug, Clone, Copy)]
pub struct SystemConfig {
    pub latitude: f64,
    pub longitude: f64,
    pub array: ArraySpec,
}

impl SystemConfig {
    pub fn new(array: ArraySpec, latitude: f64, longitude: f64) -> Self {
        Self {
            latitude,
            longitude,
            array,
        }
    }
}

/// One hour of the model, including the intermediate irradiances.
#[derive(Debug, Clone)]
pub struct ModelledRow {
    /// Plane-of-array components before reflection losses, W/m².
    pub beam_poa: f64,
    pub sky_diffuse_poa: f64,
    pub ground_poa: f64,
    pub total_poa: f64,
    /// The same components after reflection losses, W/m².
    pub beam_absorbed: f64,
    pub sky_diffuse_absorbed: f64,
    pub ground_absorbed: f64,
    pub total_absorbed: f64,
    pub module_temperature: f64,
    pub output_w: f64,
}

/// Run the model for a single hour.
pub fn model_row(row: &RadiationRow, config: &SystemConfig) -> ModelledRow {
    let ArraySpec {
        tilt,
        azimuth,
        rated_power_kw,
    } = config.array;

    let aoi = solar::aoi_limited(tilt, azimuth, row.sun.apparent_zenith, row.sun.azimuth);

    let beam_poa = transposition::beam(row.dni, aoi);
    let sky_diffuse_poa = transposition::sky_diffuse(tilt, azimuth, row.dhi, row.dni, &row.sun);
    let ground_poa = transposition::ground_reflected(row.ghi, tilt, row.albedo);

    let beam_absorbed = (1.0 - reflection::beam_reflected(aoi)) * beam_poa;
    let sky_diffuse_absorbed = (1.0 - reflection::sky_diffuse_reflected(tilt)) * sky_diffuse_poa;
    let ground_absorbed = (1.0 - reflection::ground_reflected_reflected(tilt)) * ground_poa;
    let total_absorbed = beam_absorbed + sky_diffuse_absorbed + ground_absorbed;

    let module_temperature = temperature::module_temperature(
        total_absorbed,
        row.wind,
        MODULE_ELEVATION_M,
        row.air_temperature,
    );
    // A NaN irradiance would otherwise propagate silently into the output.
    let module_temperature = if module_temperature.is_finite() {
        module_temperature
    } else {
        row.air_temperature
    };

    ModelledRow {
        beam_poa,
        sky_diffuse_poa,
        ground_poa,
        total_poa: beam_poa + sky_diffuse_poa + ground_poa,
        beam_absorbed,
        sky_diffuse_absorbed,
        ground_absorbed,
        total_absorbed,
        module_temperature,
        output_w: output::output_watts(total_absorbed, module_temperature, rated_power_kw),
    }
}

/// Why a forecast could not be produced.
#[derive(Debug, thiserror::Error)]
pub enum ForecastError {
    #[error("FMI: {0}")]
    Fmi(#[from] FmiError),
    /// Set the position in the dashboard's location form.
    #[error("no house position saved yet")]
    NoPosition,
}

/// Fetch the current radiation forecast and model the whole window.
pub async fn compute(state: &AppState) -> Result<PvForecast, ForecastError> {
    let array = state
        .settings
        .pv_array
        .expect("caller checked the array is configured");
    let (latitude, longitude) = house_position(state)
        .await
        .ok_or(ForecastError::NoPosition)?;
    let config = SystemConfig::new(array, latitude, longitude);

    let points = fetch_radiation(
        &state.http_client,
        &state.settings.fmi_base_url,
        &config.latitude.to_string(),
        &config.longitude.to_string(),
    )
    .await?;

    let rows = radiation::rows_from_forecast(&points, config.latitude, config.longitude);
    tracing::info!(
        "modelling PV output for {} of {} forecast hours",
        rows.len(),
        points.len()
    );

    let points = rows
        .iter()
        .map(|row| {
            let modelled = model_row(row, &config);
            PvPoint {
                time: row.time.format("%Y-%m-%dT%H:00:00Z").to_string(),
                output_w: modelled.output_w,
                temperature: Some(row.air_temperature),
                wind: Some(row.wind),
                module_temp: Some(modelled.module_temperature),
            }
        })
        .collect();

    Ok(PvForecast {
        generated_at: Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        points,
    })
}

/// The house position from the dashboard's own settings, the same
/// `{ lat, lon }` the weather and sunrise views are drawn for. `None` until
/// somebody has set it; there is no sensible default for where a house is.
async fn house_position(state: &AppState) -> Option<(f64, f64)> {
    let settings = state
        .storage
        .get_settings()
        .await
        .inspect_err(|e| tracing::warn!("Failed to read settings for the PV forecast: {e}"))
        .ok()?;
    let settings: serde_json::Value = serde_json::from_str(&settings).ok()?;
    let location = settings.get("location")?;

    Some((
        location.get("lat")?.as_f64()?,
        location.get("lon")?.as_f64()?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{DateTime, Duration};
    use test_fixtures::{fixtures, AZIMUTH, KW, LAT, LON, TILT};

    /// The whole chain against reference values, over a synthetic clear-sky day.
    #[test]
    fn end_to_end_matches_the_reference_values() {
        let config = SystemConfig::new(
            ArraySpec {
                tilt: TILT,
                azimuth: AZIMUTH,
                rated_power_kw: KW,
            },
            LAT,
            LON,
        );

        let fixture = &fixtures()["end_to_end"];
        let inputs = fixture["input"].as_array().unwrap();
        let expected = fixture["expected"].as_array().unwrap();
        assert_eq!(inputs.len(), expected.len());

        let mut worst: std::collections::BTreeMap<&str, (f64, String)> = Default::default();

        for (input, want) in inputs.iter().zip(expected) {
            // The fixture's timestamps are the interval midpoints.
            let midpoint: DateTime<Utc> = input["time"].as_str().unwrap().parse().unwrap();
            let row = RadiationRow {
                time: midpoint - Duration::minutes(30),
                midpoint,
                sun: solar::sun_state(midpoint, LAT, LON),
                dni: input["dni"].as_f64().unwrap(),
                dhi: input["dhi"].as_f64().unwrap(),
                ghi: input["ghi"].as_f64().unwrap(),
                albedo: input["albedo"].as_f64().unwrap(),
                air_temperature: input["T"].as_f64().unwrap(),
                wind: input["wind"].as_f64().unwrap(),
            };

            let got = model_row(&row, &config);

            for (label, got, want) in [
                ("dni_poa", got.beam_poa, want["dni_poa"].as_f64().unwrap()),
                (
                    "dhi_poa",
                    got.sky_diffuse_poa,
                    want["dhi_poa"].as_f64().unwrap(),
                ),
                ("ghi_poa", got.ground_poa, want["ghi_poa"].as_f64().unwrap()),
                ("poa", got.total_poa, want["poa"].as_f64().unwrap()),
                (
                    "dni_rc",
                    got.beam_absorbed,
                    want["dni_rc"].as_f64().unwrap(),
                ),
                (
                    "dhi_rc",
                    got.sky_diffuse_absorbed,
                    want["dhi_rc"].as_f64().unwrap(),
                ),
                (
                    "ghi_rc",
                    got.ground_absorbed,
                    want["ghi_rc"].as_f64().unwrap(),
                ),
                (
                    "poa_ref_cor",
                    got.total_absorbed,
                    want["poa_ref_cor"].as_f64().unwrap(),
                ),
                (
                    "module_temp",
                    got.module_temperature,
                    want["module_temp"].as_f64().unwrap(),
                ),
                ("output", got.output_w, want["output"].as_f64().unwrap()),
            ] {
                // Scaled by the value itself, with a floor, so near-zero hours
                // are compared absolutely.
                let deviation = (got - want).abs() / want.abs().max(1.0);
                let entry = worst.entry(label).or_insert((0.0, String::new()));
                if deviation > entry.0 {
                    *entry = (deviation, format!("{midpoint}: {got} vs {want}"));
                }
            }
        }

        for (label, (deviation, context)) in &worst {
            println!("{label:12} worst relative deviation {deviation:.2e}  {context}");
        }

        for (label, (deviation, context)) in &worst {
            assert!(
                *deviation < RELATIVE_TOLERANCE,
                "{label} deviates by {deviation:.2e}, over the {RELATIVE_TOLERANCE:.0e} \
                 tolerance — {context}"
            );
        }
    }

    /// How far a modelled value may sit from its reference, as a fraction of the
    /// value (floored at 1 W/°C so near-zero hours are compared absolutely).
    ///
    /// The floor exists because two NREL SPA implementations agree only to
    /// roughly 1e-5 degrees. That is invisible at midday and grows towards
    /// sunrise, where a tiny change in a near-90° incidence angle moves its
    /// cosine by a large fraction of a very small number.
    const RELATIVE_TOLERANCE: f64 = 1e-4;
}
