//! Turning the Harmonie radiation forecast into the irradiance components the
//! PV model consumes.
//!
//! FMI reports radiation as an accumulation since the model run began, stamped
//! at the *end* of each hour: the value at 18:00 covers 17:00-18:00. Three
//! consequences run through this module and the rest of the model:
//!
//! - Instantaneous irradiance is the difference between consecutive hours.
//! - Sun position is evaluated at the interval's **midpoint**, 17:30, because
//!   that is the geometry the hour's energy actually arrived under.
//! - The row is labelled with the interval's **start**, 17:00, which is what a
//!   reader means by "output at 17:00".

use chrono::{DateTime, Duration, Utc};

use crate::weather::fmi::models::FmiRadiationPoint;

use super::solar::{sun_state, SunState};

/// One hour of irradiance, ready for the plane-of-array projection.
#[derive(Debug, Clone)]
pub struct RadiationRow {
    /// Interval start — the label the forecast is published under.
    pub time: DateTime<Utc>,
    /// Interval midpoint — the instant the sun position is taken at.
    pub midpoint: DateTime<Utc>,
    /// Sun geometry at the midpoint, needed both to derive `dni` and to project
    /// it downstream.
    pub sun: SunState,
    /// Direct normal irradiance, W/m².
    pub dni: f64,
    /// Diffuse horizontal irradiance, W/m².
    pub dhi: f64,
    /// Global horizontal irradiance, W/m².
    pub ghi: f64,
    /// Ground reflectivity in `[0, 1]`.
    pub albedo: f64,
    /// Air temperature, °C.
    pub air_temperature: f64,
    /// Wind speed at 10 m, m/s.
    pub wind: f64,
}

const SECONDS_PER_HOUR: f64 = 60.0 * 60.0;

/// Build the model's input rows from consecutive Harmonie hours.
///
/// Points must be ordered by time. Hours that are not exactly one hour apart, or
/// that are missing any field the model needs, are skipped — differencing across
/// a gap would silently attribute several hours of accumulated energy to one.
pub fn rows_from_forecast(
    points: &[FmiRadiationPoint],
    latitude: f64,
    longitude: f64,
) -> Vec<RadiationRow> {
    let mut rows = Vec::new();

    for pair in points.windows(2) {
        let (previous, current) = (&pair[0], &pair[1]);

        if current.time - previous.time != Duration::hours(1) {
            tracing::debug!(
                "skipping PV radiation row at {}: {} minutes since the previous hour",
                current.time,
                (current.time - previous.time).num_minutes()
            );
            continue;
        }

        let Some(fields) = hourly_fields(previous, current) else {
            continue;
        };
        let (ghi, net_shortwave, direct_horizontal, air_temperature, wind) = fields;

        // Ground reflectivity is the share of global irradiance the surface
        // sends back: (global - net) / global. Left as None where the division
        // is meaningless or the result unphysical, and filled in below.
        let albedo = {
            let ratio = (ghi - net_shortwave) / ghi;
            (ratio.is_finite() && (0.0..=1.0).contains(&ratio)).then_some(ratio)
        };

        let midpoint = current.time - Duration::minutes(30);
        let sun = sun_state(midpoint, latitude, longitude);

        // Direct *normal* irradiance is the horizontal component projected back
        // onto the beam. Near sunset cos(zenith) approaches zero and this
        // division becomes very sensitive; the plane-of-array projection that
        // follows undoes most of it.
        let dni = direct_horizontal / sun.apparent_zenith.to_radians().cos();
        let dhi = ghi - direct_horizontal;

        rows.push((
            RadiationRow {
                time: current.time - Duration::hours(1),
                midpoint,
                sun,
                dni: clip_negative(dni),
                dhi: clip_negative(dhi),
                ghi: clip_negative(ghi),
                albedo: 0.0,
                air_temperature,
                wind,
            },
            albedo,
        ));
    }

    fill_missing_albedo(rows)
}

/// The five differenced or passthrough values an hour needs, or `None` if any is
/// absent from the forecast.
fn hourly_fields(
    previous: &FmiRadiationPoint,
    current: &FmiRadiationPoint,
) -> Option<(f64, f64, f64, f64, f64)> {
    let per_second =
        |now: Option<f64>, before: Option<f64>| Some((now? - before?) / SECONDS_PER_HOUR);

    Some((
        per_second(current.global_accumulation, previous.global_accumulation)?,
        per_second(
            current.net_shortwave_accumulation,
            previous.net_shortwave_accumulation,
        )?,
        per_second(current.direct_accumulation, previous.direct_accumulation)?,
        current.temperature?,
        current.wind_speed?,
    ))
}

/// Substitute the mean of the usable albedo values wherever one was unusable.
///
/// Albedo is only defined while the sun is up — at night both terms of the ratio
/// go to zero — and those hours contribute no ground-reflected irradiance
/// anyway, so the day's average keeps them in the forecast harmlessly.
fn fill_missing_albedo(rows: Vec<(RadiationRow, Option<f64>)>) -> Vec<RadiationRow> {
    let known: Vec<f64> = rows.iter().filter_map(|(_, albedo)| *albedo).collect();
    let mean = if known.is_empty() {
        DEFAULT_ALBEDO
    } else {
        known.iter().sum::<f64>() / known.len() as f64
    };

    rows.into_iter()
        .map(|(row, albedo)| RadiationRow {
            albedo: albedo.unwrap_or(mean),
            ..row
        })
        .collect()
}

/// Fallback for a forecast with no usable albedo at all — bare ground.
const DEFAULT_ALBEDO: f64 = 0.25;

fn clip_negative(value: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        0.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAT: f64 = 60.1576;
    const LON: f64 = 24.8762;

    /// Build a run of hourly forecast points from the irradiance each hour
    /// carries, accumulating as FMI does. `hours[i]` covers the hour ending at
    /// `start_hour + i + 1`, so the first point is the accumulation baseline and
    /// carries no irradiance of its own.
    fn series(start_hour: u32, hours: &[(f64, f64, f64)]) -> Vec<FmiRadiationPoint> {
        let at = |hour: u32| {
            chrono::NaiveDate::from_ymd_opt(2026, 6, 21)
                .unwrap()
                .and_hms_opt(hour, 0, 0)
                .unwrap()
                .and_utc()
        };

        let mut accumulated = (0.0, 0.0, 0.0);
        let mut points = vec![FmiRadiationPoint {
            time: at(start_hour),
            temperature: Some(18.0),
            wind_speed: Some(3.0),
            global_accumulation: Some(0.0),
            net_shortwave_accumulation: Some(0.0),
            direct_accumulation: Some(0.0),
        }];

        for (offset, (ghi, net, direct)) in hours.iter().enumerate() {
            accumulated.0 += ghi * SECONDS_PER_HOUR;
            accumulated.1 += net * SECONDS_PER_HOUR;
            accumulated.2 += direct * SECONDS_PER_HOUR;

            points.push(FmiRadiationPoint {
                time: at(start_hour + offset as u32 + 1),
                temperature: Some(18.0),
                wind_speed: Some(3.0),
                global_accumulation: Some(accumulated.0),
                net_shortwave_accumulation: Some(accumulated.1),
                direct_accumulation: Some(accumulated.2),
            });
        }

        points
    }

    #[test]
    fn labels_the_interval_start_and_samples_the_midpoint() {
        let points = series(11, &[(800.0, 640.0, 600.0)]);

        let rows = rows_from_forecast(&points, LAT, LON);
        assert_eq!(rows.len(), 1);

        let row = &rows[0];
        assert_eq!(row.time.to_rfc3339(), "2026-06-21T11:00:00+00:00");
        assert_eq!(row.midpoint.to_rfc3339(), "2026-06-21T11:30:00+00:00");

        assert!((row.ghi - 800.0).abs() < 1e-9);
        // Net is 80% of global, so a fifth comes back off the ground.
        assert!((row.albedo - 0.2).abs() < 1e-9, "albedo was {}", row.albedo);
        // Diffuse is what is left of global after the direct share.
        assert!((row.dhi - 200.0).abs() < 1e-9);
    }

    #[test]
    fn skips_hours_across_a_gap() {
        let mut points = series(12, &[(800.0, 640.0, 600.0)]);
        // An earlier point with two hours of silence after it.
        points.insert(0, series(9, &[]).remove(0));

        let rows = rows_from_forecast(&points, LAT, LON);
        assert_eq!(
            rows.len(),
            1,
            "only the 12:00->13:00 pair is one hour apart"
        );
        assert_eq!(rows[0].time.to_rfc3339(), "2026-06-21T12:00:00+00:00");
    }

    #[test]
    fn skips_hours_missing_a_field() {
        let mut points = series(11, &[(800.0, 640.0, 600.0)]);
        points[1].wind_speed = None;

        assert!(rows_from_forecast(&points, LAT, LON).is_empty());
    }

    #[test]
    fn dark_hours_inherit_the_mean_albedo() {
        // The first hour is unlit, so its albedo is 0/0; the second is usable.
        let points = series(1, &[(0.0, 0.0, 0.0), (800.0, 640.0, 600.0)]);

        let rows = rows_from_forecast(&points, LAT, LON);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].ghi, 0.0);
        assert!(
            (rows[0].albedo - 0.2).abs() < 1e-9,
            "dark hour takes the mean, got {}",
            rows[0].albedo
        );
    }

    #[test]
    fn falls_back_to_a_default_albedo_when_nothing_is_usable() {
        let points = series(1, &[(0.0, 0.0, 0.0)]);

        let rows = rows_from_forecast(&points, LAT, LON);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].albedo, DEFAULT_ALBEDO);
    }
}
