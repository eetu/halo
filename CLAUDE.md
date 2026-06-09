# halo — repo overview

Wall-mounted home dashboard. Hue (room temp, lights, motion) + FMI weather &
7-day forecast + SolisCloud PV/battery/grid (live + history). Family origin;
siblings [chat](../chat), [scribe](../scribe), [ocular](../ocular),
[raspi-dashboard](../raspi-dashboard) share its design system.

## Layout

```
backend/         actix-web 4 — Hue/FMI/SolisCloud clients, SQLite (WAL), polling loops
frontend/        Vite + React 19 + Emotion + TanStack Router (file-based)
scripts/         refresh-pv-forecast.sh (cron-driven PV upsert) + misc
documentation/   design notes
.claude/skills/  halo-app-design skill (visual language, brand)
```

Per-area instructions in `backend/CLAUDE.md` and `frontend/CLAUDE.md`.

## Conventions

- **No auth.** LAN-only dashboard — every route is public. No session, no
  forward-auth, no `DEV_AUTH`. Don't add per-user state; `user_settings` is a
  single global row (`id=1`).
- **SQLite + WAL, single `Mutex<Connection>`.** Tables: `sensor_readings`,
  `solis_readings`, `pv_forecast_points`, `user_settings`.
- **Background loops.** Sensor temps recorded every 5 min; SolisCloud polled
  every 5 min (offline `status=2` skipped so gaps stay visible); PV forecast
  refreshed every 3 h via the external `fmi-pv-forecast-runner` CLI, upserted
  through `POST /api/pv/forecast` (~66 hourly rows).
- **History retention.** Pruned per `HALO_HISTORY_RETENTION_DAYS` (default 0 =
  disabled).
- **Hue events.** `GET /api/hue/events` is an SSE stream off a broadcast channel
  — live bridge-state pushes, not polling.

## Working on this repo

- Backend `:3000` (`PORT`); needs a `.env` with at least `HUE_BRIDGE_ADDRESS` /
  `HUE_BRIDGE_USER` (pair via `POST /api/hue/pair`). Run: `cargo run -p halo-backend`.
- Frontend dev `:5173` (`yarn dev`); Vite proxies `/api`, `/hue/events`,
  `/status` to `:3000`.
- Key env: `SOLIS_KEY_ID/SECRET/STATION_ID`, `TOMORROW_IO_API_KEY` (fallback
  weather), `HUE_ROOM_TYPES` (JSON), `HALO_DB_PATH`, `STATIC_DIR`. See
  `backend/src/settings.rs`.

## Out of scope (for now)

- Authentication / per-user data
- Shared/team dashboards, admin UI
- Mobile/native app (web only, touch-friendly)
- Non-Hue smart-home integrations

If a feature crosses into those areas, raise it before implementing.
