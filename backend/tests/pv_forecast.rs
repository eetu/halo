//! End-to-end test of the PV forecast against a mocked FMI WFS response.

use halo_backend::create_test_app_state_with;
use halo_backend::pv::forecast::{self, ArraySpec, ForecastError};
use halo_backend::settings::Settings;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const LAT: f64 = 60.1576;
const LON: f64 = 24.8762;

/// A Harmonie `timevaluepair` response covering `hours` consecutive hours from
/// 09:00 UTC, with radiation accumulating over a plausible summer morning.
fn harmonie_radiation_xml(hours: usize) -> String {
    let mut global = 0.0;
    let mut net = 0.0;
    let mut direct = 0.0;

    let mut series: Vec<(String, Vec<(String, f64)>)> = vec![
        ("Temperature".into(), Vec::new()),
        ("WindSpeedMS".into(), Vec::new()),
        ("RadiationGlobalAccumulation".into(), Vec::new()),
        ("RadiationNetSurfaceSWAccumulation".into(), Vec::new()),
        ("RadiationSWAccumulation".into(), Vec::new()),
    ];

    for hour in 0..hours {
        let time = format!("2026-06-21T{:02}:00:00Z", 9 + hour);

        // Rising through the morning; the first hour is the accumulation
        // baseline and so contributes nothing.
        if hour > 0 {
            let ghi = 300.0 + 100.0 * hour as f64;
            global += ghi * 3600.0;
            net += ghi * 0.82 * 3600.0;
            direct += ghi * 0.7 * 3600.0;
        }

        series[0].1.push((time.clone(), 18.0 + hour as f64));
        series[1].1.push((time.clone(), 3.0));
        series[2].1.push((time.clone(), global));
        series[3].1.push((time.clone(), net));
        series[4].1.push((time, direct));
    }

    let members: String = series
        .iter()
        .map(|(name, points)| {
            let points: String = points
                .iter()
                .map(|(time, value)| {
                    format!(
                        "<wml2:point><wml2:MeasurementTVP>\
                         <wml2:time>{time}</wml2:time>\
                         <wml2:value>{value}</wml2:value>\
                         </wml2:MeasurementTVP></wml2:point>"
                    )
                })
                .collect();

            format!(
                "<wfs:member><omso:PointTimeSeriesObservation><om:result>\
                 <wml2:MeasurementTimeseries gml:id=\"mts-1-1-{name}\">{points}\
                 </wml2:MeasurementTimeseries></om:result>\
                 </omso:PointTimeSeriesObservation></wfs:member>"
            )
        })
        .collect();

    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0"
    xmlns:gml="http://www.opengis.net/gml/3.2"
    xmlns:wml2="http://www.opengis.net/waterml/2.0"
    xmlns:omso="http://inspire.ec.europa.eu/schemas/omso/3.0"
    xmlns:om="http://www.opengis.net/om/2.0">{members}</wfs:FeatureCollection>"#
    )
}

fn settings_for(mock_url: &str) -> Settings {
    Settings {
        pv_array: Some(ArraySpec {
            tilt: 25.0,
            azimuth: 180.0,
            rated_power_kw: 4.0,
        }),
        fmi_base_url: mock_url.into(),
        ..Settings::test_defaults()
    }
}

/// A backend with the array configured and the house position saved.
async fn ready_state(mock_url: &str) -> std::sync::Arc<halo_backend::AppState> {
    let state = create_test_app_state_with(settings_for(mock_url));
    state
        .storage
        .save_settings(&serde_json::json!({ "location": { "lat": LAT, "lon": LON } }).to_string())
        .await
        .expect("settings row is writable");
    state
}

#[actix_web::test]
async fn models_a_forecast_from_the_fmi_response() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/"))
        .respond_with(ResponseTemplate::new(200).set_body_string(harmonie_radiation_xml(6)))
        .mount(&server)
        .await;

    let state = ready_state(&server.uri()).await;
    let forecast = forecast::compute(&state).await.expect("model runs");

    // Six forecast hours difference into five modelled hours.
    assert_eq!(forecast.points.len(), 5);

    // Each point is labelled with the start of the hour it covers, so the first
    // sits at 09:00 even though its accumulation is stamped 10:00.
    assert_eq!(forecast.points[0].time, "2026-06-21T09:00:00Z");
    assert_eq!(forecast.points[4].time, "2026-06-21T13:00:00Z");

    for point in &forecast.points {
        assert!(
            point.output_w.is_finite() && point.output_w >= 0.0,
            "{} output {} is not a usable power",
            point.time,
            point.output_w
        );
        let module_temp = point.module_temp.expect("module temperature is modelled");
        let air_temp = point.temperature.expect("air temperature passes through");
        assert!(module_temp.is_finite());
        assert!(
            module_temp >= air_temp,
            "{}: module at {module_temp} is cooler than the air at {air_temp}",
            point.time
        );
        assert_eq!(point.wind, Some(3.0));
    }

    // A 4 kW array in midsummer sun produces power, and never more than its
    // rating.
    let peak = forecast
        .points
        .iter()
        .map(|p| p.output_w)
        .fold(f64::MIN, f64::max);
    assert!(peak > 100.0, "peak output was only {peak} W");
    assert!(
        peak <= 4000.0,
        "peak output {peak} W exceeds the array rating"
    );
}

#[actix_web::test]
async fn a_forecast_too_short_to_difference_yields_nothing() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/"))
        .respond_with(ResponseTemplate::new(200).set_body_string(harmonie_radiation_xml(1)))
        .mount(&server)
        .await;

    let state = ready_state(&server.uri()).await;
    let forecast = forecast::compute(&state).await.expect("model runs");

    assert!(forecast.points.is_empty());
}

#[actix_web::test]
async fn without_a_house_position_there_is_nothing_to_forecast() {
    let state = create_test_app_state_with(settings_for("http://127.0.0.1:1"));

    let result = forecast::compute(&state).await;

    assert!(
        matches!(result, Err(ForecastError::NoPosition)),
        "expected NoPosition, got {result:?}"
    );
}
