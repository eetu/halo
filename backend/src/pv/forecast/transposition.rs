//! Projection of the irradiance components onto the plane of the array.
//!
//! Beam and ground reflection are geometry. The diffuse component uses
//! Perez-Driesse: the 1990 Perez model with its look-up table of sky-condition
//! coefficients replaced by quadratic splines, making it continuous.
//!
//! Perez, R. et al. "Modeling daylight availability and irradiance components
//! from direct and global irradiance", Solar Energy 44, 271-289 (1990).
//! Driesse, A. et al. "Improving Common Irradiance Transposition Models",
//! PVSC 2024.

use super::solar::{aoi_projection, SunState, AIRMASS_AT_HORIZON};

/// Knot vector of the quadratic splines, clamped at both ends.
const KNOTS: [f64; 13] = [
    0.000, 0.000, 0.000, 0.061, 0.187, 0.333, 0.487, 0.643, 0.778, 0.839, 1.000, 1.000, 1.000,
];

/// Spline control points. Column `(i - 1) * 3 + (j - 1)` holds the curve for
/// coefficient `F(i, j)`; the trailing zero rows are knot-vector padding and are
/// never read.
const COEFFICIENTS: [[f64; 6]; 13] = [
    [-0.053, 0.529, -0.028, -0.071, 0.061, -0.019],
    [-0.008, 0.588, -0.062, -0.060, 0.072, -0.022],
    [0.131, 0.770, -0.167, -0.026, 0.106, -0.032],
    [0.328, 0.471, -0.216, 0.069, -0.105, -0.028],
    [0.557, 0.241, -0.300, 0.086, -0.085, -0.012],
    [0.861, -0.323, -0.355, 0.240, -0.467, -0.008],
    [1.212, -1.239, -0.444, 0.305, -0.797, 0.047],
    [1.099, -1.847, -0.365, 0.275, -1.132, 0.124],
    [0.544, 0.157, -0.213, 0.118, -1.455, 0.292],
    [0.544, 0.157, -0.213, 0.118, -1.455, 0.292],
    [0.000, 0.000, 0.000, 0.000, 0.000, 0.000],
    [0.000, 0.000, 0.000, 0.000, 0.000, 0.000],
    [0.000, 0.000, 0.000, 0.000, 0.000, 0.000],
];

const DEGREE: usize = 2;
/// Number of basis functions: `KNOTS.len() - DEGREE - 1`.
const BASIS_COUNT: usize = 10;

/// Evaluate the quadratic spline of column `column` at `zeta`, by de Boor's
/// algorithm.
fn spline(column: usize, zeta: f64) -> f64 {
    let zeta = zeta.clamp(KNOTS[DEGREE], KNOTS[BASIS_COUNT]);

    // Knot interval containing zeta. The last interval owns the right endpoint.
    let mut interval = BASIS_COUNT - 1;
    for candidate in DEGREE..BASIS_COUNT {
        if zeta < KNOTS[candidate + 1] {
            interval = candidate;
            break;
        }
    }

    let mut points = [0.0_f64; DEGREE + 1];
    for (offset, point) in points.iter_mut().enumerate() {
        *point = COEFFICIENTS[offset + interval - DEGREE][column];
    }

    for round in 1..=DEGREE {
        for j in (round..=DEGREE).rev() {
            let left = KNOTS[j + interval - DEGREE];
            let right = KNOTS[j + 1 + interval - round];
            let alpha = (zeta - left) / (right - left);
            points[j] = (1.0 - alpha) * points[j - 1] + alpha * points[j];
        }
    }

    points[DEGREE]
}

/// Sky-dome brightness. Airmass is held at its horizon value once the sun is
/// down, keeping the coefficients finite through dusk.
fn brightness(dhi: f64, dni_extra: f64, apparent_zenith: f64, airmass: Option<f64>) -> f64 {
    let airmass = if apparent_zenith >= 90.0 {
        AIRMASS_AT_HORIZON
    } else {
        airmass.unwrap_or(AIRMASS_AT_HORIZON)
    };

    dhi / (dni_extra / airmass)
}

/// Sky-dome clearness, with the Perez-Driesse zenith correction.
fn clearness(dhi: f64, dni: f64, apparent_zenith: f64) -> f64 {
    const KAPPA: f64 = 1.041;

    let zeta = if dhi == 0.0 { 0.0 } else { dni / (dhi + dni) };
    let kappa_term = KAPPA * apparent_zenith.to_radians().powi(3);

    zeta / (1.0 - kappa_term * (zeta - 1.0))
}

/// Diffuse sky irradiance on the tilted plane, W/m².
pub fn sky_diffuse(tilt: f64, surface_azimuth: f64, dhi: f64, dni: f64, sun: &SunState) -> f64 {
    let apparent_zenith = sun.apparent_zenith;
    let delta = brightness(dhi, sun.extraterrestrial_dni, apparent_zenith, sun.airmass);
    let zeta = clearness(dhi, dni, apparent_zenith);
    let zenith_rad = apparent_zenith.to_radians();

    // Circumsolar and horizon-brightening coefficients.
    let f1 =
        (spline(0, zeta) + spline(1, zeta) * delta + spline(2, zeta) * zenith_rad).clamp(0.0, 0.9);
    let f2 = spline(3, zeta) + spline(4, zeta) * delta + spline(5, zeta) * zenith_rad;

    let projection = aoi_projection(tilt, surface_azimuth, apparent_zenith, sun.azimuth).max(0.0);
    let zenith_cosine = zenith_rad.cos().max(85.0_f64.to_radians().cos());

    let isotropic = 0.5 * (1.0 - f1) * (1.0 + tilt.to_radians().cos());
    let circumsolar = f1 * projection / zenith_cosine;
    let horizon = f2 * tilt.to_radians().sin();

    (dhi * (isotropic + circumsolar + horizon)).max(0.0)
}

/// Direct beam irradiance on the tilted plane, W/m².
pub fn beam(dni: f64, aoi: f64) -> f64 {
    (dni * aoi.to_radians().cos()).abs()
}

/// Ground-reflected irradiance on the tilted plane, W/m².
///
/// Zero for a horizontal panel, rising with tilt as more of the ground enters
/// the panel's field of view.
pub fn ground_reflected(ghi: f64, tilt: f64, albedo: f64) -> f64 {
    ghi * albedo * (1.0 - tilt.to_radians().cos()) / 2.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pv::forecast::test_fixtures::fixtures;

    #[test]
    fn splines_match_reference_values() {
        for case in fixtures()["perez_spline"].as_array().unwrap() {
            let zeta = case["zeta"].as_f64().unwrap();
            let expected = case["f"].as_array().unwrap();

            for (column, want) in expected.iter().enumerate() {
                let want = want.as_f64().unwrap();
                let got = spline(column, zeta);
                assert!(
                    (got - want).abs() < 1e-9,
                    "zeta {zeta} column {column}: {got} vs {want}"
                );
            }
        }
    }

    #[test]
    fn sky_diffuse_matches_reference_values() {
        for case in fixtures()["perez_driesse"].as_array().unwrap() {
            let expected = case["sky_diffuse"].as_f64().unwrap();
            let sun = SunState {
                apparent_zenith: case["zenith"].as_f64().unwrap(),
                azimuth: case["solar_azimuth"].as_f64().unwrap(),
                airmass: case["airmass"].as_f64(),
                extraterrestrial_dni: case["dni_extra"].as_f64().unwrap(),
            };
            let got = sky_diffuse(
                case["tilt"].as_f64().unwrap(),
                case["surface_azimuth"].as_f64().unwrap(),
                case["dhi"].as_f64().unwrap(),
                case["dni"].as_f64().unwrap(),
                &sun,
            );

            assert!(
                (got - expected).abs() < 1e-9,
                "zenith {} tilt {} dhi {} dni {}: {got} vs {expected}",
                case["zenith"],
                case["tilt"],
                case["dhi"],
                case["dni"]
            );
        }
    }

    #[test]
    fn ground_reflection_vanishes_for_a_flat_panel() {
        assert_eq!(ground_reflected(800.0, 0.0, 0.2), 0.0);
        assert!(ground_reflected(800.0, 90.0, 0.2) > 0.0);
    }
}
