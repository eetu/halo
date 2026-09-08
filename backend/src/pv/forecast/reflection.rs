//! Angular reflection losses at the panel surface. The beam's loss depends on
//! the angle of incidence; the diffuse and ground-reflected components arrive
//! from the whole sky dome and ground plane, so theirs depend only on tilt.
//!
//! Martin, N. & Ruiz, J. M. "Calculation of the PV modules angular losses under
//! field conditions by means of an analytical model", Solar Energy Materials and
//! Solar Cells 70, 25-38 (2001).

use std::f64::consts::PI;

/// Angular-losses coefficient. The paper's average for polycrystalline silicon;
/// better optical coatings lower it, dust raises it.
const REFLECTANCE: f64 = 0.159;

/// Fraction of the direct beam reflected away, in `[0, 1]`.
pub fn beam_reflected(aoi: f64) -> f64 {
    let upper = (-aoi.to_radians().cos() / REFLECTANCE).exp() - (-1.0 / REFLECTANCE).exp();
    let lower = 1.0 - (-1.0 / REFLECTANCE).exp();

    upper / lower
}

/// Fraction of the sky-diffuse irradiance reflected away, in `[0, 1]`.
/// Constant for an installation.
pub fn sky_diffuse_reflected(tilt: f64) -> f64 {
    const C1: f64 = 4.0 / (3.0 * PI);
    const C2: f64 = -0.074;

    let tilt = tilt.to_radians();
    let shape = tilt.sin() + (PI - tilt - tilt.sin()) / (1.0 + tilt.cos());

    ((-1.0 / REFLECTANCE) * (C1 * shape + C2 * shape.powi(2))).exp()
}

/// Fraction of the ground-reflected irradiance reflected away, in `[0, 1]`.
/// Constant for an installation.
pub fn ground_reflected_reflected(tilt: f64) -> f64 {
    const C1: f64 = 4.0 / (3.0 * PI);
    const C2: f64 = -0.074;

    // A horizontal panel sees no ground-reflected light at all, and the shape
    // term divides by 1 - cos(tilt). Returning 1 keeps the absorbed share at
    // zero without dividing by zero.
    if tilt == 0.0 {
        return 1.0;
    }

    let tilt = tilt.to_radians();
    let shape = tilt.sin() + (tilt - tilt.sin()) / (1.0 - tilt.cos());

    ((-1.0 / REFLECTANCE) * (C1 * shape + C2 * shape.powi(2))).exp()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pv::forecast::test_fixtures::fixtures;

    #[test]
    fn diffuse_reflection_matches_reference_values() {
        let reflection = &fixtures()["reflection"];

        for case in reflection["dhi_reflected"].as_array().unwrap() {
            let tilt = case["tilt"].as_f64().unwrap();
            let expected = case["value"].as_f64().unwrap();
            let got = sky_diffuse_reflected(tilt);
            assert!(
                (got - expected).abs() < 1e-12,
                "sky diffuse, tilt {tilt}: {got} vs {expected}"
            );
        }

        for case in reflection["ghi_reflected"].as_array().unwrap() {
            let tilt = case["tilt"].as_f64().unwrap();
            let expected = case["value"].as_f64().unwrap();
            let got = ground_reflected_reflected(tilt);
            assert!(
                (got - expected).abs() < 1e-12,
                "ground reflected, tilt {tilt}: {got} vs {expected}"
            );
        }
    }

    #[test]
    fn beam_reflection_rises_towards_grazing_incidence() {
        assert!(beam_reflected(0.0) < 0.01);
        assert!(beam_reflected(60.0) < beam_reflected(85.0));
        assert!((beam_reflected(90.0) - 1.0).abs() < 1e-12);
    }
}
