import { Theme, useTheme } from "@emotion/react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  ChartOptions,
  LinearScale,
} from "chart.js";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Bar } from "react-chartjs-2";

import { api } from "../../api";
import { mq } from "../../mq";
import { HourPrice, SpotResponse } from "../../types/spot";

ChartJS.register(BarElement, CategoryScale, LinearScale);

const HOUR_MS = 3_600_000;
const SCALE_KEY = "halo.spot.showScale";

// How long the card title keeps showing the scrubbed price after the finger
// lifts (or the cursor leaves) before falling back to the default title.
const REVERT_MS = 2500;

// Touch loupe: a magnified patch of the chart's bottom strip (the bars' base +
// the hour labels) floated above the fingertip so it never sits under the finger.
// Bottom-anchored sampling keeps the hour labels in view; it follows the finger.
const LOUPE_W = 104; // square so the bubble can be a clean circle
const LOUPE_H = 104;
const LOUPE_GAP = 16; // gap between the fingertip and the bottom of the loupe
const LOUPE_ZOOM = 2; // uniform magnification (no anamorphic stretch)

// Absolute price → hue (c/kWh incl. VAT): green at LO → red at HI → and on past
// red into purple by MAX (the face of whoever pays the bill). Absolute, not
// per-day, so a whole expensive day reads red/purple instead of every day's
// cheapest hour looking green. Tweak the thresholds for the local market.
const PRICE_LO = 0;
const PRICE_HI = 20;
const PRICE_MAX = 50;
const priceHue = (price: number) => {
  if (price <= PRICE_HI) {
    const t = Math.min(
      1,
      Math.max(0, (price - PRICE_LO) / (PRICE_HI - PRICE_LO)),
    );
    return 120 * (1 - t); // 120 green → 0 red
  }
  const k = Math.min(1, (price - PRICE_HI) / (PRICE_MAX - PRICE_HI));
  return 360 - 75 * k; // 360 red → 285 purple
};

type DayKey = "today" | "tomorrow";
type Selected = { day: DayKey; hour: string; price: number };
type LoupeBox = { left: number; top: number; touchX: number };

// Round for display, collapsing a tiny negative (e.g. -0.04 → "-0.0") to a plain
// zero so near-zero prices don't read as negative.
const fmtPrice = (n: number, digits: number) => {
  const s = n.toFixed(digits);
  return Number(s) === 0 ? (0).toFixed(digits) : s;
};

// Magnify the chart's bottom strip around the touch x (uniform zoom, so it reads
// as a true loupe rather than a stretched band) into the loupe canvas, then mark
// the focused column. Bottom-anchored so the hour labels always show; reads
// straight from chart.js's own canvas so the selected-bar highlight comes along
// for free.
const drawLoupe = (
  dst: HTMLCanvasElement,
  src: HTMLCanvasElement,
  touchX: number,
  theme: Theme,
) => {
  const rect = src.getBoundingClientRect();
  const { width: cssW, height: cssH } = rect;
  if (!cssW || !cssH) return;
  const dpr = src.width / cssW; // chart canvas is rendered at devicePixelRatio
  const srcW = LOUPE_W / LOUPE_ZOOM;
  const srcH = LOUPE_H / LOUPE_ZOOM;
  const srcX = Math.max(0, Math.min(cssW - srcW, touchX - srcW / 2));
  const srcY = cssH - srcH; // bottom strip: bars' base + the x-axis labels

  dst.width = LOUPE_W * dpr;
  dst.height = LOUPE_H * dpr;
  const ctx = dst.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, dst.width, dst.height);
  ctx.drawImage(
    src,
    srcX * dpr,
    srcY * dpr,
    srcW * dpr,
    srcH * dpr,
    0,
    0,
    dst.width,
    dst.height,
  );

  // Crosshair on the exact column under the fingertip (kept honest near the
  // edges, where the source patch is clamped and the finger is off-centre).
  const markerX = ((touchX - srcX) / srcW) * dst.width;
  ctx.strokeStyle = theme.colors.text.muted;
  ctx.lineWidth = dpr;
  ctx.beginPath();
  ctx.moveTo(markerX, 0);
  ctx.lineTo(markerX, dst.height);
  ctx.stroke();
};

const PriceChart: React.FC<{
  containerRef: React.RefObject<HTMLDivElement | null>;
  points: HourPrice[];
  yMin: number;
  yMax: number;
  now: number;
  selectedHour: string | null;
  onSelect: (hour: string, price: number) => void;
  onRelease: () => void;
  loupe: LoupeBox | null;
}> = ({
  containerRef,
  points,
  yMin,
  yMax,
  now,
  selectedHour,
  onSelect,
  onRelease,
  loupe,
}) => {
  const theme = useTheme();
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const prices = points.map((p) => p.price);

  // Redraw the loupe after React commits, so the magnified slice picks up the
  // freshly rendered selected-bar highlight rather than the previous frame.
  // (Touch handling and the loupe geometry live in the parent grid; this just
  // paints the magnifier for whichever chart is currently being scrubbed.)
  useEffect(() => {
    const canvas = containerRef.current?.querySelector("canvas") ?? null;
    if (loupe && canvas && loupeRef.current) {
      drawLoupe(loupeRef.current, canvas, loupe.touchX, theme);
    }
  }, [containerRef, loupe, selectedHour, theme]);

  // Time cues: past dimmed, current outlined (a thin border keeps its price hue
  // visible), and the scrubbed hour painted a solid accent fill so it stands out
  // even when the bar is near zero.
  const selIndex = selectedHour
    ? points.findIndex((p) => p.hour.slice(11, 13) === selectedHour)
    : -1;
  const bg: string[] = [];
  const borderColor: string[] = [];
  const borderWidth: number[] = [];
  points.forEach((p, i) => {
    const start = new Date(p.hour).getTime();
    const past = start + HOUR_MS <= now;
    const current = !past && start <= now;
    const selected = i === selIndex;
    bg.push(
      selected
        ? theme.colors.activity.on
        : past
          ? theme.colors.text.light
          : `hsl(${priceHue(p.price)}, 65%, 50%)`,
    );
    const outlineNow = current && !selected;
    borderColor.push(outlineNow ? theme.colors.text.main : "transparent");
    borderWidth.push(outlineNow ? 2 : 0);
  });

  const data = {
    labels: points.map((p) => p.hour.slice(11, 13)),
    datasets: [
      {
        data: prices,
        backgroundColor: bg,
        borderColor,
        borderWidth,
        borderRadius: 2,
        // Give near-zero hours a visible, aimable block instead of a hairline.
        minBarLength: 3,
      },
    ],
  };

  const options: ChartOptions<"bar"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    // Select by column (x), not by hitting the bar itself — short bars are easy
    // to tap, and dragging scrubs hour-to-hour.
    interaction: { mode: "index", intersect: false },
    // Mouse only: touch is driven by the grid-level handler, so leave it out here
    // to avoid double-handling (and the dead zone under the x-axis labels).
    events: ["mousemove", "mouseout"],
    // Surface the hovered hour to the card title instead of a popup the cursor
    // would cover.
    onHover: (_evt, elements) => {
      if (elements.length) {
        const p = points[elements[0].index];
        if (p) onSelect(p.hour.slice(11, 13), p.price);
      } else {
        // Cursor left the chart — start the revert countdown.
        onRelease();
      }
    },
    // Tooltip is registered globally by the other charts, so disable it here
    // explicitly — the scrubbed price shows in the card title instead.
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: theme.colors.text.muted,
          autoSkip: true,
          maxTicksLimit: 8,
          font: { size: 10 },
        },
      },
      y: { display: false, min: yMin, max: yMax },
    },
  };

  return (
    <div ref={containerRef} css={{ position: "relative", height: 120 }}>
      <Bar data={data} options={options} />
      {loupe && (
        <canvas
          ref={loupeRef}
          css={{
            position: "absolute",
            left: loupe.left,
            top: loupe.top,
            width: LOUPE_W,
            height: LOUPE_H,
            pointerEvents: "none",
            borderRadius: "50%",
            border: `1px solid ${theme.colors.border}`,
            boxShadow: theme.shadows.main,
            background: theme.colors.background.main,
            zIndex: 5,
          }}
        />
      )}
    </div>
  );
};

// The absolute colour scale as a thin gradient key (green = cheap → red = dear).
const ScaleLegend: React.FC<{ unit: string }> = ({ unit }) => {
  const theme = useTheme();
  const sub = { ...theme.typography.caption, color: theme.colors.text.muted };
  const red = (PRICE_HI / PRICE_MAX) * 100; // where the red point sits on 0..MAX
  return (
    <div
      css={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: "0.75em",
      }}
    >
      <span css={sub}>{PRICE_LO}</span>
      <div
        css={{
          flex: 1,
          height: 6,
          borderRadius: 3,
          background: `linear-gradient(to right, hsl(120,65%,50%) 0%, hsl(60,65%,50%) ${red / 2}%, hsl(0,65%,50%) ${red}%, hsl(320,65%,50%) ${red + (100 - red) * 0.6}%, hsl(285,65%,45%) 100%)`,
        }}
      />
      <span css={sub}>
        {PRICE_MAX}+ {unit}
      </span>
    </div>
  );
};

// Day label + price scale: that day's min–max, and for the day containing the
// current hour a "lowest – now – highest" readout so the live price has context.
// Costs no chart area, so the y-axis can stay hidden. (The scrubbed-hour price
// shows in the card title, where the touch loupe can't cover it.)
const DayHeader: React.FC<{
  label: string;
  points: HourPrice[];
  unit: string;
  now: number;
}> = ({ label, points, unit, now }) => {
  const theme = useTheme();
  const sub = { ...theme.typography.caption, color: theme.colors.text.muted };
  const ps = points.map((p) => p.price);
  const current = points.find((p) => {
    const start = new Date(p.hour).getTime();
    return start <= now && now < start + HOUR_MS;
  })?.price;

  return (
    <div
      css={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        marginBottom: 4,
        ...sub,
      }}
    >
      <span>{label}</span>
      {ps.length > 0 && (
        <span>
          {fmtPrice(Math.min(...ps), 1)}
          {current !== undefined ? (
            <>
              {" – "}
              <span css={{ color: theme.colors.text.main, fontWeight: 600 }}>
                {fmtPrice(current, 1)}
              </span>
              {" – "}
            </>
          ) : (
            "–"
          )}
          {fmtPrice(Math.max(...ps), 1)} {unit}
        </span>
      )}
    </div>
  );
};

// One day's header + chart. Selection is owned by the card so a single title can
// report whichever day is being scrubbed; this just forwards its hover events up
// tagged with the day, and highlights its own bar when that day is selected.
const DayPanel: React.FC<{
  label: string;
  day: DayKey;
  points: HourPrice[];
  unit: string;
  yMin: number;
  yMax: number;
  now: number;
  selected: Selected | null;
  onSelect: (day: DayKey, hour: string, price: number) => void;
  onRelease: () => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
  loupe: LoupeBox | null;
  emptyMessage?: string;
}> = ({
  label,
  day,
  points,
  unit,
  yMin,
  yMax,
  now,
  selected,
  onSelect,
  onRelease,
  containerRef,
  loupe,
  emptyMessage,
}) => {
  const theme = useTheme();
  const sub = { ...theme.typography.caption, color: theme.colors.text.muted };

  return (
    <div css={{ minWidth: 0 }}>
      <DayHeader label={label} points={points} unit={unit} now={now} />
      {points.length ? (
        <PriceChart
          containerRef={containerRef}
          points={points}
          yMin={yMin}
          yMax={yMax}
          now={now}
          selectedHour={selected?.day === day ? selected.hour : null}
          onSelect={(hour, price) => onSelect(day, hour, price)}
          onRelease={onRelease}
          loupe={loupe}
        />
      ) : (
        <div
          css={{
            ...sub,
            height: 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {emptyMessage}
        </div>
      )}
    </div>
  );
};

const SpotPrice: React.FC<{ className?: string }> = ({ className }) => {
  const theme = useTheme();
  const [data, setData] = useState<SpotResponse>();
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // Scrubbed-hour selection, shared across both day charts so the card title can
  // report whichever one is being touched. Falls back to the default title after
  // REVERT_MS of no interaction.
  const [selected, setSelected] = useState<Selected | null>(null);
  const timerRef = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timerRef.current), []);
  // While the finger/cursor is on a bar: show it and cancel any pending revert
  // (no timer runs during interaction, so a press-and-hold won't blank mid-touch).
  const select = useCallback((day: DayKey, hour: string, price: number) => {
    window.clearTimeout(timerRef.current);
    // Same object identity for an unchanged selection so a steady hover doesn't
    // churn the charts on every mousemove.
    setSelected((prev) =>
      prev && prev.day === day && prev.hour === hour
        ? prev
        : { day, hour, price },
    );
  }, []);
  // On release (finger lifts / cursor leaves): one revert timer, replacing any
  // previous one — never several in parallel.
  const scheduleRevert = useCallback(() => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setSelected(null), REVERT_MS);
  }, []);

  // Touch is handled here at the grid level, not per-chart, for two reasons:
  // a touch is captured by the element it starts on, so this lets a drag glide
  // from one day's chart onto the other's; and selection is purely by x (any y),
  // so near-zero bars tucked under the x-axis labels stay reachable.
  const todayRef = useRef<HTMLDivElement | null>(null);
  const tomorrowRef = useRef<HTMLDivElement | null>(null);
  const [loupe, setLoupe] = useState<({ day: DayKey } & LoupeBox) | null>(null);

  const handleGridTouch = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!data) return;
    const t = e.touches[0];
    if (!t) return;
    // Pick the chart the finger is nearest (works for both the side-by-side and
    // the stacked single-column layouts).
    let best: {
      day: DayKey;
      canvas: HTMLCanvasElement;
      rect: DOMRect;
      points: HourPrice[];
      dist: number;
    } | null = null;
    for (const day of ["today", "tomorrow"] as DayKey[]) {
      const points = day === "today" ? data.today : data.tomorrow;
      if (!points.length) continue;
      const canvas =
        (day === "today" ? todayRef : tomorrowRef).current?.querySelector(
          "canvas",
        ) ?? null;
      if (!canvas) continue;
      const rect = canvas.getBoundingClientRect();
      const dx = Math.max(rect.left - t.clientX, 0, t.clientX - rect.right);
      const dy = Math.max(rect.top - t.clientY, 0, t.clientY - rect.bottom);
      const dist = Math.hypot(dx, dy);
      if (!best || dist < best.dist) best = { day, canvas, rect, points, dist };
    }
    if (!best || best.dist > 60) return; // touch isn't on either chart

    const chart = ChartJS.getChart(best.canvas);
    if (!chart) return;
    const xCss = t.clientX - best.rect.left;
    const idx = Math.max(
      0,
      Math.min(
        best.points.length - 1,
        Math.round(chart.scales.x.getValueForPixel(xCss) ?? 0),
      ),
    );
    const p = best.points[idx];
    select(best.day, p.hour.slice(11, 13), p.price);

    const touchX = Math.max(0, Math.min(best.rect.width, xCss));
    const left = Math.max(
      0,
      Math.min(best.rect.width - LOUPE_W, touchX - LOUPE_W / 2),
    );
    const top = t.clientY - best.rect.top - LOUPE_H - LOUPE_GAP;
    setLoupe({ day: best.day, left, top, touchX });
  };
  const endGridTouch = () => {
    setLoupe(null);
    scheduleRevert();
  };
  // The colour-scale gradient is hidden by default to save space; tapping the
  // header reveals it (no button/placeholder), remembered across reloads.
  const [showScale, setShowScale] = useState(
    () => localStorage.getItem(SCALE_KEY) === "1",
  );
  const toggleScale = () =>
    setShowScale((v) => {
      localStorage.setItem(SCALE_KEY, v ? "0" : "1");
      return !v;
    });

  useEffect(() => {
    let controller: AbortController | null = null;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      fetch(api("/api/spot"), { signal: controller.signal })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((d: SpotResponse) => {
          setData(d);
          setError(false);
          setNow(Date.now());
        })
        .catch((err) => {
          if (err.name !== "AbortError") setError(true);
        });
    };

    load();
    // Refresh periodically and whenever the device wakes / the tab refocuses, so
    // the day rollover (tomorrow→today at 00:00) and the current-hour highlight
    // update instead of freezing at mount time.
    const interval = setInterval(load, 5 * 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      controller?.abort();
    };
  }, []);

  const sub = { ...theme.typography.caption, color: theme.colors.text.muted };

  // Shared y-range across both days so bar heights are comparable (an expensive
  // day towers over a cheap one) and consistent with the absolute colour scale.
  const allPrices = data
    ? [...data.today, ...data.tomorrow].map((p) => p.price)
    : [];
  const yMax = allPrices.length ? Math.max(0, ...allPrices) * 1.08 : 1;
  const yMin = allPrices.length ? Math.min(0, ...allPrices) : 0;

  return (
    <div
      className={className}
      css={{
        backgroundColor: theme.colors.background.main,
        boxShadow: theme.shadows.main,
        borderRadius: theme.border.radius,
        padding: "1.25em 1.5em",
        [mq[0]]: { padding: "1em" },
      }}
    >
      <div
        onClick={toggleScale}
        css={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "0.75em",
          gap: 16,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <div
          css={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            minWidth: 0,
          }}
        >
          <span css={{ fontFamily: theme.fonts.heading, fontSize: 16 }}>
            pörssisähkö
          </span>
          {data && selected && (
            <span
              css={{
                ...sub,
                color: theme.colors.activity.on,
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {fmtPrice(selected.price, 2)} {data.unit}
            </span>
          )}
        </div>
        {data && (
          <div css={{ ...sub, whiteSpace: "nowrap" }}>
            ka. {fmtPrice(data.todayAverage, 2)} {data.unit}
          </div>
        )}
      </div>

      {error ? (
        <div css={{ ...sub, padding: "2em 0", textAlign: "center" }}>
          Hintatietoja ei saatavilla
        </div>
      ) : !data ? (
        <div css={{ ...sub, padding: "2em 0", textAlign: "center" }}>
          Ladataan...
        </div>
      ) : (
        <>
          {showScale && <ScaleLegend unit={data.unit} />}
          <div
            onTouchStart={handleGridTouch}
            onTouchMove={handleGridTouch}
            onTouchEnd={endGridTouch}
            onTouchCancel={endGridTouch}
            css={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 20,
              [mq[0]]: { gridTemplateColumns: "1fr", gap: 12 },
              touchAction: "pan-y", // page scrolls vertically; charts scrub horizontally
              userSelect: "none",
              WebkitTapHighlightColor: "transparent", // no grey flash on tap (iOS Safari)
            }}
          >
            {/* minWidth:0 lets the grid columns shrink below the canvas's
                intrinsic width, so the charts scale on narrow phones instead
                of overflowing. */}
            <DayPanel
              label="tänään"
              day="today"
              points={data.today}
              unit={data.unit}
              yMin={yMin}
              yMax={yMax}
              now={now}
              selected={selected}
              onSelect={select}
              onRelease={scheduleRevert}
              containerRef={todayRef}
              loupe={loupe?.day === "today" ? loupe : null}
            />
            <DayPanel
              label="huomenna"
              day="tomorrow"
              points={data.tomorrow}
              unit={data.unit}
              yMin={yMin}
              yMax={yMax}
              now={now}
              selected={selected}
              onSelect={select}
              onRelease={scheduleRevert}
              containerRef={tomorrowRef}
              loupe={loupe?.day === "tomorrow" ? loupe : null}
              emptyMessage="Huomisen hinnat klo 14 jälkeen"
            />
          </div>
        </>
      )}
    </div>
  );
};

export default memo(SpotPrice);
