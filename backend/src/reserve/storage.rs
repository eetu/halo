use rusqlite::Connection;

use super::models::{FeeRow, FeeRule, ProfitRow};

/// Canonical `reserve_*` schema. The external updater writes these tables; halo
/// only reads. Idempotent `CREATE TABLE IF NOT EXISTS` — no migrations, no ALTER.
pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS reserve_profit (
             provider     TEXT NOT NULL,
             steps        TEXT NOT NULL,
             bucket_start TEXT NOT NULL,
             fcr_up       REAL NOT NULL DEFAULT 0,
             fcr_down     REAL NOT NULL DEFAULT 0,
             spot_saving  REAL NOT NULL DEFAULT 0,
             capacity_kw  REAL NOT NULL DEFAULT 0,
             is_final     INTEGER NOT NULL DEFAULT 0,
             fetched_at   TEXT NOT NULL,
             PRIMARY KEY (provider, steps, bucket_start)
         );

         CREATE TABLE IF NOT EXISTS reserve_fee (
             provider       TEXT NOT NULL,
             effective_from TEXT NOT NULL,
             effective_to   TEXT,
             fee_json       TEXT NOT NULL,
             source         TEXT,
             PRIMARY KEY (provider, effective_from)
         );

         CREATE TABLE IF NOT EXISTS reserve_meta (
             provider     TEXT PRIMARY KEY,
             activation   TEXT,
             display_name TEXT
         );",
    )
}

pub fn read_profit(
    conn: &Connection,
    provider: &str,
    steps: &str,
) -> rusqlite::Result<Vec<ProfitRow>> {
    let mut stmt = conn.prepare_cached(
        "SELECT bucket_start, fcr_up, fcr_down, spot_saving, capacity_kw, is_final
         FROM reserve_profit
         WHERE provider = ?1 AND steps = ?2
         ORDER BY bucket_start ASC",
    )?;
    let rows = stmt
        .query_map(rusqlite::params![provider, steps], |row| {
            Ok(ProfitRow {
                bucket_start: row.get(0)?,
                fcr_up: row.get(1)?,
                fcr_down: row.get(2)?,
                spot_saving: row.get(3)?,
                capacity_kw: row.get(4)?,
                is_final: row.get::<_, i64>(5)? != 0,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>();
    rows
}

pub fn read_fees(conn: &Connection, provider: &str) -> rusqlite::Result<Vec<FeeRow>> {
    let mut stmt = conn.prepare_cached(
        "SELECT effective_from, effective_to, fee_json
         FROM reserve_fee
         WHERE provider = ?1
         ORDER BY effective_from ASC",
    )?;
    let rows = stmt
        .query_map(rusqlite::params![provider], |row| {
            let from: String = row.get(0)?;
            let to: Option<String> = row.get(1)?;
            let fee_json: String = row.get(2)?;
            Ok((from, to, fee_json))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    // Parse outside the SQLite closure (serde/chrono errors aren't rusqlite errors);
    // skip + warn on any malformed row rather than failing the whole request.
    let mut out = Vec::new();
    for (from, to, fee_json) in rows {
        let parsed_from = chrono::NaiveDate::parse_from_str(&from, "%Y-%m-%d");
        let rule = serde_json::from_str::<FeeRule>(&fee_json);
        match (parsed_from, rule) {
            (Ok(from), Ok(rule)) => out.push(FeeRow {
                from,
                to: to.and_then(|s| chrono::NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok()),
                rule,
            }),
            _ => {
                tracing::warn!("reserve_fee row for {provider} from={from} is malformed; skipping")
            }
        }
    }
    Ok(out)
}

pub fn read_display_name(conn: &Connection, provider: &str) -> rusqlite::Result<Option<String>> {
    let mut stmt =
        conn.prepare_cached("SELECT display_name FROM reserve_meta WHERE provider = ?1")?;
    let v = stmt
        .query_row(rusqlite::params![provider], |r| {
            r.get::<_, Option<String>>(0)
        })
        .ok()
        .flatten();
    Ok(v)
}
