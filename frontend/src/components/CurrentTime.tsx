import { useTheme } from "@emotion/react";
import { LcdModule, NixieTube, SplitFlap, type VfdElement, VfdPanel } from "@glowbox/react";
import { format } from "date-fns";
import { fi } from "date-fns/locale/fi";
import React, { memo } from "react";

import useCurrentTime from "../hooks/useCurrentTime";
import useLocal from "../hooks/useLocal";

type CurrentTimeProps = {} & React.HTMLAttributes<HTMLDivElement>;

const DISPLAY_FONTS = [
  {
    family: '"DM Serif Display", Georgia, serif',
    weight: 400,
    tracking: "-0.02em",
  },
  {
    family: '"Abril Fatface", Georgia, serif',
    weight: 400,
    tracking: "-0.02em",
  },
  { family: '"Inter", system-ui, sans-serif', weight: 300, tracking: "-0.1em" },
  { family: "Nixie" },
  { family: "Vfd" },
  { family: "SplitFlap" },
  { family: "Lcd" },
];

const CurrentTime: React.FC<CurrentTimeProps> = ({ className }) => {
  const theme = useTheme();
  const currentTime = useCurrentTime();
  const [fontIndex, setFontIndex] = useLocal("clockFontIndex", 0);
  const displayFont = DISPLAY_FONTS[fontIndex] ?? DISPLAY_FONTS[0];

  const hh = format(currentTime, "HH");
  const mm = format(currentTime, "mm");
  const ss = format(currentTime, "ss");

  const cycleFont = () => setFontIndex((i) => (i + 1) % DISPLAY_FONTS.length);

  return (
    <div
      className={className}
      css={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {displayFont.family === "Nixie" ? (
        <div onClick={cycleFont} css={{ cursor: "pointer", userSelect: "none" }}>
          <NixieClock hh={hh} mm={mm} ss={ss} />
        </div>
      ) : displayFont.family === "Vfd" ? (
        <div onClick={cycleFont} css={{ cursor: "pointer", userSelect: "none" }}>
          <VfdClock hh={hh} mm={mm} ss={ss} />
        </div>
      ) : displayFont.family === "SplitFlap" ? (
        <div onClick={cycleFont} css={{ cursor: "pointer", userSelect: "none" }}>
          <SplitFlapClock hh={hh} mm={mm} ss={ss} />
        </div>
      ) : displayFont.family === "Lcd" ? (
        <div onClick={cycleFont} css={{ cursor: "pointer", userSelect: "none" }}>
          <LcdClock hh={hh} mm={mm} ss={ss} />
        </div>
      ) : (
        <div
          onClick={cycleFont}
          css={{
            fontFamily: displayFont.family,
            fontSize: "7em",
            lineHeight: 1,
            fontWeight: displayFont.weight,
            letterSpacing: displayFont.tracking,
            fontVariantNumeric: "tabular-nums",
            display: "flex",
            alignItems: "baseline",
            gap: "0.05em",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <span>{hh}</span>
          <span css={{ color: theme.colors.activity.on }}>.</span>
          <span>{mm}</span>
          <span
            css={{
              fontFamily: theme.fonts.heading,
              fontSize: "0.22em",
              fontWeight: 400,
              color: theme.colors.text.muted,
              marginLeft: "0.4em",
              marginBottom: "0.6em",
              alignSelf: "flex-end",
              letterSpacing: "normal",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {ss}
          </span>
        </div>
      )}
      <div
        css={{
          fontFamily: theme.fonts.heading,
          fontSize: "1.1em",
          fontWeight: 400,
          marginTop: 6,
          color: theme.colors.text.muted,
          textTransform: "capitalize",
        }}
      >
        {format(currentTime, "EEEE dd. MMMM yyyy", { locale: fi })}
      </div>
    </div>
  );
};
export default memo(CurrentTime);

type NixieClockProps = {
  hh: string;
  mm: string;
  ss: string;
};

const NixieClock: React.FC<NixieClockProps> = ({ hh, mm, ss }) => {
  // One tube per slot, keyed by slot rather than by value: the key must stay stable
  // across ticks or React remounts the canvas and the cathode cross-fade is lost.
  const tubes: [string, string][] = [
    ["h0", hh[0]],
    ["h1", hh[1]],
    ["c0", ":"],
    ["m0", mm[0]],
    ["m1", mm[1]],
    ["c1", ":"],
    ["s0", ss[0]],
    ["s1", ss[1]],
  ];

  return (
    <div css={{ display: "flex", flexDirection: "row" }}>
      {tubes.map(([slot, value]) => (
        <div key={slot} css={{ height: 120, width: ["c1", "c0"].includes(slot) ? 26 : 78 }}>
          <NixieTube value={value} />
        </div>
      ))}
    </div>
  );
};

// Fixed hardware: declared once at module scope so a re-render never re-compiles the
// anode inventory. Frame units are y-down; the panel canvas fills its parent box.
const VFD_FRAME: [number, number] = [320, 64];

const VFD_LAYOUT: VfdElement[] = [
  {
    kind: "digits",
    name: "time",
    x: 10,
    y: 12,
    w: 232,
    h: 44,
    chars: 5,
    glyphs: "14seg",
    align: "right",
  },
  {
    kind: "digits",
    name: "secs",
    x: 252,
    y: 26,
    w: 58,
    h: 26,
    chars: 2,
    glyphs: "14seg",
  },
];

const VfdClock: React.FC<NixieClockProps> = ({ hh, mm, ss }) => {
  return (
    <div css={{ width: 640, height: 128 }}>
      <VfdPanel
        frame={VFD_FRAME}
        layout={VFD_LAYOUT}
        values={{ time: `${hh}.${mm}`, secs: ss }}
        phosphor="amber"
        filter="amber"
        label={`${hh}:${mm}:${ss}`}
      />
    </div>
  );
};

// A digits-only drum: 9 rolls over to 0 in two flips instead of spinning the whole
// alphabet. The colon cells sit on the last flap and never move.
const FLAP_CHARSET = "0123456789:";

const SplitFlapClock: React.FC<NixieClockProps> = ({ hh, mm, ss }) => {
  const theme = useTheme();

  // The only one of the three that can genuinely go light: a flap is printed
  // plastic, not a light source, and pale-card boards are real hardware. Dark
  // mode keeps the core's own near-black card / warm-white ink.
  const light = theme.mode === "light";

  return (
    <div css={{ width: 560, height: 100 }}>
      <SplitFlap
        cols={8}
        rows={1}
        charset={FLAP_CHARSET}
        text={`${hh}:${mm}:${ss}`}
        card={light ? theme.colors.background.main : undefined}
        ink={light ? theme.colors.onAccent : undefined}
        board={light ? theme.colors.text.light : undefined}
        label={`${hh}:${mm}:${ss}`}
      />
    </div>
  );
};

const LcdClock: React.FC<NixieClockProps> = ({ hh, mm, ss }) => {
  const theme = useTheme();

  // The reflective one: dark ink on a lit pane, native to a light page. The green
  // STN glass is positive (readable even unlit); the blue is negative — light ink
  // that only exists while the backlight is on, which is what suits the dark theme.
  const negative = theme.mode === "dark";

  return (
    <div css={{ width: 480, height: 128 }}>
      <LcdModule
        cols={8}
        rows={1}
        text={`${hh}:${mm}:${ss}`}
        panel={negative ? "blue" : "green"}
        backlight
        // A clock has no cursor parked after its last digit.
        cursor="none"
        // The boot row of solid blocks is a power-up artifact; the mode is
        // remounted on every cycle through the font list, so it would replay.
        boot={false}
        label={`${hh}:${mm}:${ss}`}
      />
    </div>
  );
};
