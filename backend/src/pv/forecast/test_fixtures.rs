//! Access to the model reference values in `testdata/`.

use std::sync::LazyLock;

use serde_json::Value;

static FIXTURES: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("testdata/pvlib_reference.json"))
        .expect("reference fixtures are valid JSON")
});

/// Site and system the reference values were generated for.
pub const LAT: f64 = 60.1576;
pub const LON: f64 = 24.8762;
pub const TILT: f64 = 25.0;
pub const AZIMUTH: f64 = 180.0;
pub const KW: f64 = 4.0;

pub fn fixtures() -> &'static Value {
    &FIXTURES
}

#[test]
fn constants_match_the_fixture_file() {
    let site = &fixtures()["site"];
    assert_eq!(site["lat"].as_f64().unwrap(), LAT);
    assert_eq!(site["lon"].as_f64().unwrap(), LON);
    assert_eq!(site["tilt"].as_f64().unwrap(), TILT);
    assert_eq!(site["azimuth"].as_f64().unwrap(), AZIMUTH);
    assert_eq!(site["kw"].as_f64().unwrap(), KW);
}
