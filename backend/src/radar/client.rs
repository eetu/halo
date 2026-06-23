use chrono::{DateTime, Duration, Utc};

use super::models::RadarFrames;

/// Fetch the WMS capabilities, read the time dimension for `layer`, and return
/// the most recent `count` frames (ascending). Anchoring on FMI's advertised
/// latest timestamp avoids requesting frames that don't exist yet.
pub async fn fetch_frames(
    client: &reqwest::Client,
    wms_base_url: &str,
    layer: &str,
    count: u32,
) -> Result<RadarFrames, Box<dyn std::error::Error + Send + Sync>> {
    let url = format!("{wms_base_url}?service=WMS&version=1.3.0&request=GetCapabilities");
    let caps = client
        .get(&url)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;

    let (latest, interval) = parse_time_extent(&caps, layer)
        .ok_or_else(|| format!("no time extent for layer {layer}"))?;

    let count = count.max(1) as i64;
    let step = Duration::minutes(interval as i64);
    // Build ascending: oldest first, newest (latest) last.
    let times: Vec<String> = (0..count)
        .rev()
        .map(|i| format_instant(latest - step * i as i32))
        .collect();

    Ok(RadarFrames {
        layer: layer.to_string(),
        times,
        interval_minutes: interval,
    })
}

/// Format as the second-precision UTC instant FMI's WMS accepts, e.g.
/// `2026-06-22T17:50:00Z`.
fn format_instant(t: DateTime<Utc>) -> String {
    t.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// Locate the `<Dimension name="time">…</Dimension>` belonging to `layer` and
/// return its newest instant plus the step in minutes. The extent reads like
/// `2026-06-15T18:00:00.000Z/2026-06-22T17:50:00.000Z/PT5M`.
fn parse_time_extent(caps: &str, layer: &str) -> Option<(DateTime<Utc>, u32)> {
    let name_tag = format!("<Name>{layer}</Name>");
    let name_pos = caps.find(&name_tag)?;
    let after = &caps[name_pos..];

    let dim_pos = after.find("<Dimension name=\"time\"")?;
    let dim = &after[dim_pos..];
    let open_end = dim.find('>')? + 1;
    let close = dim.find("</Dimension>")?;
    let extent = dim[open_end..close].trim();

    // Take the last comma-separated range, then split start/end/period.
    let range = extent.rsplit(',').next()?.trim();
    let mut parts = range.split('/');
    let _start = parts.next()?;
    let end = parts.next()?.trim();
    let period = parts.next().unwrap_or("PT5M").trim();

    let latest = DateTime::parse_from_rfc3339(end).ok()?.with_timezone(&Utc);
    Some((latest, parse_iso_minutes(period)))
}

/// Parse the minute component of an ISO8601 period like `PT5M`. Defaults to 5.
fn parse_iso_minutes(period: &str) -> u32 {
    period
        .strip_prefix("PT")
        .and_then(|p| p.strip_suffix('M'))
        .and_then(|m| m.parse().ok())
        .unwrap_or(5)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CAPS: &str = r#"
        <Layer><Name>Radar:other</Name></Layer>
        <Layer>
          <Name>Radar:suomi_dbz_eureffin</Name>
          <Dimension name="time" default="current" units="ISO8601">2026-06-15T18:00:00.000Z/2026-06-22T17:50:00.000Z/PT5M</Dimension>
        </Layer>
    "#;

    #[test]
    fn parses_latest_and_interval() {
        let (latest, interval) = parse_time_extent(CAPS, "Radar:suomi_dbz_eureffin").unwrap();
        assert_eq!(interval, 5);
        assert_eq!(format_instant(latest), "2026-06-22T17:50:00Z");
    }

    #[test]
    fn frames_are_ascending_ending_at_latest() {
        let (latest, _) = parse_time_extent(CAPS, "Radar:suomi_dbz_eureffin").unwrap();
        let step = Duration::minutes(5);
        let times: Vec<String> = (0..3i64)
            .rev()
            .map(|i| format_instant(latest - step * i as i32))
            .collect();
        assert_eq!(
            times,
            vec![
                "2026-06-22T17:40:00Z",
                "2026-06-22T17:45:00Z",
                "2026-06-22T17:50:00Z",
            ]
        );
    }

    #[test]
    fn missing_layer_returns_none() {
        assert!(parse_time_extent(CAPS, "Radar:nope").is_none());
    }
}
