use chrono::{DateTime, FixedOffset, NaiveDate, Utc};

const HELSINKI_OFFSET: i32 = 3 * 3600; // EEST (+03:00)

pub fn sunrise_sunset(lat: f64, lon: f64, date: NaiveDate) -> (String, String) {
    let helsinki = FixedOffset::east_opt(HELSINKI_OFFSET).unwrap();

    // Get unix timestamp at noon on the given date (to anchor the calculation)
    let noon = date
        .and_hms_opt(12, 0, 0)
        .unwrap()
        .and_local_timezone(helsinki)
        .single()
        .unwrap_or_else(|| Utc::now().with_timezone(&helsinki));
    let noon_ms = noon.timestamp_millis();

    let sunrise_ms = sun::time_at_phase(noon_ms, sun::SunPhase::Sunrise, lat, lon, 0.0);
    let sunset_ms = sun::time_at_phase(noon_ms, sun::SunPhase::Sunset, lat, lon, 0.0);

    let format_ms = |ms: i64| -> String {
        DateTime::from_timestamp_millis(ms)
            .map(|dt| dt.with_timezone(&helsinki).to_rfc3339())
            .unwrap_or_default()
    };

    (format_ms(sunrise_ms), format_ms(sunset_ms))
}

pub fn sunrise_sunset_for_utc_date(lat: f64, lon: f64, dt: &DateTime<Utc>) -> (String, String) {
    let helsinki = FixedOffset::east_opt(HELSINKI_OFFSET).unwrap();
    let local = dt.with_timezone(&helsinki);
    sunrise_sunset(lat, lon, local.date_naive())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sunrise_sunset_helsinki() {
        let date = NaiveDate::from_ymd_opt(2026, 6, 21).unwrap();
        let (sunrise, sunset) = sunrise_sunset(60.17, 24.94, date);
        assert!(!sunrise.is_empty());
        assert!(!sunset.is_empty());
    }
}
