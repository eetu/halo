use std::io::Cursor;

use chrono::{DateTime, Duration, Timelike, Utc};
use grib::Grib2SubmessageDecoder;

use super::models::{ForecastFrame, PrecipForecast};

/// FMI HARMONIE Scandinavia surface producer (hourly precipitation forecast).
const PRODUCER: &str = "harmonie_scandinavia_surface";
/// Half-extent of the requested area around the location, in degrees. Sized to
/// cover southern Finland (centred on the saved location). Whole-Finland would
/// need tiling — a single lat/lon overlay misregisters over a tall span.
const HALF_LON: f64 = 4.5;
const HALF_LAT: f64 = 1.7;
/// Cap on the resampled grid's longest side. High enough to keep ~native
/// (~2.5 km) detail across the southern-Finland box; values are rounded to
/// 0.1 mm so the payload stays modest.
const MAX_GRID_SIDE: usize = 400;
/// FMI's GRIB `Precipitation1h` is in metres of water; the rest of the app
/// (and FMI's own WFS) speaks millimetres.
const MM_PER_METRE: f32 = 1000.0;

type BoxErr = Box<dyn std::error::Error + Send + Sync>;

/// Regular lat/lon grid geometry, read straight from the GRIB2 grid-definition
/// section (template 3.0) so we don't need PROJ.
struct GridGeom {
    ni: usize,
    nj: usize,
    south: f64,
    west: f64,
    north: f64,
    east: f64,
    /// True when i (longitude) scans west→east.
    i_pos: bool,
    /// True when j (latitude) scans south→north.
    j_pos: bool,
}

/// Fetch + decode, retrying transient upstream failures (FMI occasionally drops
/// the connection mid-response → `hyper IncompleteMessage`, or briefly serves an
/// XML error instead of GRIB).
pub async fn fetch_forecast(
    client: &reqwest::Client,
    download_base_url: &str,
    lat: f64,
    lon: f64,
    hours: u32,
) -> Result<PrecipForecast, BoxErr> {
    let mut last_err: Option<BoxErr> = None;
    for attempt in 0..3 {
        if attempt > 0 {
            tokio::time::sleep(std::time::Duration::from_millis(300 * attempt)).await;
        }
        match fetch_once(client, download_base_url, lat, lon, hours).await {
            Ok(forecast) => return Ok(forecast),
            Err(e) => {
                tracing::warn!("precip forecast attempt {} failed: {e}", attempt + 1);
                last_err = Some(e);
            }
        }
    }
    Err(last_err.unwrap_or_else(|| "precip forecast failed".into()))
}

async fn fetch_once(
    client: &reqwest::Client,
    download_base_url: &str,
    lat: f64,
    lon: f64,
    hours: u32,
) -> Result<PrecipForecast, BoxErr> {
    let (south, west, north, east) = (
        lat - HALF_LAT,
        lon - HALF_LON,
        lat + HALF_LAT,
        lon + HALF_LON,
    );

    // Forecast window: the next whole hour through +`hours`.
    let start = Utc::now()
        .with_minute(0)
        .and_then(|t| t.with_second(0))
        .and_then(|t| t.with_nanosecond(0))
        .unwrap_or_else(Utc::now)
        + Duration::hours(1);
    let end = start + Duration::hours(hours as i64 - 1);

    let url = format!(
        "{download_base_url}?producer={PRODUCER}&param=Precipitation1h\
         &bbox={west},{south},{east},{north}\
         &starttime={}&endtime={}&format=grib2&projection=EPSG:4326&levels=0&timestep=60",
        fmt(start),
        fmt(end),
    );

    let bytes = client
        .get(&url)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;

    if bytes.len() < 16 || &bytes[0..4] != b"GRIB" {
        return Err("FMI did not return a GRIB2 payload".into());
    }

    let geom = parse_grid_geom(&bytes).ok_or("could not read GRIB grid definition")?;
    let (cols, rows, stride) = resampled_dims(geom.ni, geom.nj);

    let grib2 = grib::from_reader(Cursor::new(&bytes[..]))?;
    let mut frames = Vec::new();
    for (i, (_idx, submessage)) in grib2.iter().enumerate() {
        if i >= hours as usize {
            break;
        }
        let decoder = Grib2SubmessageDecoder::from(submessage)?;
        let raw: Vec<f32> = decoder.dispatch()?.collect();

        let mut values = Vec::with_capacity(rows * cols);
        let mut max = 0.0f32;
        for r in 0..rows {
            for c in 0..cols {
                // Block-MAX over each stride×stride native block so narrow
                // showers survive downsampling (striding would step over them).
                let mut peak = 0.0f32;
                for dr in 0..stride {
                    for dc in 0..stride {
                        let (sr, sc) = (r * stride + dr, c * stride + dc);
                        if sr < geom.nj && sc < geom.ni {
                            peak = peak.max(sample(&raw, &geom, sr, sc));
                        }
                    }
                }
                // FMI's GRIB encodes precipitation in metres; convert to mm and
                // round to 0.1 mm (finer than the colour bins need, compact JSON).
                let v = (peak * MM_PER_METRE * 10.0).round() / 10.0;
                max = max.max(v);
                values.push(v);
            }
        }
        frames.push(ForecastFrame {
            time: fmt(start + Duration::hours(i as i64)),
            max,
            values,
        });
    }

    if frames.is_empty() {
        return Err("GRIB2 contained no forecast steps".into());
    }

    Ok(PrecipForecast {
        bbox: [geom.south, geom.west, geom.north, geom.east],
        cols,
        rows,
        unit: "mm/h".to_string(),
        frames,
    })
}

fn fmt(t: DateTime<Utc>) -> String {
    t.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// North-up (row 0 = north, col 0 = west) lookup into the GRIB scan order,
/// honouring the scanning-mode flags. Missing/negative values clamp to 0.
fn sample(raw: &[f32], g: &GridGeom, row_from_north: usize, col_from_west: usize) -> f32 {
    let i = if g.i_pos {
        col_from_west
    } else {
        g.ni - 1 - col_from_west
    };
    let j = if g.j_pos {
        g.nj - 1 - row_from_north
    } else {
        row_from_north
    };
    let k = j * g.ni + i;
    raw.get(k)
        .copied()
        .filter(|v| v.is_finite())
        .map(|v| v.max(0.0))
        .unwrap_or(0.0)
}

fn resampled_dims(ni: usize, nj: usize) -> (usize, usize, usize) {
    let stride = (ni.max(nj)).div_ceil(MAX_GRID_SIDE).max(1);
    let cols = ni.div_ceil(stride);
    let rows = nj.div_ceil(stride);
    (cols, rows, stride)
}

/// Parse the first grid-definition section (GRIB2 section 3, template 3.0).
fn parse_grid_geom(buf: &[u8]) -> Option<GridGeom> {
    let mut p = 16; // skip the 16-byte indicator section (section 0)
    while p + 5 <= buf.len() {
        let seclen = u32be(buf, p)? as usize;
        let secnum = buf[p + 4];
        if secnum == 3 {
            if u16be(buf, p + 12)? != 0 {
                return None; // not a lat/lon (template 3.0) grid
            }
            let ni = u32be(buf, p + 30)? as usize;
            let nj = u32be(buf, p + 34)? as usize;
            let la1 = signed_micro(buf, p + 46)?;
            let lo1 = signed_micro(buf, p + 50)?;
            let la2 = signed_micro(buf, p + 55)?;
            let lo2 = signed_micro(buf, p + 59)?;
            let scan = *buf.get(p + 71)?;
            return Some(GridGeom {
                ni,
                nj,
                south: la1.min(la2),
                west: lo1.min(lo2),
                north: la1.max(la2),
                east: lo1.max(lo2),
                i_pos: scan & 0x80 == 0,
                j_pos: scan & 0x40 != 0,
            });
        }
        if seclen == 0 {
            break;
        }
        p += seclen;
    }
    None
}

fn u16be(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_be_bytes(b.get(o..o + 2)?.try_into().ok()?))
}

fn u32be(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(o..o + 4)?.try_into().ok()?))
}

/// GRIB2 angles are sign-magnitude integers in micro-degrees.
fn signed_micro(b: &[u8], o: usize) -> Option<f64> {
    let raw = u32be(b, o)?;
    let mag = (raw & 0x7fff_ffff) as f64 / 1e6;
    Some(if raw & 0x8000_0000 != 0 { -mag } else { mag })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resample_keeps_small_grids_intact() {
        assert_eq!(resampled_dims(89, 45), (89, 45, 1));
    }

    #[test]
    fn resample_coarsens_large_grids() {
        let (cols, rows, stride) = resampled_dims(900, 500);
        assert!(stride >= 2);
        assert!(cols <= MAX_GRID_SIDE && rows <= MAX_GRID_SIDE);
    }

    #[test]
    fn sample_orients_south_west_first_scan_to_north_up() {
        // 2x2 grid scanning west→east, south→north: raw = [SW, SE, NW, NE]
        let g = GridGeom {
            ni: 2,
            nj: 2,
            south: 0.0,
            west: 0.0,
            north: 1.0,
            east: 1.0,
            i_pos: true,
            j_pos: true,
        };
        let raw = [10.0, 20.0, 30.0, 40.0];
        assert_eq!(sample(&raw, &g, 0, 0), 30.0); // north-west
        assert_eq!(sample(&raw, &g, 0, 1), 40.0); // north-east
        assert_eq!(sample(&raw, &g, 1, 0), 10.0); // south-west
    }
}
