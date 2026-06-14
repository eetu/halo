use std::collections::BTreeMap;

use chrono::{FixedOffset, Utc};

use super::models::{FmiForecastPoint, FmiObservation, FmiWeatherData};
use crate::weather::models::*;
use crate::weather::sun;

pub struct FmiConverter;

impl FmiConverter {
    pub fn convert(&self, data: &FmiWeatherData, lat: f64, lon: f64) -> WeatherResponse {
        let current = build_current(data, lat, lon);
        let hourly = build_hourly(&data.forecasts);
        let daily = build_daily(&data.forecasts, lat, lon);

        WeatherResponse {
            current,
            hourly,
            daily,
        }
    }
}

fn build_current(data: &FmiWeatherData, lat: f64, lon: f64) -> Option<CurrentWeather> {
    if let Some(obs) = &data.observation {
        let temp = obs.temperature.unwrap_or(0.0);
        let wind = obs.wind_speed.unwrap_or(0.0);
        let (sunrise, sunset) = sun::sunrise_sunset_for_utc_date(lat, lon, &obs.time);

        Some(CurrentWeather {
            time: obs.time.to_rfc3339(),
            temperature: temp,
            temperature_apparent: wind_chill(temp, wind),
            wind_speed: wind,
            wind_gust: obs.wind_gust,
            wind_direction: obs.wind_direction.unwrap_or(0.0),
            humidity: obs.humidity.unwrap_or(0.0),
            precipitation_1h: obs.precipitation_1h.unwrap_or(0.0),
            cloud_cover: obs.cloud_cover,
            pressure: obs.pressure,
            weather_symbol: guess_symbol_from_observation(obs),
            sunrise,
            sunset,
        })
    } else {
        // Fallback to first forecast point
        data.forecasts.first().map(|fc| {
            let temp = fc.temperature.unwrap_or(0.0);
            let wind = fc.wind_speed.unwrap_or(0.0);
            let (sunrise, sunset) = sun::sunrise_sunset_for_utc_date(lat, lon, &fc.time);

            CurrentWeather {
                time: fc.time.to_rfc3339(),
                temperature: temp,
                temperature_apparent: wind_chill(temp, wind),
                wind_speed: wind,
                wind_gust: fc.wind_gust,
                wind_direction: fc.wind_direction.unwrap_or(0.0),
                humidity: fc.humidity.unwrap_or(0.0),
                precipitation_1h: fc.precipitation_1h.unwrap_or(0.0),
                cloud_cover: fc.cloud_cover,
                pressure: None,
                weather_symbol: fc.weather_symbol.unwrap_or(1),
                sunrise,
                sunset,
            }
        })
    }
}

fn build_hourly(forecasts: &[FmiForecastPoint]) -> Vec<HourlyForecast> {
    forecasts
        .iter()
        .map(|fc| {
            let temp = fc.temperature.unwrap_or(0.0);
            let wind = fc.wind_speed.unwrap_or(0.0);
            HourlyForecast {
                time: fc.time.to_rfc3339(),
                temperature: temp,
                temperature_apparent: wind_chill(temp, wind),
                wind_speed: wind,
                wind_gust: fc.wind_gust,
                wind_direction: fc.wind_direction.unwrap_or(0.0),
                humidity: fc.humidity,
                precipitation_1h: fc.precipitation_1h.unwrap_or(0.0),
                cloud_cover: fc.cloud_cover,
                weather_symbol: fc.weather_symbol.unwrap_or(1),
            }
        })
        .collect()
}

fn build_daily(forecasts: &[FmiForecastPoint], lat: f64, lon: f64) -> Vec<DailyForecast> {
    let helsinki = FixedOffset::east_opt(3 * 3600).unwrap();

    // Group forecasts by local date
    let mut by_date: BTreeMap<String, Vec<&FmiForecastPoint>> = BTreeMap::new();
    for fc in forecasts {
        let local = fc.time.with_timezone(&helsinki);
        let date = local.format("%Y-%m-%d").to_string();
        by_date.entry(date).or_default().push(fc);
    }

    by_date
        .into_iter()
        .filter(|(_, points)| points.len() >= 2) // need at least 2 data points for a daily summary
        .map(|(date, points)| {
            let temps: Vec<f64> = points.iter().filter_map(|p| p.temperature).collect();
            let temp_max = temps.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            let temp_min = temps.iter().cloned().fold(f64::INFINITY, f64::min);

            let total_precip: f64 = points.iter().filter_map(|p| p.precipitation_1h).sum();

            let precip_type = determine_precip_type(&points);

            let weather_symbol = most_severe_symbol(&points);

            let naive_date = chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d")
                .unwrap_or_else(|_| Utc::now().date_naive());
            let (sunrise, sunset) = sun::sunrise_sunset(lat, lon, naive_date);

            DailyForecast {
                date,
                temperature_max: temp_max,
                temperature_min: temp_min,
                precipitation: total_precip,
                precipitation_type: precip_type,
                weather_symbol,
                sunrise,
                sunset,
            }
        })
        .collect()
}

fn determine_precip_type(points: &[&FmiForecastPoint]) -> String {
    let mut rain_hours = 0;
    let mut snow_hours = 0;
    let mut sleet_hours = 0;

    for p in points {
        let precip = p.precipitation_1h.unwrap_or(0.0);
        if precip > 0.0 {
            let temp = p.temperature.unwrap_or(0.0);
            if temp > 2.0 {
                rain_hours += 1;
            } else if temp <= 0.0 {
                snow_hours += 1;
            } else {
                sleet_hours += 1;
            }
        }
    }

    if rain_hours + snow_hours + sleet_hours == 0 {
        "none".into()
    } else if snow_hours >= rain_hours && snow_hours >= sleet_hours {
        "snow".into()
    } else if sleet_hours >= rain_hours {
        "sleet".into()
    } else {
        "rain".into()
    }
}

fn most_severe_symbol(points: &[&FmiForecastPoint]) -> i32 {
    // Higher severity order: thunder > heavy precip > precip > fog > cloudy > clear
    points
        .iter()
        .filter_map(|p| p.weather_symbol)
        .max_by_key(|&s| symbol_severity(s))
        .unwrap_or(1)
}

fn symbol_severity(symbol: i32) -> i32 {
    match symbol {
        1 => 0,                      // clear
        2 => 1,                      // partly cloudy
        3 => 2,                      // cloudy
        91 | 92 => 3,                // fog
        21 | 31 | 81 => 4,           // light rain/showers
        41 | 51 => 5,                // light snow
        71 | 73 => 6,                // sleet
        22 | 32 | 82 => 7,           // rain/showers
        42 | 52 | 72 => 8,           // snow/sleet
        23 | 33 | 43 | 53 | 83 => 9, // heavy precip
        61..=64 => 10,               // thunder
        _ => 0,
    }
}

/// Guess a weather symbol from observation data (no WeatherSymbol3 in observations).
fn guess_symbol_from_observation(obs: &FmiObservation) -> i32 {
    let precip = obs.precipitation_1h.unwrap_or(0.0);
    let cloud = obs.cloud_cover; // okta (0-8) from manual observation
    let temp = obs.temperature.unwrap_or(0.0);

    if precip > 2.0 {
        if temp > 2.0 {
            33
        } else if temp <= 0.0 {
            53
        } else {
            73
        }
    } else if precip > 0.0 {
        if temp > 2.0 {
            32
        } else if temp <= 0.0 {
            52
        } else {
            72
        }
    } else if let Some(okta) = cloud {
        if okta <= 1.0 {
            1
        } else if okta <= 4.0 {
            2
        } else {
            3
        }
    } else {
        2 // default to partly cloudy when unknown
    }
}

/// Wind chill calculation (Environment Canada formula).
/// For T < 10C and wind > 0.
fn wind_chill(temp: f64, wind_speed: f64) -> f64 {
    if temp >= 10.0 || wind_speed <= 0.0 {
        return temp;
    }
    let wind_kmh = wind_speed * 3.6;
    if wind_kmh < 4.8 {
        return temp;
    }
    let wc =
        13.12 + 0.6215 * temp - 11.37 * wind_kmh.powf(0.16) + 0.3965 * temp * wind_kmh.powf(0.16);
    // Don't return a value higher than actual temperature
    wc.min(temp)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wind_chill() {
        // At 0C with 20km/h wind (~5.6 m/s), should feel colder
        let wc = wind_chill(0.0, 5.6);
        assert!(wc < 0.0);
        assert!(wc > -10.0);

        // At 15C, no wind chill applied
        assert_eq!(wind_chill(15.0, 5.0), 15.0);

        // No wind, no chill
        assert_eq!(wind_chill(0.0, 0.0), 0.0);
    }

    #[test]
    fn test_determine_precip_type() {
        use super::super::models::FmiForecastPoint;
        use chrono::Utc;

        let now = Utc::now();
        let rain_point = FmiForecastPoint {
            time: now,
            temperature: Some(10.0),
            precipitation_1h: Some(1.0),
            wind_speed: None,
            wind_gust: None,
            wind_direction: None,
            cloud_cover: None,
            humidity: None,
            weather_symbol: None,
        };
        let snow_point = FmiForecastPoint {
            time: now,
            temperature: Some(-5.0),
            precipitation_1h: Some(1.0),
            ..rain_point.clone()
        };

        assert_eq!(determine_precip_type(&[&rain_point]), "rain");
        assert_eq!(determine_precip_type(&[&snow_point]), "snow");
        assert_eq!(
            determine_precip_type(&[&rain_point, &rain_point, &snow_point]),
            "rain"
        );
    }

    #[test]
    fn test_symbol_severity_ordering() {
        assert!(symbol_severity(61) > symbol_severity(33));
        assert!(symbol_severity(33) > symbol_severity(32));
        assert!(symbol_severity(32) > symbol_severity(3));
        assert!(symbol_severity(3) > symbol_severity(1));
    }
}
