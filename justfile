# halo task runner. `just` with no args lists recipes.
# Frontend: yarn (vendored, in frontend/). Backend: cargo (in backend/ — halo has
# no root workspace, each recipe cd's in).

# Yarn = the repo-vendored release pinned by `yarnPath` in frontend/.yarnrc.yml,
# run via node. No global yarn / corepack needed (recipes run under sh, which
# can't see a shell yarn function), and it auto-tracks `yarn set version` bumps.
yarn := "node " + (justfile_directory() / "frontend" / `awk '/^yarnPath:/{print $2}' frontend/.yarnrc.yml`)

default:
    @just --list

# Install frontend deps.
install:
    cd frontend && {{yarn}} install

# Per-component alternative, own terminals: `cd backend && bacon` (TUI),
# `cd frontend && yarn dev`. Here the backend runs headless so both log streams
# compose into one; it hot-reloads on src + .env changes.

# Dev the whole app: backend (bacon, :3000) + frontend (vite, :5173).
dev:
    #!/usr/bin/env bash
    set -euo pipefail
    # Tear down every child (and its grandchildren — the backend binary under
    # bacon, vite under yarn) on Ctrl-C / exit, so nothing orphans and holds its
    # port. Killing only the children — NOT `kill 0` — leaves `just` and the
    # shell unsignalled, so no stray SIGTERM noise on exit.
    pids=""
    cleanup() {
        trap - INT TERM EXIT
        for p in $pids; do
            pkill -P "$p" 2>/dev/null || true
            kill "$p" 2>/dev/null || true
        done
    }
    trap cleanup INT TERM EXIT
    ( cd backend && exec bacon --headless -j run ) &
    pids="$pids $!"
    ( cd frontend && exec {{yarn}} dev ) &
    pids="$pids $!"
    wait

# Build: frontend bundle, then the backend binary.
build:
    cd frontend && {{yarn}} build
    cd backend && cargo build --release

# Lint (frontend eslint + backend clippy).
lint:
    cd frontend && {{yarn}} lint
    cd backend && cargo clippy --workspace --all-targets -- -D warnings

# Formatting check (prettier + rustfmt); apply with format:fix / cargo fmt --all.
format:
    cd frontend && {{yarn}} format
    cd backend && cargo fmt --all -- --check

# Tests: frontend vitest + backend cargo test. E2E is `just e2e`.
test:
    cd frontend && {{yarn}} test --run
    cd backend && cargo test --workspace

# Playwright against the built app.
e2e:
    cd frontend && {{yarn}} test:e2e

# Regenerate the PWA icon PNGs from frontend/public/favicon.svg.
icons:
    ./frontend/scripts/gen-icons.sh
