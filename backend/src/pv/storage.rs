use rusqlite::Connection;

use super::models::{PvForecast, PvPoint};

pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS pv_forecast_points (
             time TEXT PRIMARY KEY,
             output_w REAL NOT NULL,
             temperature REAL,
             wind REAL,
             module_temp REAL,
             generated_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_pv_forecast_generated
             ON pv_forecast_points(generated_at);",
    )
}

pub fn upsert_forecast(conn: &Connection, forecast: &PvForecast) -> rusqlite::Result<usize> {
    let tx = conn.unchecked_transaction()?;
    let mut count = 0;
    {
        let mut stmt = tx.prepare(
            "INSERT INTO pv_forecast_points
                 (time, output_w, temperature, wind, module_temp, generated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(time) DO UPDATE SET
                 output_w = excluded.output_w,
                 temperature = excluded.temperature,
                 wind = excluded.wind,
                 module_temp = excluded.module_temp,
                 generated_at = excluded.generated_at",
        )?;
        for p in &forecast.points {
            stmt.execute(rusqlite::params![
                p.time,
                p.output_w,
                p.temperature,
                p.wind,
                p.module_temp,
                forecast.generated_at,
            ])?;
            count += 1;
        }
    }
    tx.commit()?;
    Ok(count)
}

pub fn read_forecast(conn: &Connection) -> rusqlite::Result<Option<PvForecast>> {
    // Include up to 24h of already-passed points so the UI can still render
    // today's full-day forecast after FMI's forecast window has moved past the
    // morning hours. The frontend decides when to hide today (noon cutoff).
    let mut stmt = conn.prepare(
        "SELECT time, output_w, temperature, wind, module_temp, generated_at
         FROM pv_forecast_points
         WHERE time >= strftime('%Y-%m-%dT%H:00:00Z', 'now', '-24 hours')
         ORDER BY time ASC",
    )?;

    let mut generated_at: Option<String> = None;
    let points: Vec<PvPoint> = stmt
        .query_map([], |row| {
            let gen_at: String = row.get(5)?;
            generated_at.get_or_insert(gen_at);
            Ok(PvPoint {
                time: row.get(0)?,
                output_w: row.get(1)?,
                temperature: row.get(2)?,
                wind: row.get(3)?,
                module_temp: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    if points.is_empty() {
        return Ok(None);
    }

    Ok(Some(PvForecast {
        generated_at: generated_at.unwrap_or_default(),
        points,
    }))
}

pub fn prune_past(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute(
        "DELETE FROM pv_forecast_points
         WHERE time < strftime('%Y-%m-%dT%H:00:00Z', 'now', '-36 hours')",
        [],
    )
}
