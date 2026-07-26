# Frontend

## Validation

Run `yarn validate` after changes — runs lint, format check, and typecheck in one shot.

Individual scripts:

- `yarn lint` / `yarn lint:fix`
- `yarn format` / `yarn format:fix`
- `yarn typecheck`

Use yarn (not npm). It's vendored at `.yarn/releases/` and pinned by `yarnPath`
— CI and Docker call it as `node .yarn/releases/yarn-*.cjs`, no corepack.

## Icons

- **UI icons:** `lucide-react`, imported per-icon. `components/Icon.tsx` is the
  legacy Material Icons wrapper — don't add call sites, convert the ones you
  touch.
- **App icons:** `scripts/gen-icons.sh` regenerates `public/icon-*.png` +
  `apple-touch-icon.png` from `public/favicon.svg` (needs librsvg + ImageMagick).
  Rerun and commit the PNGs after editing the SVG — the build ships no
  rasterizer.
