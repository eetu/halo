use std::collections::BTreeMap;

use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Timelike, Utc};
use chrono_tz::{Europe::Helsinki, Tz};

use super::models::{HourPrice, NpsEntry, NpsResponse, SpotResponse};

/// Finnish electricity VAT (25.5%). Elering prices are ex-VAT; we display the
/// consumer price like the price apps do.
const VAT: f64 = 1.255;

/// Fetch today + tomorrow Finnish prices straight from the TSO-grade open source
/// (Elering LIVE, Nord Pool day-ahead). API: <https://dashboard.elering.ee/api>
pub async fn fetch(
    client: &reqwest::Client,
    base_url: &str,
) -> Result<SpotResponse, reqwest::Error> {
    // Window the query to [today 00:00, +2 days) in Helsinki time so the day
    // split lines up with the local day, regardless of the server timezone.
    let now = Utc::now().with_timezone(&Helsinki);
    let start = Helsinki
        .with_ymd_and_hms(now.year(), now.month(), now.day(), 0, 0, 0)
        .single()
        .unwrap_or(now);
    let end = start + Duration::days(2);
    let iso = |d: DateTime<Tz>| {
        d.with_timezone(&Utc)
            .format("%Y-%m-%dT%H:%M:%S.000Z")
            .to_string()
    };
    let url = format!(
        "{}/api/nps/price?start={}&end={}",
        base_url.trim_end_matches('/'),
        iso(start),
        iso(end),
    );

    let resp: NpsResponse = client
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    Ok(aggregate(resp.data.fi))
}

/// Average the 15-min entries into hourly bars (in Helsinki local time) and split
/// into today/tomorrow; convert EUR/MWh ex-VAT → c/kWh incl. VAT.
fn aggregate(entries: Vec<NpsEntry>) -> SpotResponse {
    // (local date, hour) -> (price sum, count, hour-start datetime)
    let mut buckets: BTreeMap<(NaiveDate, u32), (f64, u32, DateTime<Tz>)> = BTreeMap::new();
    for e in &entries {
        let Some(utc) = Utc.timestamp_opt(e.timestamp, 0).single() else {
            continue;
        };
        let dt = utc.with_timezone(&Helsinki);
        let hour_start = dt
            .with_minute(0)
            .and_then(|d| d.with_second(0))
            .and_then(|d| d.with_nanosecond(0))
            .unwrap_or(dt);
        let slot = buckets
            .entry((dt.date_naive(), dt.hour()))
            .or_insert((0.0, 0, hour_start));
        slot.0 += e.price;
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
                price: (sum / *count as f64) / 10.0 * VAT, // EUR/MWh ex-VAT -> c/kWh incl VAT
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
