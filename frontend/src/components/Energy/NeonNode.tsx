import { NeonSign, type NeonSignHandle, type NeonSignProps } from "@glowbox/react";
import { useEffect, useMemo, useRef, useState } from "react";

import useGlowboxTheme from "../../hooks/useGlowboxTheme";

type NeonArt = NonNullable<NeonSignProps["art"]>[number];

// A battery shell drawn once: lucide ships it as <rect x=2 y=6 w=16 h=12 rx=2>, and
// `art` takes path data or polylines, not lucide's primitives.
const BATTERY_SHELL = "M4 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z";
const BATTERY_TERMINAL = "M22 14v-4";

// The node glyphs as tube centrelines in lucide's own 24x24 frame — lucide 1.30
// geometry, transcribed rather than deep-imported from its dist so a version bump
// can't silently reshape the glass. Circles and rects become arcs; the one zero-
// length dot (battery-warning's 'h.01') becomes a real circle, since a tube needs
// two distinct ends to carry electrodes.
const GLYPHS = {
  sun: [
    "M8 12a4 4 0 0 1 8 0a4 4 0 0 1-8 0",
    "M12 2v2",
    "M12 20v2",
    "m4.93 4.93 1.41 1.41",
    "m17.66 17.66 1.41 1.41",
    "M2 12h2",
    "M20 12h2",
    "m6.34 17.66-1.41 1.41",
    "m19.07 4.93-1.41 1.41",
  ],
  inverter: [
    "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
  ],
  plug: [
    "M12 22v-5",
    "M15 8V2",
    "M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z",
    "M9 8V2",
  ],
  house: [
    "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8",
    "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  ],
  battery: [BATTERY_SHELL, BATTERY_TERMINAL],
  batteryLow: [BATTERY_SHELL, BATTERY_TERMINAL, "M6 14v-4"],
  batteryMedium: [BATTERY_SHELL, BATTERY_TERMINAL, "M6 14v-4", "M10 14v-4"],
  batteryFull: [BATTERY_SHELL, BATTERY_TERMINAL, "M6 10v4", "M10 10v4", "M14 10v4"],
  batteryCharging: [
    "m11 7-3 5h4l-3 5",
    "M14.856 6H16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.935",
    BATTERY_TERMINAL,
    "M5.14 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2.936",
  ],
  batteryWarning: [
    "M10 7v6",
    "M9.35 17a.65.65 0 0 1 1.3 0a.65.65 0 0 1-1.3 0",
    "M14 6h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2",
    BATTERY_TERMINAL,
    "M6 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2",
  ],
} as const;

export type NodeGlyph = keyof typeof GLYPHS;

// Ring and glyph are two pieces of one drawing, so they must scale off declared
// boxes instead of their own bounding boxes — that's what `frame` is for. Unit
// scale is size/frame: 1.5/36 for the ring, 0.78/24 for the glyph, i.e. the glyph
// renders at 0.78x the ring's units and every glyph lands the same size no matter
// how much of its 24 units it fills.
const RING_FRAME: [number, number] = [36, 36];
const RING_SIZE = 1.5;
const RING_RADIUS = 16;
const GLYPH_FRAME: [number, number] = [24, 24];
const GLYPH_SIZE = 0.78;

// A sign fits its bounds into box * (1 - 2 * padding), so these two numbers set the
// ring's diameter in diagram units: 156 * 0.54 ≈ 84 — the diameter of the SVG ring
// these replaced. The rest of the box is headroom for the bloom, which the canvas
// clips.
const NODE_BOX = 156;
const NODE_PADDING = 0.23;

// Glow at zero power. Low enough that a busy node clearly outshines an idle one,
// high enough that the idle one still reads as lit rather than as dead glass — that
// distinction is what `on` carries.
const GLOW_FLOOR = 0.35;

// An arc of the ring, 0 = 12 o'clock, running clockwise like the dasharray gauge it
// replaced.
const arcPath = (from: number, to: number): string => {
  const c = RING_FRAME[0] / 2;
  const r = RING_RADIUS;
  const at = (f: number) => {
    const a = -Math.PI / 2 + f * 2 * Math.PI;
    return [(c + r * Math.cos(a)).toFixed(3), (c + r * Math.sin(a)).toFixed(3)];
  };
  // A single arc can't close a circle (start = end), so a full ring is two.
  if (to - from >= 1) {
    return `M${c} ${c - r}A${r} ${r} 0 0 1 ${c} ${c + r}A${r} ${r} 0 0 1 ${c} ${c - r}`;
  }
  const [x0, y0] = at(from);
  const [x1, y1] = at(to);
  return `M${x0} ${y0}A${r} ${r} 0 ${to - from > 0.5 ? 1 : 0} 1 ${x1} ${y1}`;
};

// A gauge ring is two circuits, not one open tube: the charge lights, the remainder
// runs dim. Drawing both matters beyond looks — a sign is scaled to fit the strokes
// it actually has, so a lone 62% arc would render smaller and off-centre than a full
// ring, and the node would resize itself every time the battery moved.
const ringArt = (fraction: number, color: string, track: string): NeonArt[] => {
  const ring = { frame: RING_FRAME, size: RING_SIZE };
  const f = Math.max(0.02, Math.min(1, fraction));
  if (f >= 1) return [{ ...ring, d: arcPath(0, 1), color }];
  return [
    { ...ring, d: arcPath(f, 1), color: track },
    { ...ring, d: arcPath(0, f), color },
  ];
};

type NeonNodeProps = {
  cx: number;
  cy: number;
  /** The diagram's viewBox — what `cx`/`cy` are measured in. */
  viewBox: [number, number, number, number];
  glyph: NodeGlyph;
  color: string;
  /** Powered: an off node keeps its unlit glass, the way a dead sign does. */
  on: boolean;
  /** kW through the node — drives glow, so a trickle and a surge read differently. */
  magnitude: number;
  /** The kW that reads as a fully lit tube; `magnitude` is glowed against it. */
  reference: number;
  /** Ring fill 0..1 (default 1 = a closed ring); the battery's state of charge. */
  ring?: number;
  /** The colour the unlit part of a partial ring runs at. */
  ringTrack?: string;
  /** Electrical instability 0..1 — a sign that can't hold its strike. */
  flicker?: number;
  /** Held dark this long (ms) before striking, so the diagram lights in order. */
  strikeDelay?: number;
  label: string;
};

const NeonNode: React.FC<NeonNodeProps> = ({
  cx,
  cy,
  viewBox,
  glyph,
  color,
  on,
  magnitude,
  reference,
  ring = 1,
  ringTrack = color,
  flicker = 0,
  strikeDelay = 0,
  label,
}) => {
  const glowboxTheme = useGlowboxTheme();
  const signRef = useRef<NeonSignHandle | null>(null);

  // The diagram lights up like a sign does: dark glass first, then each node takes
  // its turn. Mounting is enough of a trigger — the energy view is unmounted while
  // another tab is up, so opening it strikes the whole board again.
  const [struck, setStruck] = useState(strikeDelay <= 0);
  useEffect(() => {
    if (strikeDelay <= 0) return;
    const t = setTimeout(() => setStruck(true), strikeDelay);
    return () => clearTimeout(t);
  }, [strikeDelay]);

  // A wall dashboard sits on one view for days, so a browser tab coming back to the
  // front never remounts anything. Re-strike by hand: off, then on, which under
  // 'reveal' walks the tubes alight again.
  const litRef = useRef(on);
  litRef.current = on;
  useEffect(() => {
    const restrike = () => {
      if (document.visibilityState !== "visible" || !litRef.current) return;
      signRef.current?.power(false);
      signRef.current?.power(true);
    };
    document.addEventListener("visibilitychange", restrike);
    return () => document.removeEventListener("visibilitychange", restrike);
  }, []);

  const art = useMemo<NeonArt[]>(
    () => [
      ...ringArt(ring, color, ringTrack),
      { d: [...GLYPHS[glyph]], frame: GLYPH_FRAME, size: GLYPH_SIZE, color },
    ],
    [ring, glyph, color, ringTrack],
  );

  // Positioned over the diagram rather than inside it. A canvas in a <foreignObject>
  // is laid out in SVG user units but measures itself with getBoundingClientRect, in
  // scaled CSS pixels — the two disagree by whatever the viewBox scale is, and the
  // sign lands offset and oversized. As an overlay the canvas is plain CSS: it
  // measures what it occupies, and a resize re-measures. Percentages of the diagram
  // box keep it registered with the SVG geometry, since the SVG's own height comes
  // from the same viewBox aspect.
  const [vx, vy, vw, vh] = viewBox;
  const pct = (n: number) => `${n * 100}%`;

  return (
    <div
      css={{
        position: "absolute",
        left: pct((cx - NODE_BOX / 2 - vx) / vw),
        top: pct((cy - NODE_BOX / 2 - vy) / vh),
        width: pct(NODE_BOX / vw),
        height: pct(NODE_BOX / vh),
        // The signs sit over the readouts; the glass is transparent, so let taps
        // and the text through.
        pointerEvents: "none",
      }}
    >
      <NeonSign
        ref={signRef}
        art={art}
        // Transparent glass: the sign composes over the SVG's own backing disc
        // instead of painting a wall of its own.
        wall={null}
        theme={glowboxTheme}
        on={on && struck}
        // Tube by tube rather than all at once: ring, then charge, then glyph.
        program="reveal"
        // A lit node is never at nothing — GLOW_FLOOR is a tube that has struck but
        // is carrying almost nothing, full brightness is its reference power.
        glow={GLOW_FLOOR + (1 - GLOW_FLOOR) * Math.min(1, Math.abs(magnitude) / reference)}
        flicker={flicker}
        padding={NODE_PADDING}
        label={label}
      />
    </div>
  );
};

export default NeonNode;
