#!/usr/bin/env bash
# Regenerate the PWA / home-screen icon PNGs from public/favicon.svg.
#
# Icons are FULL-BLEED SQUARES — iOS and Android round home-screen / PWA icons
# themselves, so we must NOT bake rounded corners into the source. favicon.svg is
# a plain square (no rx); the OS applies its own mask. The maskable icon is
# DERIVED here (glyph shrunk into the ~80% safe zone) — no separate source SVG.
#
# Requires librsvg (`brew install librsvg`) + ImageMagick. Rerun after editing
# favicon.svg and commit the PNGs (the build ships no rasterizer).
set -euo pipefail
cd "$(dirname "$0")/../public"
# halo's ring strokes #525252 — it reads on the light body, not on the dark one,
# so the icon bg is --halo-body light. -b fills the corners opaque so none round.
BG="#f0f0f0"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# any-purpose icons + browser favicon fallback (full-bleed square)
rsvg-convert -w 192 -h 192 -b "$BG" favicon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 -b "$BG" favicon.svg -o icon-512.png

# apple-touch-icon: opaque, no alpha (Apple guidance), square
rsvg-convert -w 180 -h 180 -b "$BG" favicon.svg -o "$tmp/ati.png"
magick "$tmp/ati.png" -background "$BG" -flatten -alpha off -type TrueColor PNG24:apple-touch-icon.png

# maskable: glyph shrunk into the ~80% safe zone on a full-bleed bg so Android's
# adaptive mask can't clip it
rsvg-convert -w 410 -h 410 -b "$BG" favicon.svg -o "$tmp/glyph.png"
magick -size 512x512 "xc:$BG" "$tmp/glyph.png" -gravity center -composite \
  -alpha off -type TrueColor PNG24:icon-maskable-512.png

echo "icons regenerated (full-bleed squares) in $(pwd)"
