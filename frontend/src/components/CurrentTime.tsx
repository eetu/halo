import { useTheme } from "@emotion/react";
import { LcdModule, NixieTube, SplitFlap, type VfdElement, VfdPanel } from "@glowbox/react";
import { format } from "date-fns";
import { fi } from "date-fns/locale/fi";
import React, { memo } from "react";

import useCurrentTime from "../hooks/useCurrentTime";
import useGlowboxTheme from "../hooks/useGlowboxTheme";
import useLocal from "../hooks/useLocal";
import { mq } from "../mq";

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

// The glowbox faces are canvases that redraw to their container (ResizeObserver),
// so the wrapper spans the column and each face caps itself at its design width.
const DISPLAY_WRAPPER = {
  width: "100%",
  display: "flex",
  justifyContent: "center",
  cursor: "pointer",
  userSelect: "none",
  // On a phone these faces span the whole column, which is also where the
  // wordmark and the fullscreen button sit — drop below them.
  [mq[0]]: { marginTop: 26 },
} as const;

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
        <div onClick={cycleFont} css={DISPLAY_WRAPPER}>
          <NixieClock hh={hh} mm={mm} ss={ss} />
        </div>
      ) : displayFont.family === "Vfd" ? (
        <div onClick={cycleFont} css={DISPLAY_WRAPPER}>
          <VfdClock hh={hh} mm={mm} ss={ss} />
        </div>
      ) : displayFont.family === "SplitFlap" ? (
        <div onClick={cycleFont} css={DISPLAY_WRAPPER}>
          <SplitFlapClock hh={hh} mm={mm} ss={ss} />
        </div>
      ) : displayFont.family === "Lcd" ? (
        <div onClick={cycleFont} css={DISPLAY_WRAPPER}>
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
  const glowboxTheme = useGlowboxTheme();

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

  // 520 = six 78px tubes + two 26px colons; below that width the row scales down
  // as one and every tube keeps its share.
  return (
    <div
      css={{
        display: "flex",
        flexDirection: "row",
        width: "min(100%, 520px)",
        aspectRatio: "520 / 120",
      }}
    >
      {tubes.map(([slot, value]) => (
        <div
          key={slot}
          css={{
            flexGrow: ["c1", "c0"].includes(slot) ? 26 : 78,
            flexBasis: 0,
            minWidth: 0,
            height: "100%",
          }}
        >
          <NixieTube value={value} theme={glowboxTheme} />
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
  const glowboxTheme = useGlowboxTheme();

  return (
    <div css={{ width: "min(100%, 640px)", aspectRatio: "640 / 128" }}>
      <VfdPanel
        frame={VFD_FRAME}
        layout={VFD_LAYOUT}
        values={{ time: `${hh}.${mm}`, secs: ss }}
        phosphor="amber"
        filter="amber"
        // The glass stays dark in both bundles — a phosphor anode needs a dark
        // window. What moves is the chassis: dark grey plate, or the brushed
        // silver a 70s receiver actually had.
        theme={glowboxTheme}
        label={`${hh}:${mm}:${ss}`}
      />
    </div>
  );
};

// A digits-only drum: 9 rolls over to 0 in two flips instead of spinning the whole
// alphabet. The colon cells sit on the last flap and never move.
const FLAP_CHARSET = "0123456789:";

const SplitFlapClock: React.FC<NixieClockProps> = ({ hh, mm, ss }) => {
  const glowboxTheme = useGlowboxTheme();

  return (
    <div css={{ width: "min(100%, 560px)", aspectRatio: "560 / 100" }}>
      <SplitFlap
        cols={8}
        rows={1}
        charset={FLAP_CHARSET}
        text={`${hh}:${mm}:${ss}`}
        // Near-black cards in dark, the bone-white printed strip of a pale Solari
        // board in light. Don't set card/ink/board here: a colour we name is ours
        // for good and would stop following the bundle.
        theme={glowboxTheme}
        label={`${hh}:${mm}:${ss}`}
      />
    </div>
  );
};

const LcdClock: React.FC<NixieClockProps> = ({ hh, mm, ss }) => {
  const glowboxTheme = useGlowboxTheme();

  return (
    <div css={{ width: "min(100%, 480px)", aspectRatio: "480 / 128" }}>
      <LcdModule
        cols={8}
        rows={1}
        text={`${hh}:${mm}:${ss}`}
        // The glass is hardware, not a theme — the bundle only moves the plastic
        // frame. So keep choosing it: positive green STN (dark ink, readable in
        // daylight) in light, the backlit blue negative in dark.
        panel={glowboxTheme === "dark" ? "blue" : "green"}
        theme={glowboxTheme}
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
