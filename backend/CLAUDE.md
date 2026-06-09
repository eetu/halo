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
- `pv/` — PV forecast `get_forecast` / `post_forecast` (upsert from the external CLI).

## Notes

- Two recording loops (sensors, Solis) + the Hue SSE broadcast start in
  `run_server`. Solis loop skips offline `status=2` rows.
- `GET /status` returns `{ hue, weather }` liveness bools.
- `cargo test` for the `tests/` integration suite.
