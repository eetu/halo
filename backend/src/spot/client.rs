use std::collections::BTreeMap;

use chrono::{DateTime, Datelike, Duration, NaiveDate, TimeZone, Timelike, Utc};
use chrono_tz::{Europe::Helsinki, Tz};

use super::models::{HourPrice, NpsEntry, NpsResponse, SpotResponse};

/// Finnish electricity VAT (25.5%). Elering prices are ex-VAT; we display the
/// consumer price like the price apps do.
const VAT: f64 = 1.255;

/// Minimum hours before tomorrow counts as "published" — until the day-ahead
/// auction lands (~14:00) Elering returns only an hour or two of tomorrow, and a
/// lone bar isn't worth a chart (the frontend shows a placeholder instead).
const MIN_TOMORROW_HOURS: usize = 20;

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
    Ok(aggregate(resp.data.fi, now.date_naive()))
}

/// Average the 15-min entries into hourly bars (in Helsinki local time), keyed to
/// the real local dates so today/tomorrow don't drift; convert EUR/MWh ex-VAT →
/// c/kWh incl. VAT. Tomorrow is dropped until it's a near-complete published day,
/// so a lone post-midnight bar doesn't spill into the tomorrow chart.
fn aggregate(entries: Vec<NpsEntry>, today: NaiveDate) -> SpotResponse {
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

    let hours_for = |date: NaiveDate| -> Vec<HourPrice> {
        buckets
            .iter()
            .filter(|((d, _), _)| *d == date)
            .map(|(_, (sum, count, hour_start))| HourPrice {
                hour: hour_start.to_rfc3339(),
                price: (sum / *count as f64) / 10.0 * VAT, // EUR/MWh ex-VAT -> c/kWh incl VAT
            })
            .collect()
    };

    let today_v = hours_for(today);
    let tomorrow_v = today
        .succ_opt()
        .map(hours_for)
        .filter(|h| h.len() >= MIN_TOMORROW_HOURS)
        .unwrap_or_default();
    let today_average = if today_v.is_empty() {
        0.0
    } else {
        today_v.iter().map(|h| h.price).sum::<f64>() / today_v.len() as f64
    };

    SpotResponse {
        unit: "c/kWh".into(),
        today: today_v,
        tomorrow: tomorrow_v,
        today_average,
    }
}
