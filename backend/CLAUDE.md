# halo backend

actix-web 4 (predates the family's `rust-axum` standard — don't follow it for
new apps; new backends are axum). Serves the SPA from `STATIC_DIR` + `/api`.

## Module map (`src/`)

- `lib.rs` — app setup, routes, shared state, `run_server`.
- `settings.rs` — env parsing (`PORT`, `HALO_DB_PATH`, Hue/Solis/weather keys, …).
- `storage.rs` — SQLite (`PRAGMA journal_mode=WAL`), `Mutex<Connection>`. The
  four tables; history queries.
- `cache.rs` — in-memory caches.
- `hue/` — bridge client: `get_data`, `events_sse` (broadcast channel),
  `pair`, `toggle_group`, `set_brightness`, `toggle_motion`.
- `weather/` — `fmi` (primary, FMI WFS) + `tomorrow` (tomorrow.io fallback).
- `solis/` — SolisCloud client + 5-min polling loop writing `solis_readings`.
- `pv/` — PV forecast `get_forecast`, plus `forecast/` (the output model: FMI
  radiation → plane-of-array transposition → reflection → module temperature →
  DC watts) and a 3-hourly `recording` loop, the only writer of
  `pv_forecast_points`. Reference
  values generated from pvlib live in `pv/forecast/testdata/`; the unit tests
  check every step against them.

## Notes

- Three recording loops (sensors, Solis, PV forecast) + the Hue SSE broadcast
  start in `run_server`. Solis loop skips offline `status=2` rows. The PV loop
  is off unless `PV_TILT`/`PV_AZIMUTH`/`PV_KW` are set, and idles until the
  house position exists in `user_settings` (`ForecastError::NoPosition`) — the
  array's mounting is configuration, its position is the dashboard's own pin.
- The PV model reads `RadiationGlobalAccumulation`,
  `RadiationNetSurfaceSWAccumulation` and `RadiationSWAccumulation` from the
  same Harmonie stored query the weather module uses. FMI stamps each
  accumulation at the *end* of the hour it covers: sun position is taken at the
  hour's midpoint and the point is labelled with its start. Getting that wrong
  shifts every value by an hour without any test noticing unless it checks the
  labels.
- `GET /status` returns `{ hue, weather }` liveness bools.
- `cargo test` for the `tests/` integration suite.
