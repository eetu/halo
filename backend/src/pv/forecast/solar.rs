//! Solar geometry for the PV model: sun position, angle of incidence, relative
//! airmass and extraterrestrial irradiance.
//!
//! Angle conventions: azimuth is degrees clockwise from north (180 = south),
//! zenith is degrees from vertical.

use chrono::{DateTime, Datelike, Utc};
use solar_positioning::{spa, RefractionCorrection};

/// Observer elevation, atmosphere and ΔT used for the sun position. Refraction
/// depends on the first three, but only near the horizon, so standard sea-level
/// conditions are close enough. ΔT is the current offset between terrestrial
/// and universal time.
const OBSERVER_ELEVATION_M: f64 = 0.0;
const PRESSURE_MBAR: f64 = 1013.25;
const TEMPERATURE_C: f64 = 12.0;
const DELTA_T_SECONDS: f64 = 67.0;

/// Relative airmass at the horizon. The Kasten-Young curve is undefined past
/// 90°, so the diffuse model holds it at this value instead.
pub const AIRMASS_AT_HORIZON: f64 = 37.919_608_377_836_25;

/// Where the sun is at one instant, plus the atmosphere and sunlight available.
#[derive(Debug, Clone, Copy)]
pub struct SunState {
    /// Refraction-corrected zenith angle, degrees.
    pub apparent_zenith: f64,
    /// Degrees clockwise from north.
    pub azimuth: f64,
    /// Relative airmass; `None` once the sun is below the horizon.
    pub airmass: Option<f64>,
    /// Extraterrestrial normal irradiance, W/m².
    pub extraterrestrial_dni: f64,
}

/// Sun position by the NREL SPA, refraction-corrected.
pub fn sun_state(time: DateTime<Utc>, latitude: f64, longitude: f64) -> SunState {
    let refraction = RefractionCorrection::new(PRESSURE_MBAR, TEMPERATURE_C)
        .expect("standard pressure and temperature are in range");

    let position = spa::solar_position(
        time,
        latitude,
        longitude,
        OBSERVER_ELEVATION_M,
        DELTA_T_SECONDS,
        Some(refraction),
    )
    .expect("site coordinates are validated at settings load");

    let apparent_zenith = position.zenith_angle();

    SunState {
        apparent_zenith,
        azimuth: position.azimuth(),
        airmass: relative_airmass(apparent_zenith),
        extraterrestrial_dni: extra_radiation(time),
    }
}

/// Cosine of the angle between the panel normal and the sun. Unclamped: the
/// circumsolar term wants the raw projection, and negative means the sun is
/// behind the panel.
pub fn aoi_projection(tilt: f64, surface_azimuth: f64, zenith: f64, solar_azimuth: f64) -> f64 {
    let (tilt, surface_azimuth) = (tilt.to_radians(), surface_azimuth.to_radians());
    let (zenith, solar_azimuth) = (zenith.to_radians(), solar_azimuth.to_radians());

    zenith.cos() * tilt.cos() + zenith.sin() * tilt.sin() * (solar_azimuth - surface_azimuth).cos()
}

/// Angle of incidence in degrees, limited to `[0, 90]` — past 90° the panel
/// sees no direct sun at all.
pub fn aoi_limited(tilt: f64, surface_azimuth: f64, zenith: f64, solar_azimuth: f64) -> f64 {
    let projection = aoi_projection(tilt, surface_azimuth, zenith, solar_azimuth);
    projection
        .clamp(-1.0, 1.0)
        .acos()
        .to_degrees()
        .clamp(0.0, 90.0)
}

/// Relative airmass, Kasten-Young 1989. `None` once the sun is below the horizon.
pub fn relative_airmass(apparent_zenith: f64) -> Option<f64> {
    if apparent_zenith > 90.0 {
        return None;
    }
    Some(
        1.0 / (apparent_zenith.to_radians().cos()
            + 0.50572 * (96.07995 - apparent_zenith).powf(-1.6364)),
    )
}

/// Extraterrestrial normal irradiance, Spencer's Earth-Sun distance correction.
pub fn extra_radiation(time: DateTime<Utc>) -> f64 {
    const SOLAR_CONSTANT: f64 = 1366.1;

    let day_angle = (2.0 * std::f64::consts::PI / 365.0) * f64::from(time.ordinal() - 1);
    let distance_correction = 1.00011
        + 0.034221 * day_angle.cos()
        + 0.00128 * day_angle.sin()
        + 0.000719 * (2.0 * day_angle).cos()
        + 7.7e-05 * (2.0 * day_angle).sin();

    SOLAR_CONSTANT * distance_correction
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pv::forecast::test_fixtures::{fixtures, LAT, LON};

    #[test]
    fn solar_position_matches_reference_values() {
        for case in fixtures()["solar_position"].as_array().unwrap() {
            let time: DateTime<Utc> = case["time"].as_str().unwrap().parse().unwrap();
            let angles = sun_state(time, LAT, LON);

            let expected_zenith = case["apparent_zenith"].as_f64().unwrap();
            let expected_azimuth = case["azimuth"].as_f64().unwrap();

            assert!(
                (angles.apparent_zenith - expected_zenith).abs() < 1e-3,
                "{time}: zenith {} vs reference {expected_zenith}",
                angles.apparent_zenith
            );
            assert!(
                (angles.azimuth - expected_azimuth).abs() < 1e-3,
                "{time}: azimuth {} vs reference {expected_azimuth}",
                angles.azimuth
            );
        }
    }

    #[test]
    fn airmass_matches_reference_values() {
        for case in fixtures()["airmass"].as_array().unwrap() {
            let zenith = case["zenith"].as_f64().unwrap();
            let expected = case["value"].as_f64().unwrap();
            let actual = relative_airmass(zenith).expect("fixture zeniths are all <= 90");
            assert!(
                (actual - expected).abs() < 1e-9,
                "zenith {zenith}: {actual} vs {expected}"
            );
        }
    }

    #[test]
    fn airmass_at_horizon_constant_matches_the_curve() {
        let at_ninety = relative_airmass(90.0).unwrap();
        assert!((at_ninety - AIRMASS_AT_HORIZON).abs() < 1e-9);
        assert!(relative_airmass(90.001).is_none());
    }

    #[test]
    fn extra_radiation_matches_reference_values() {
        for case in fixtures()["dni_extra"].as_array().unwrap() {
            let doy = case["doy"].as_u64().unwrap() as u32;
            let expected = case["value"].as_f64().unwrap();

            let time = chrono::NaiveDate::from_yo_opt(2026, doy)
                .unwrap()
                .and_hms_opt(12, 0, 0)
                .unwrap()
                .and_utc();
            let actual = extra_radiation(time);

            assert!(
                (actual - expected).abs() < 1e-6,
                "doy {doy}: {actual} vs {expected}"
            );
        }
    }

    #[test]
    fn aoi_is_zero_when_sun_is_on_the_panel_normal() {
        // A 25° south-facing panel, sun at 25° zenith due south.
        assert!(aoi_limited(25.0, 180.0, 25.0, 180.0).abs() < 1e-9);
        // Sun behind the panel clamps to 90 rather than reporting an obtuse angle.
        assert_eq!(aoi_limited(25.0, 180.0, 80.0, 0.0), 90.0);
    }
}
