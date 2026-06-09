---
name: halo-app-design
description: Visual identity for halo — a wall-mounted home dashboard for Hue + solar/energy data, and the origin app of eetu's homebrew family. Layers halo's glyph, wordmark, layout, and voice on top of the shared halo-design tokens. Use when building or styling halo's UI.
user-invocable: true
---

# halo-app-design

Shared tokens + conventions come from `halo-design` (the family skill — halo is
its origin, so halo's ring glyph and wordmark are the reference examples there).
halo is a React app, so tokens are mirrored into `frontend/src/themes.ts` and
consumed via the Emotion `css` prop (the canonical CSS is not shipped; see
halo-design's "React production" note). Below is halo's delta.

For production code, the source of truth lives in the host repo:

- Theme tokens: `frontend/src/themes.ts`
- Components: `frontend/src/components/` (energy view: `frontend/src/components/Energy/`)
- Wordmark + glyph: `frontend/src/components/Wordmark.tsx`, `assets/halo-logo.svg`

Refer to existing components first; don't recreate them as JSX prototypes. For
throwaway artifacts (mocks, slides), build static HTML with the `--halo-*` vars.
If invoked with no task, ask what to build, then act as an expert designer.

## The four deltas

**Glyph** — thin ring + warm centre (`assets/halo-logo.svg`). 64×64,
`currentColor` ring stroke ~3, the one hardcoded color a warm `#f78f08` centre
dot. This is the family's reference glyph; other apps riff on its stroke
language.

**Wordmark** — `halo` + accent period. Full riff: *"i shot marvin in the halo."*
(Pulp Fiction — Vincent's "I shot Marvin in the face." with "face" → "halo").
Inter 600, lowercase, `-0.04em`, warm accent dot, same family as the dashboard
numerals so brand and data read as one. Below the mobile breakpoint the text
collapses entirely, leaving the glyph alone. See `frontend/src/components/Wordmark.tsx`.

**Layout / density** — **data-dense, wall-mounted touch device.** Fixed column
with a nav rail; big numbers, big tap targets, **no hover states**. Clock,
charts, and cards on screen at once. Hue lights + solar/energy flow are the
hero data.

**Voice** — **Finnish**, lowercase, terse. No marketing voice, numbers do the
talking. Optional warm/cool weather hues alongside the accent when data demands.

## Differences from the family baseline

| | halo |
|---|---|
| Role | family origin — its glyph/wordmark are halo-design's reference examples |
| Locale | Finnish, lowercase |
| Device | wall-mounted touch panel — no hover, big targets/numbers |
| Density | data-dense (clock, energy charts, Hue cards) |
| Motion | drawer unfold (150ms), colon pulse each second, breathing lit bulbs, energy-flow stroke scroll, eased counters |
| Icons | `lucide-react`, inline per-icon import, `currentColor` (migrated off Material Icons) |
