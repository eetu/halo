//! Panel temperature from absorbed irradiance, wind and air temperature.
//!
//! King, D., Kratochvil, J. & Boyson, W. "Photovoltaic Array Performance Model",
//! Sandia National Laboratories, SAND2004-3535 (2004).

/// Empirical coefficients for a glass/cell/polymer module mounted open-rack.
const COEFFICIENT_A: f64 = -3.47;
const COEFFICIENT_B: f64 = -0.0594;

/// Module temperature in °C.
///
/// `wind` is the forecast speed at the standard 10 m; it is scaled down to
/// `module_elevation` by the usual power law, so a sheltered installation can be
/// modelled by declaring a lower height than the real one.
pub fn module_temperature(
    absorbed_irradiance: f64,
    wind: f64,
    module_elevation: f64,
    air_temperature: f64,
) -> f64 {
    let wind_at_module = wind * (module_elevation / 10.0).powf(0.1429);

    absorbed_irradiance * std::f64::consts::E.powf(COEFFICIENT_A + COEFFICIENT_B * wind_at_module)
        + air_temperature
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pv::forecast::test_fixtures::fixtures;

    #[test]
    fn matches_reference_values() {
        for case in fixtures()["module_temp"].as_array().unwrap() {
            let got = module_temperature(
                case["absorbed"].as_f64().unwrap(),
                case["wind"].as_f64().unwrap(),
                case["elevation"].as_f64().unwrap(),
                case["air_temp"].as_f64().unwrap(),
            );
            let expected = case["value"].as_f64().unwrap();
            assert!((got - expected).abs() < 1e-9, "{case}: {got} vs {expected}");
        }
    }

    #[test]
    fn wind_cools_the_module() {
        let calm = module_temperature(800.0, 0.5, 7.0, 20.0);
        let breezy = module_temperature(800.0, 8.0, 7.0, 20.0);
        assert!(breezy < calm);
        // With no sun the module sits at air temperature.
        assert_eq!(module_temperature(0.0, 3.0, 7.0, -5.0), -5.0);
    }
}
