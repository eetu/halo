# halo

Wall-mounted home dashboard. Hue bridge for room temperature, lights and motion; FMI for weather and PV forecast; SolisCloud for solar production, battery and grid flow. Finnish UI, monochrome with one warm accent.

![dashboard](/documentation/screenshots/main.png)

## Roadmap

Done

- Hue temperature, light groups, motion (live SSE).
- FMI weather + 7-day chart, Tomorrow.io fallback.
- PV forecast bars layered on weather chart.
- SolisCloud live: PV, battery SoC + power, grid direction.
- SolisCloud history: 5-min recording, downsampled chart.
- Animated PV ↔ inverter ↔ home / battery / grid energy flow.
- Halo design system: Inter + Space Grotesk, 6px cards, accent + dark themes.
- Sensor temperature history with adaptive sampling.
- Screenshot demo mode (`?demo=1`) anonymizing names.

Next

- Energy summary panel (donut + daily / monthly metrics).
- Per-light counts on light group toggles (`4 / 4`).
- Multi-station Solis support.
- Battery low / inverter alarm push notifications.
- Cleaner offline / loading states for SolisCloud + FMI.

## Getting Started

### Environment

```bash
TOMORROW_IO_API_KEY=        # tomorrow.io API key
HUE_BRIDGE_ADDRESS=         # optional — auto-discovered via meethue.com if omitted
HUE_BRIDGE_USER=            # obtained via the pairing flow below
LANGUAGE=fi
HALO_IMAGE_TAG=              # version label shown on the front page
HALO_DB_PATH=/data/halo.db   # SQLite database path (default: halo.db in working directory)
HALO_HISTORY_RETENTION_DAYS=90 # days of sensor history to keep (default: 0/disabled)

# Maps room types to lists of room names as configured in the Hue app.
# Rooms not listed default to "inside".
HUE_ROOM_TYPES={"inside": ["Keittiö", "Olohuone"], "inside_cold": ["Kuisti"], "outside": ["Ulkona"]}

# SolisCloud (PV inverter) — required for the energy view + history.
SOLIS_KEY_ID=
SOLIS_KEY_SECRET=
SOLIS_STATION_ID=
SOLIS_BASE_URL=             # default https://www.soliscloud.com:13333

# PV forecast — how the panels are mounted. All three required together, or
# the forecast stays off. Where they are comes from the saved house position.
PV_TILT=                    # panel tilt from horizontal, 0-90
PV_AZIMUTH=                 # panel facing, 0-360 (180 = south)
PV_KW=                      # nominal system power in kW

```

See the "PV forecast" section below for what the model does with these.

### Pairing with the Hue bridge

1. Press the link button on the bridge
2. POST to `/api/hue/pair` (optionally pass `{"bridgeIp": "x.x.x.x"}` in the body if discovery fails)
3. Copy the returned `HUE_BRIDGE_ADDRESS` and `HUE_BRIDGE_USER` values into `.env`

### Sensor display names

Sensor names are taken directly from the device names set in the Hue app. To differentiate multiple sensors in the same room (e.g. sun vs. shadow), rename the devices in the Hue app.

### Git hooks

```bash
./install-hooks.sh
```

Configures a pre-commit hook that runs `yarn lint` for frontend changes and `cargo clippy` for backend changes.

### Run

```bash
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Sensor history

Temperature readings from all enabled and connected sensors are automatically recorded to a SQLite database every 5 minutes. Old readings are pruned automatically based on `HALO_HISTORY_RETENTION_DAYS` (default: 90).

### Storage

In Docker the database is stored in a named volume (`halo-data`) at `/data/halo.db`. In development it defaults to `halo.db` in the working directory.

### API

```
GET /api/history/sensors?sensor_id=<id>&hours=<n>
```

| Parameter   | Required | Default | Description                          |
|-------------|----------|---------|--------------------------------------|
| `sensor_id` | no       | all     | Filter to a specific sensor          |
| `hours`     | no       | 24      | Hours of history to return (max 720) |

## Solis history

When SolisCloud is configured, the backend polls `/v1/api/stationDetail` every 5 minutes and writes a row to `solis_readings` (PV power, grid power, battery SoC + power, today's energy, status). Readings during inverter offline (`status=2`) are skipped to keep gaps visible in the chart. Retention follows `HALO_HISTORY_RETENTION_DAYS`.

```
GET /api/history/solis?hours=<n>&max_points=<m>
```

| Parameter    | Required | Default | Description                                 |
|--------------|----------|---------|---------------------------------------------|
| `hours`      | no       | 24      | Hours of history to return (max 720)        |
| `max_points` | no       | —       | Uniform sampling cap (window-function based) |

## PV forecast

The backend models PV output itself, in `backend/src/pv/forecast/`. It reads
the Harmonie radiation forecast from FMI and runs it through the standard
chain — Perez-Driesse transposition onto the plane of the array, Martin & Ruiz
reflection losses, King module temperature, Huld DC output — producing ~66
hourly points served from `GET /api/pv/forecast`.

Set `PV_TILT`, `PV_AZIMUTH` and `PV_KW` in the backend environment and a refresh
loop runs every 3 hours, matching the interval Harmonie itself is rerun at. All
three are required together; with none set the forecast is simply off, and with
some set the backend logs which are missing and leaves it off rather than
guessing.

The site position is deliberately *not* among them. The model reads the house
position saved in `user_settings` — the one set from the dashboard's location
form, which the weather and sunrise views already use — so the pin is set once
and everything follows it. Until it is set the loop logs that it is waiting and
does nothing else.

To see a forecast without starting the server (no database, so this one wants
`PV_LAT` and `PV_LON` too):

```bash
cd backend && cargo run --example pv_forecast
```

### Relationship to fmi-pv-forecast-runner

The model is a port of
[fmi-pv-forecast-runner](https://github.com/eetu/fmi-pv-forecast-runner), which
wrapped the Python
[FMI open PV forecast](https://github.com/fmidev/fmi-open-pv-forecast-packaged)
package. The runner is still useful as a second opinion:

```bash
PV_ENV_FILE=../fmi-pv-forecast-runner/.env scripts/compare-pv-forecast.py
```

It runs both against live FMI and diffs them per hour, neither touching the
database. Output agrees to within a few parts in a million — the residual is
that the two use different NREL solar position implementations, which differ in
their last digits.

Point counts differ: where an hour's radiation is missing from the FMI response
the runner publishes it as `0 W`, and this model omits the hour.

### Storage and rendering

Hourly forecast points are upserted into the `pv_forecast_points` table
(steady-state ≤66 rows) and rendered as bars on the daily weather chart,
aggregated to kWh per day.

### Geographic limits

The FMI forecast covers Finland, Scandinavia, and the Baltic countries. See
[ilmatieteenlaitos.fi/numerical-weather-prediction](https://en.ilmatieteenlaitos.fi/numerical-weather-prediction)
for the full available area.

## Views

### Temperature (default)

The screenshot at the top of this README is the temperature view: a full-width FMI weather card (current + 4 day-segments + collapsible 7-day chart drawer with PV forecast bars), and a row of cards for `ulkona`, `sisällä`, `kuisti` (averaged Hue sensor readings with low-battery and trend indicators) plus the live Solis solar production card. Tap any card to expand a drawer with per-sensor detail.

### Energy

![energy view](/documentation/screenshots/energy.png)

Live PV ↔ inverter ↔ home / battery / grid flow diagram from SolisCloud. Active paths animate (dashed scrolling stroke); idle paths stay static at reduced opacity. Each node carries its current kW, plus aurinko shows today's kWh, akku shows SOC %, verkko shows direction (`tuonti` / `vienti` / `lepotila`).

### Lights

![lights view](/documentation/screenshots/lights.png)

All Hue rooms / zones as tappable toggles. Lit groups get a warm cream background, accent ring, and a softly glowing bulb. Status row shows `päällä` / `pois` with a state dot.

### Motion

![motion view](/documentation/screenshots/motion.png)

All Hue motion sensors in a single list. Active rows show a pulsing accent dot and bold `liikettä`; idle rows stay muted. Disabled sensors fade out. Last-trigger timestamp on the right uses Finnish relative formatting.

### History

![history view](/documentation/screenshots/history.png)

Sensor temperature history from the local SQLite store. Range pills (`6h`, `24h`, `7pv`, `30pv`) trigger backend-side downsampling so wide ranges stay snappy. Per-sensor colors are derived from room type (cool blues for outside, warm reds for inside, greens for cold-inside).

### Settings

![settings view](/documentation/screenshots/settings.png)

Location set via address search or device geolocation, plus the deployed image tag.

### Screenshot mode

Append `?demo=1` to any URL to anonymize sensor / room / location names (stable hashed labels like `anturi 042`, `ryhmä 488`). Useful for sharing screenshots without leaking topology.
