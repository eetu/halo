use std::collections::BTreeMap;

use chrono::{DateTime, FixedOffset, NaiveDate, Timelike};

use super::models::{HourPrice, SpotEntry, SpotResponse};

pub async fn fetch(
    client: &reqwest::Client,
    base_url: &str,
) -> Result<SpotResponse, reqwest::Error> {
    let url = format!("{}/TodayAndDayForward", base_url.trim_end_matches('/'));
    let entries: Vec<SpotEntry> = client
        .get(&url)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(aggregate(entries))
}

/// Average the 15-min quarters into hourly bars and split into today/tomorrow
/// (the two distinct local dates the upstream returns).
fn aggregate(entries: Vec<SpotEntry>) -> SpotResponse {
    // (local date, hour) -> (price sum, count, hour-start datetime)
    let mut buckets: BTreeMap<(NaiveDate, u32), (f64, u32, DateTime<FixedOffset>)> =
        BTreeMap::new();
    for e in &entries {
        let Ok(dt) = DateTime::parse_from_rfc3339(&e.date_time) else {
            continue;
        };
        let hour_start = dt
            .with_minute(0)
            .and_then(|d| d.with_second(0))
            .and_then(|d| d.with_nanosecond(0))
            .unwrap_or(dt);
        let slot = buckets
            .entry((dt.date_naive(), dt.hour()))
            .or_insert((0.0, 0, hour_start));
        slot.0 += e.price_with_tax;
        slot.1 += 1;
    }

    let mut dates: Vec<NaiveDate> = buckets.keys().map(|(d, _)| *d).collect();
    dates.dedup(); // BTreeMap keys are sorted, so dups are adjacent

    let to_hours = |target: Option<NaiveDate>| -> Vec<HourPrice> {
        let Some(target) = target else {
            return Vec::new();
        };
        buckets
            .iter()
            .filter(|((d, _), _)| *d == target)
            .map(|(_, (sum, count, hour_start))| HourPrice {
                hour: hour_start.to_rfc3339(),
                price: (sum / *count as f64) * 100.0, // €/kWh -> c/kWh
            })
            .collect()
    };

    let today = to_hours(dates.first().copied());
    let tomorrow = to_hours(dates.get(1).copied());
    let today_average = if today.is_empty() {
        0.0
    } else {
        today.iter().map(|h| h.price).sum::<f64>() / today.len() as f64
    };

    SpotResponse {
        unit: "c/kWh".into(),
        today,
        tomorrow,
        today_average,
    }
}
