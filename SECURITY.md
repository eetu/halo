# Security

halo is a self-hosted, single-household wall dashboard. It runs on a home Pi and
is reachable only from the LAN — it is **not** a public or multi-tenant service.
The threat model is: everything on the LAN is trusted, so the controls that
matter are keeping the upstream credentials (Hue bridge user, SolisCloud API
key/secret, weather API key) out of the image and out of the browser, and never
exposing the app beyond the LAN.

## Trust boundaries

- **Network is the boundary — there is no app auth.** Every route is public by
  design: no login, no session, no forward-auth, no `DEV_AUTH`. Anyone who can
  reach the port can read every reading and toggle every light. This is
  deliberate for a wall panel, and the only thing keeping it safe is reachability:
  halo sits behind Traefik on a subdomain whose DNS record — public though it is
  (`public_dns: True` in `../raspi`) — resolves to the **LAN IP**, with no port
  forward. Its route is deliberately **not** in Traefik's `_gated_hosts`, so
  there is no oauth2-proxy in front of it either. Making halo reachable from the
  internet therefore requires adding auth first; nothing in the app would stop
  it otherwise.

- **No per-user isolation, by design.** There is no user model. `user_settings`
  is a single global row (`id=1`) shared by every viewer; anything written there
  is visible to everyone on the LAN.

- **CORS is `Cors::permissive()`.** Acceptable only because the app is LAN-only
  and holds nothing a cross-origin read could escalate — there are no cookies,
  no session, and no auth header to steal, so a hostile page can at most do what
  any LAN client can already do directly. Tighten this to an origin allowlist if
  halo ever gains auth or leaves the LAN.

- **No CSP / security response headers are set.** Same rationale; the SPA is
  served from `STATIC_DIR` with no user-supplied HTML anywhere in the response
  path. Worth adding if the trust model changes.

- **Outbound fetches.** The backend calls fixed, config-pinned upstreams over
  verified TLS: the Hue bridge (LAN), FMI (WFS/WMS/download), tomorrow.io,
  SolisCloud, and the spot-price API. Base URLs come from env, not from request
  input, so no request can steer an outbound fetch at an arbitrary host. halo is
  deliberately **not** in `../raspi`'s `network_restrict.RESTRICTED` — unlike the
  LAN-only siblings it needs egress for those upstreams.

- **`POST /api/pv/forecast` is an unauthenticated write.** The cron-driven
  `scripts/refresh-pv-forecast.sh` upserts ~66 rows through it. Any LAN client
  can also write those rows; the blast radius is a wrong PV forecast until the
  next 3-hourly refresh overwrites it.

## Secrets

All secrets are injected at runtime via env, never baked into the image or
committed: `HUE_BRIDGE_USER`, `SOLIS_KEY_ID`, `SOLIS_KEY_SECRET`,
`SOLIS_STATION_ID`, `TOMORROW_IO_API_KEY`. On the Pi they come from
`/etc/secrets/halo.env` (written by `../raspi`'s `tasks/secrets.py`). `.env`,
`.env.pv`, and `*.db*` are gitignored. The container runs as UID 1000 on
`scratch`.

## Accepted risks

- **Unauthenticated light control and history writes from the LAN.** Accepted:
  the panel exists to be tapped without a login, and the LAN is the trust
  boundary. Revisit if halo is ever exposed beyond the LAN, or if guest/IoT
  devices share the same segment.
- **Permissive CORS + no CSP.** Accepted for the same reason (see above).
  Revisit alongside any auth work.

## Out of scope

Authentication, per-user data, shared/team dashboards, and rate-limiting against
a hostile LAN client are deliberately not built — see the root `CLAUDE.md`
"Out of scope". Don't add them piecemeal; they change the trust model above.

## Reporting

This is a personal project. Flag an issue privately to the maintainer rather
than opening a public issue with exploit detail.
