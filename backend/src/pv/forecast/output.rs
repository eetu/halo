//! DC power output from absorbed irradiance and module temperature.
//!
//! Huld, T., Gottschalg, R., Beyer, H. G. & Topič, M. "Mapping the performance
//! of PV modules, effects of module type and data averaging", Solar Energy 84,
//! 324-338 (2010).

/// Huld coefficients for crystalline silicon.
const K1: f64 = -0.017162;
const K2: f64 = -0.040289;
const K3: f64 = -0.004681;
const K4: f64 = 0.000148;
const K5: f64 = 0.000169;
const K6: f64 = 0.000005;

/// Relative efficiency bounds. The Huld polynomial is fitted over normal
/// operating irradiance and turns negative in near-darkness, so it needs a
/// floor; 0.5 is well above the physical value but only bites where the
/// absolute output is a fraction of a watt.
const MIN_EFFICIENCY: f64 = 0.5;
const MAX_EFFICIENCY: f64 = 1.0;

/// Irradiance below which output is zero — the model takes the log of
/// normalised irradiance, so it needs a positive floor.
const MIN_IRRADIANCE: f64 = 0.1;

/// DC output in watts for a system of `rated_power_kw` at standard conditions.
pub fn output_watts(absorbed_irradiance: f64, module_temperature: f64, rated_power_kw: f64) -> f64 {
    let absorbed_irradiance = absorbed_irradiance.max(0.0);
    if absorbed_irradiance < MIN_IRRADIANCE {
        return 0.0;
    }

    let normalised = absorbed_irradiance / 1000.0;
    let log_normalised = normalised.ln();
    let temperature_delta = module_temperature - 25.0;

    let efficiency = 1.0
        + K1 * log_normalised
        + K2 * log_normalised.powi(2)
        + temperature_delta * (K3 + K4 * log_normalised + K5 * log_normalised.powi(2))
        + K6 * temperature_delta.powi(2);

    let efficiency = efficiency.clamp(MIN_EFFICIENCY, MAX_EFFICIENCY);

    rated_power_kw * 1000.0 * normalised * efficiency
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pv::forecast::test_fixtures::fixtures;

    #[test]
    fn matches_reference_values() {
        for case in fixtures()["huld_output"].as_array().unwrap() {
            let got = output_watts(
                case["absorbed"].as_f64().unwrap(),
                case["module_temp"].as_f64().unwrap(),
                case["rated_kw"].as_f64().unwrap(),
            );
            let expected = case["value"].as_f64().unwrap();
            assert!((got - expected).abs() < 1e-9, "{case}: {got} vs {expected}");
        }
    }

    #[test]
    fn darkness_and_scaling() {
        assert_eq!(output_watts(0.0, 20.0, 4.0), 0.0);
        assert_eq!(output_watts(0.05, 20.0, 4.0), 0.0);

        // Output is linear in the rating.
        let one_kw = output_watts(800.0, 40.0, 1.0);
        let four_kw = output_watts(800.0, 40.0, 4.0);
        assert!((four_kw - 4.0 * one_kw).abs() < 1e-9);
    }

    #[test]
    fn heat_costs_output() {
        assert!(output_watts(900.0, 55.0, 4.0) < output_watts(900.0, 15.0, 4.0));
    }
}
