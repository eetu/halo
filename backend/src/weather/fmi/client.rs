use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use quick_xml::events::Event;
use quick_xml::reader::Reader;

use super::models::{FmiForecastPoint, FmiObservation, FmiWeatherData};

#[derive(Debug, thiserror::Error)]
pub enum FmiError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("XML parse error: {0}")]
    Xml(String),
}

type TimeSeries = BTreeMap<DateTime<Utc>, f64>;
type ParameterMap = BTreeMap<String, TimeSeries>;

/// Fetch current weather observation from nearest station.
pub async fn fetch_observation(
    client: &reqwest::Client,
    base_url: &str,
    lat: &str,
    lon: &str,
) -> Result<Option<FmiObservation>, FmiError> {
    let url = format!(
        "{base_url}?service=WFS&version=2.0.0&request=getFeature\
         &storedquery_id=fmi::observations::weather::timevaluepair\
         &latlon={lat},{lon}\
         &parameters=t2m,ws_10min,wg_10min,wd_10min,rh,r_1h,n_man,p_sea\
         &timestep=10&maxlocations=1"
    );

    let xml = client.get(&url).send().await?.text().await?;
    let params = parse_timeseries_xml(&xml)?;

    // Find the latest timestamp that has at least temperature
    let all_times: Vec<&DateTime<Utc>> = params.values().flat_map(|ts| ts.keys()).collect();

    let latest = match all_times.into_iter().max() {
        Some(t) => *t,
        None => return Ok(None),
    };

    Ok(Some(FmiObservation {
        time: latest,
        temperature: get_val(&params, "t2m", &latest),
        wind_speed: get_val(&params, "ws_10min", &latest),
        wind_gust: get_val(&params, "wg_10min", &latest),
        wind_direction: get_val(&params, "wd_10min", &latest),
        humidity: get_val(&params, "rh", &latest),
        precipitation_1h: get_val(&params, "r_1h", &latest),
        cloud_cover: get_val(&params, "n_man", &latest),
        pressure: get_val(&params, "p_sea", &latest),
    }))
}

/// Fetch Harmonie high-resolution forecast (~50 hours).
pub async fn fetch_harmonie(
    client: &reqwest::Client,
    base_url: &str,
    lat: &str,
    lon: &str,
) -> Result<Vec<FmiForecastPoint>, FmiError> {
    let url = format!(
        "{base_url}?service=WFS&version=2.0.0&request=getFeature\
         &storedquery_id=fmi::forecast::harmonie::surface::point::timevaluepair\
         &latlon={lat},{lon}\
         &parameters=Temperature,WindSpeedMS,WindGust,WindDirection,Precipitation1h,TotalCloudCover,Humidity,WeatherSymbol3\
         &timestep=60"
    );

    let xml = client.get(&url).send().await?.text().await?;
    let params = parse_timeseries_xml(&xml)?;

    let times = collect_times(&params);
    Ok(times
        .into_iter()
        .filter(|t| get_val(&params, "Temperature", t).is_some())
        .map(|t| FmiForecastPoint {
            time: t,
            temperature: get_val(&params, "Temperature", &t),
            wind_speed: get_val(&params, "WindSpeedMS", &t),
            wind_gust: get_val(&params, "WindGust", &t),
            wind_direction: get_val(&params, "WindDirection", &t),
            precipitation_1h: get_val(&params, "Precipitation1h", &t),
            cloud_cover: get_val(&params, "TotalCloudCover", &t),
            humidity: get_val(&params, "Humidity", &t),
            weather_symbol: get_val(&params, "WeatherSymbol3", &t).map(|v| v as i32),
        })
        .collect())
}

/// Fetch ECMWF extended forecast (up to 10 days, partial data).
pub async fn fetch_ecmwf(
    client: &reqwest::Client,
    base_url: &str,
    lat: &str,
    lon: &str,
) -> Result<Vec<FmiForecastPoint>, FmiError> {
    // ECMWF defaults to a short range — explicitly request 10 days ahead
    let end = (chrono::Utc::now() + chrono::Duration::days(10)).format("%Y-%m-%dT00:00:00Z");
    let url = format!(
        "{base_url}?service=WFS&version=2.0.0&request=getFeature\
         &storedquery_id=ecmwf::forecast::surface::point::timevaluepair\
         &latlon={lat},{lon}\
         &parameters=Temperature,Precipitation1h,Humidity,WindUMS,WindVMS\
         &timestep=180\
         &endtime={end}"
    );

    let xml = client.get(&url).send().await?.text().await?;
    let params = parse_timeseries_xml(&xml)?;

    let times = collect_times(&params);
    Ok(times
        .into_iter()
        .filter(|t| get_val(&params, "Temperature", t).is_some())
        .map(|t| {
            let u = get_val(&params, "WindUMS", &t);
            let v = get_val(&params, "WindVMS", &t);
            let (wind_speed, wind_direction) = compute_wind_from_uv(u, v);

            let temp = get_val(&params, "Temperature", &t);
            let precip = get_val(&params, "Precipitation1h", &t);
            let humidity = get_val(&params, "Humidity", &t);

            FmiForecastPoint {
                time: t,
                temperature: temp,
                wind_speed,
                wind_gust: None,
                wind_direction,
                precipitation_1h: precip,
                cloud_cover: None,
                humidity,
                weather_symbol: Some(infer_weather_symbol(temp, precip, humidity)),
            }
        })
        .collect())
}

/// Fetch all sources in parallel and merge.
pub async fn fetch_all(
    client: &reqwest::Client,
    base_url: &str,
    lat: &str,
    lon: &str,
) -> Result<FmiWeatherData, FmiError> {
    let (obs_result, harmonie, ecmwf) = tokio::join!(
        fetch_observation(client, base_url, lat, lon),
        fetch_harmonie(client, base_url, lat, lon),
        fetch_ecmwf(client, base_url, lat, lon),
    );

    // Observation failure is non-fatal
    let observation = obs_result.unwrap_or_else(|e| {
        tracing::warn!("Failed to fetch FMI observations: {e}");
        None
    });

    let harmonie = harmonie?;
    let ecmwf = ecmwf.unwrap_or_else(|e| {
        tracing::warn!("Failed to fetch ECMWF forecast: {e}");
        Vec::new()
    });

    // Merge: Harmonie takes priority, ECMWF fills the gap
    let mut merged: BTreeMap<DateTime<Utc>, FmiForecastPoint> = BTreeMap::new();
    for point in ecmwf {
        merged.insert(point.time, point);
    }
    for point in harmonie {
        merged.insert(point.time, point);
    }

    Ok(FmiWeatherData {
        observation,
        forecasts: merged.into_values().collect(),
    })
}

/// Parse FMI WFS timevaluepair XML into a map of parameter name → time series.
fn parse_timeseries_xml(xml: &str) -> Result<ParameterMap, FmiError> {
    let mut reader = Reader::from_str(xml);
    let mut params: ParameterMap = BTreeMap::new();

    let mut current_param: Option<String> = None;
    let mut current_time: Option<String> = None;
    let mut in_time = false;
    let mut in_value = false;
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) | Ok(Event::Empty(ref e)) => {
                let ln = e.local_name();
                let local_name = std::str::from_utf8(ln.as_ref()).unwrap_or_default();
                match local_name {
                    "MeasurementTimeseries" => {
                        for attr in e.attributes().flatten() {
                            let kn = attr.key.local_name();
                            let key = std::str::from_utf8(kn.as_ref()).unwrap_or_default();
                            if key == "id" {
                                let id = std::str::from_utf8(&attr.value).unwrap_or_default();
                                if let Some(name) = extract_param_name(id) {
                                    current_param = Some(name);
                                }
                            }
                        }
                    }
                    "time" => in_time = true,
                    "value" => in_value = true,
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                let ln = e.local_name();
                let local_name = std::str::from_utf8(ln.as_ref()).unwrap_or_default();
                match local_name {
                    "MeasurementTimeseries" => {
                        current_param = None;
                    }
                    "time" => in_time = false,
                    "value" => in_value = false,
                    "MeasurementTVP" => {
                        current_time = None;
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(ref e)) => {
                if let Ok(text) = std::str::from_utf8(e.as_ref()) {
                    let text = text.trim().to_string();
                    if in_time {
                        current_time = Some(text);
                    } else if in_value {
                        if let (Some(param), Some(time_str)) = (&current_param, &current_time) {
                            if text != "NaN" {
                                if let (Ok(time), Ok(val)) =
                                    (time_str.parse::<DateTime<Utc>>(), text.parse::<f64>())
                                {
                                    params.entry(param.clone()).or_default().insert(time, val);
                                }
                            }
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(FmiError::Xml(format!("XML parse error: {e}"))),
            _ => {}
        }
        buf.clear();
    }

    Ok(params)
}

/// Extract parameter name from gml:id like "obs-obs-1-1-t2m" or "mts-1-1-Temperature"
fn extract_param_name(id: &str) -> Option<String> {
    // Find the last segment that is not purely numeric
    let parts: Vec<&str> = id.split('-').collect();
    parts
        .iter()
        .rev()
        .find(|p| !p.is_empty() && !p.chars().all(|c| c.is_ascii_digit()))
        .map(|s| s.to_string())
}

fn get_val(params: &ParameterMap, name: &str, time: &DateTime<Utc>) -> Option<f64> {
    params.get(name)?.get(time).copied()
}

fn collect_times(params: &ParameterMap) -> Vec<DateTime<Utc>> {
    let mut times: Vec<DateTime<Utc>> = params.values().flat_map(|ts| ts.keys().copied()).collect();
    times.sort();
    times.dedup();
    times
}

fn compute_wind_from_uv(u: Option<f64>, v: Option<f64>) -> (Option<f64>, Option<f64>) {
    match (u, v) {
        (Some(u), Some(v)) => {
            let speed = (u * u + v * v).sqrt();
            let dir = ((-u).atan2(-v).to_degrees() + 360.0) % 360.0;
            (Some(speed), Some(dir))
        }
        _ => (None, None),
    }
}

/// Infer weather symbol from available ECMWF data when WeatherSymbol3 is not available.
fn infer_weather_symbol(temp: Option<f64>, precip: Option<f64>, humidity: Option<f64>) -> i32 {
    let temp = temp.unwrap_or(0.0);
    let precip = precip.unwrap_or(0.0);
    let humidity = humidity.unwrap_or(50.0);

    if precip > 2.0 {
        if temp > 2.0 {
            33 // heavy rain
        } else if temp <= 0.0 {
            53 // heavy snow
        } else {
            73 // heavy sleet
        }
    } else if precip > 0.0 {
        if temp > 2.0 {
            32 // rain
        } else if temp <= 0.0 {
            52 // snow
        } else {
            72 // sleet
        }
    } else if humidity > 95.0 {
        91 // fog
    } else if humidity > 80.0 {
        3 // cloudy
    } else if humidity > 50.0 {
        2 // partly cloudy
    } else {
        1 // clear
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_param_name() {
        assert_eq!(extract_param_name("obs-obs-1-1-t2m"), Some("t2m".into()));
        assert_eq!(
            extract_param_name("mts-1-1-Temperature"),
            Some("Temperature".into())
        );
        assert_eq!(
            extract_param_name("mts-1-1-WindSpeedMS"),
            Some("WindSpeedMS".into())
        );
        assert_eq!(
            extract_param_name("obs-obs-1-1-ws_10min"),
            Some("ws_10min".into())
        );
    }

    #[test]
    fn test_compute_wind_from_uv() {
        let (speed, dir) = compute_wind_from_uv(Some(0.0), Some(-5.0));
        assert!((speed.unwrap() - 5.0).abs() < 0.01);
        assert!((dir.unwrap() - 0.0).abs() < 1.0); // north wind

        let (speed, dir) = compute_wind_from_uv(Some(-5.0), Some(0.0));
        assert!((speed.unwrap() - 5.0).abs() < 0.01);
        assert!((dir.unwrap() - 90.0).abs() < 1.0); // east wind

        assert_eq!(compute_wind_from_uv(None, Some(5.0)), (None, None));
    }

    #[test]
    fn test_infer_weather_symbol() {
        assert_eq!(infer_weather_symbol(Some(20.0), Some(0.0), Some(30.0)), 1); // clear
        assert_eq!(infer_weather_symbol(Some(20.0), Some(0.0), Some(60.0)), 2); // partly cloudy
        assert_eq!(infer_weather_symbol(Some(20.0), Some(0.0), Some(85.0)), 3); // cloudy
        assert_eq!(infer_weather_symbol(Some(20.0), Some(0.0), Some(98.0)), 91); // fog
        assert_eq!(infer_weather_symbol(Some(10.0), Some(1.0), Some(80.0)), 32); // rain
        assert_eq!(infer_weather_symbol(Some(-5.0), Some(1.0), Some(80.0)), 52); // snow
        assert_eq!(infer_weather_symbol(Some(1.0), Some(1.0), Some(80.0)), 72); // sleet
        assert_eq!(infer_weather_symbol(Some(10.0), Some(5.0), Some(80.0)), 33);
        // heavy rain
    }

    #[test]
    fn test_parse_timeseries_xml() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0"
    xmlns:gml="http://www.opengis.net/gml/3.2"
    xmlns:wml2="http://www.opengis.net/waterml/2.0"
    xmlns:omso="http://inspire.ec.europa.eu/schemas/omso/3.0"
    xmlns:om="http://www.opengis.net/om/2.0">
  <wfs:member>
    <omso:PointTimeSeriesObservation>
      <om:result>
        <wml2:MeasurementTimeseries gml:id="obs-obs-1-1-t2m">
          <wml2:point>
            <wml2:MeasurementTVP>
              <wml2:time>2024-01-15T12:00:00Z</wml2:time>
              <wml2:value>-5.2</wml2:value>
            </wml2:MeasurementTVP>
          </wml2:point>
          <wml2:point>
            <wml2:MeasurementTVP>
              <wml2:time>2024-01-15T13:00:00Z</wml2:time>
              <wml2:value>-4.8</wml2:value>
            </wml2:MeasurementTVP>
          </wml2:point>
        </wml2:MeasurementTimeseries>
      </om:result>
    </omso:PointTimeSeriesObservation>
  </wfs:member>
  <wfs:member>
    <omso:PointTimeSeriesObservation>
      <om:result>
        <wml2:MeasurementTimeseries gml:id="obs-obs-1-1-ws_10min">
          <wml2:point>
            <wml2:MeasurementTVP>
              <wml2:time>2024-01-15T12:00:00Z</wml2:time>
              <wml2:value>3.5</wml2:value>
            </wml2:MeasurementTVP>
          </wml2:point>
          <wml2:point>
            <wml2:MeasurementTVP>
              <wml2:time>2024-01-15T13:00:00Z</wml2:time>
              <wml2:value>NaN</wml2:value>
            </wml2:MeasurementTVP>
          </wml2:point>
        </wml2:MeasurementTimeseries>
      </om:result>
    </omso:PointTimeSeriesObservation>
  </wfs:member>
</wfs:FeatureCollection>"#;

        let params = parse_timeseries_xml(xml).unwrap();

        // t2m should have 2 values
        assert_eq!(params["t2m"].len(), 2);
        let t1: DateTime<Utc> = "2024-01-15T12:00:00Z".parse().unwrap();
        let t2: DateTime<Utc> = "2024-01-15T13:00:00Z".parse().unwrap();
        assert_eq!(params["t2m"][&t1], -5.2);
        assert_eq!(params["t2m"][&t2], -4.8);

        // ws_10min should have 1 value (NaN filtered out)
        assert_eq!(params["ws_10min"].len(), 1);
        assert_eq!(params["ws_10min"][&t1], 3.5);
    }
}
