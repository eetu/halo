use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use rusqlite::Connection;
use serde::Serialize;
use tokio::sync::Mutex;
use utoipa::ToSchema;

use crate::hue::data::fetch_hue_data;
use crate::pv::models::PvForecast;
use crate::pv::storage as pv_storage;
use crate::solis::models::{SolisReading, SolisWidgetData};
use crate::solis::storage as solis_storage;
use crate::AppState;

pub struct Storage {
    conn: Mutex<Connection>,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SensorReading {
    pub sensor_id: String,
    pub sensor_name: String,
    pub temperature: f64,
    pub room_type: String,
    pub recorded_at: String,
}

impl Storage {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA wal_autocheckpoint = 1000;

             CREATE TABLE IF NOT EXISTS sensor_readings (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 sensor_id TEXT NOT NULL,
                 sensor_name TEXT NOT NULL,
                 temperature REAL NOT NULL,
                 room_type TEXT NOT NULL,
                 recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
             );

             CREATE INDEX IF NOT EXISTS idx_readings_sensor_time
                 ON sensor_readings (sensor_id, recorded_at);
             CREATE INDEX IF NOT EXISTS idx_readings_time
                 ON sensor_readings (recorded_at);

             CREATE TABLE IF NOT EXISTS user_settings (
                 id INTEGER PRIMARY KEY CHECK (id = 1),
                 data TEXT NOT NULL DEFAULT '{}'
             );
             INSERT OR IGNORE INTO user_settings (id, data) VALUES (1, '{}');",
        )?;

        pv_storage::init_schema(&conn)?;
        solis_storage::init_schema(&conn)?;
        crate::reserve::storage::init_schema(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub async fn query_reserve_profit(
        &self,
        provider: &str,
        steps: &str,
    ) -> rusqlite::Result<Vec<crate::reserve::models::ProfitRow>> {
        let conn = self.conn.lock().await;
        crate::reserve::storage::read_profit(&conn, provider, steps)
    }

    pub async fn query_reserve_fees(
        &self,
        provider: &str,
    ) -> rusqlite::Result<Vec<crate::reserve::models::FeeRow>> {
        let conn = self.conn.lock().await;
        crate::reserve::storage::read_fees(&conn, provider)
    }

    pub async fn query_reserve_display_name(
        &self,
        provider: &str,
    ) -> rusqlite::Result<Option<String>> {
        let conn = self.conn.lock().await;
        crate::reserve::storage::read_display_name(&conn, provider)
    }

    pub async fn upsert_pv_forecast(&self, forecast: &PvForecast) -> rusqlite::Result<usize> {
        let conn = self.conn.lock().await;
        pv_storage::upsert_forecast(&conn, forecast)
    }

    pub async fn read_pv_forecast(&self) -> rusqlite::Result<Option<PvForecast>> {
        let conn = self.conn.lock().await;
        pv_storage::read_forecast(&conn)
    }

    pub async fn prune_pv_forecast(&self) -> rusqlite::Result<usize> {
        let conn = self.conn.lock().await;
        pv_storage::prune_past(&conn)
    }

    pub async fn insert_solis_reading(&self, data: &SolisWidgetData) -> rusqlite::Result<()> {
        let conn = self.conn.lock().await;
        solis_storage::insert_reading(&conn, data)
    }

    pub async fn query_solis_readings(
        &self,
        hours: u32,
        max_points: Option<u32>,
    ) -> rusqlite::Result<Vec<SolisReading>> {
        let conn = self.conn.lock().await;
        solis_storage::query_readings(&conn, hours, max_points)
    }

    pub async fn prune_solis(&self, retain_days: u32) -> rusqlite::Result<usize> {
        let conn = self.conn.lock().await;
        solis_storage::prune(&conn, retain_days)
    }

    pub async fn insert_readings(&self, readings: &[SensorReading]) -> rusqlite::Result<()> {
        let conn = self.conn.lock().await;
        let mut stmt = conn.prepare_cached(
            "INSERT INTO sensor_readings (sensor_id, sensor_name, temperature, room_type)
             VALUES (?1, ?2, ?3, ?4)",
        )?;
        for r in readings {
            stmt.execute(rusqlite::params![
                r.sensor_id,
                r.sensor_name,
                r.temperature,
                r.room_type,
            ])?;
        }
        Ok(())
    }

    pub async fn query_readings(
        &self,
        sensor_id: Option<&str>,
        hours: u32,
        max_points: Option<u32>,
    ) -> rusqlite::Result<Vec<SensorReading>> {
        let conn = self.conn.lock().await;

        // 1. Performance PRAGMAs (Crucial for Raspberry Pi)
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA temp_store = MEMORY;
            PRAGMA synchronous = NORMAL;
        ",
        )?;

        let cutoff = format!("-{hours} hours");

        match (sensor_id, max_points) {
            (Some(sid), Some(max)) => {
                // Get total count first to determine sampling step
                let total: u32 = conn.query_row(
                    "SELECT COUNT(*) FROM sensor_readings WHERE sensor_id = ?1 AND recorded_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?2)",
                    rusqlite::params![sid, cutoff],

                    |r| r.get(0),
                )?;
                let step = (total / max).max(1);

                let mut stmt = conn.prepare_cached(
                    "SELECT sensor_id, sensor_name, temperature, room_type, recorded_at
                     FROM (
                         SELECT *, ROW_NUMBER() OVER (ORDER BY recorded_at) AS rn
                         FROM sensor_readings
                         WHERE sensor_id = ?1
                           AND recorded_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?2)
                     )
                     WHERE rn % ?3 = 0
                     ORDER BY recorded_at ASC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![sid, cutoff, step], row_to_reading)?
                    .collect::<rusqlite::Result<Vec<_>>>();
                rows
            }
            (Some(sid), None) => {
                let mut stmt = conn.prepare_cached(
                    "SELECT sensor_id, sensor_name, temperature, room_type, recorded_at
                     FROM sensor_readings
                     WHERE sensor_id = ?1 AND recorded_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?2)
                     ORDER BY recorded_at ASC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![sid, cutoff], row_to_reading)?
                    .collect::<rusqlite::Result<Vec<_>>>();
                rows
            }
            (None, Some(max)) => {
                // For 'All Sensors', we use a sub-query to find the average density
                // or just apply a global row-number filter per sensor.
                let mut stmt = conn.prepare_cached(
                    "SELECT sensor_id, sensor_name, temperature, room_type, recorded_at
                     FROM (
                         SELECT *, ROW_NUMBER() OVER (PARTITION BY sensor_id ORDER BY recorded_at) AS rn,
                                COUNT(*) OVER (PARTITION BY sensor_id) as sensor_total
                         FROM sensor_readings
                         WHERE recorded_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?1)
                     )
                     -- Logic: Only return a row if it hits the step threshold for its specific sensor
                     WHERE rn % MAX(1, sensor_total / ?2) = 0
                     ORDER BY recorded_at ASC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![cutoff, max], row_to_reading)?
                    .collect::<rusqlite::Result<Vec<_>>>();
                rows
            }
            (None, None) => {
                let mut stmt = conn.prepare_cached(
                    "SELECT sensor_id, sensor_name, temperature, room_type, recorded_at
                     FROM sensor_readings
                     WHERE recorded_at > strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?1)
                     ORDER BY recorded_at ASC",
                )?;
                let rows = stmt
                    .query_map(rusqlite::params![cutoff], row_to_reading)?
                    .collect::<rusqlite::Result<Vec<_>>>();
                rows
            }
        }
    }

    pub async fn get_settings(&self) -> rusqlite::Result<String> {
        let conn = self.conn.lock().await;
        conn.query_row("SELECT data FROM user_settings WHERE id = 1", [], |row| {
            row.get(0)
        })
    }

    pub async fn save_settings(&self, data: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().await;
        conn.execute(
            "UPDATE user_settings SET data = ?1 WHERE id = 1",
            rusqlite::params![data],
        )?;
        Ok(())
    }

    pub async fn prune(&self, retain_days: u32) -> rusqlite::Result<usize> {
        let conn = self.conn.lock().await;
        let cutoff = format!("-{retain_days} days");
        conn.execute(
            "DELETE FROM sensor_readings WHERE recorded_at < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?1)",
            rusqlite::params![cutoff],
        )
    }
}

fn row_to_reading(row: &rusqlite::Row) -> rusqlite::Result<SensorReading> {
    Ok(SensorReading {
        sensor_id: row.get(0)?,
        sensor_name: row.get(1)?,
        temperature: row.get(2)?,
        room_type: row.get(3)?,
        recorded_at: row.get(4)?,
    })
}

pub fn start_recording_loop(state: Arc<AppState>) {
    if state.settings.history_retention_days == 0 {
        tracing::info!("Sensor history recording disabled (HALO_HISTORY_RETENTION_DAYS=0)");
        return;
    }

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(300));
        // Prune daily (every 288 ticks at 5min interval)
        let mut tick_count: u32 = 0;

        loop {
            interval.tick().await;

            match fetch_hue_data(&state).await {
                Ok(hue) => {
                    let readings: Vec<SensorReading> = hue
                        .sensors
                        .iter()
                        .filter(|s| s.enabled && s.connected)
                        .filter_map(|s| {
                            s.temperature.map(|t| SensorReading {
                                sensor_id: s.id.clone(),
                                sensor_name: s.name.clone(),
                                temperature: t,
                                room_type: format!("{:?}", s.room_type).to_lowercase(),
                                recorded_at: String::new(), // DB default
                            })
                        })
                        .collect();

                    if let Err(e) = state.storage.insert_readings(&readings).await {
                        tracing::error!("Failed to store sensor readings: {e}");
                    }
                }
                Err(e) => {
                    tracing::warn!("Skipping sensor recording, fetch failed: {e}");
                }
            }

            tick_count += 1;
            if tick_count.is_multiple_of(288) {
                match state
                    .storage
                    .prune(state.settings.history_retention_days)
                    .await
                {
                    Ok(n) if n > 0 => tracing::info!("Pruned {n} old sensor readings"),
                    Err(e) => tracing::error!("Failed to prune old readings: {e}"),
                    _ => {}
                }
            }
        }
    });
}
