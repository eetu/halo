import { useTheme } from "@emotion/react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  ChartOptions,
  ChartType,
  LinearScale,
  Tooltip,
  TooltipPositionerFunction,
} from "chart.js";
import { memo, useEffect, useState } from "react";
import { Bar } from "react-chartjs-2";

import { api } from "../../api";
import { mq } from "../../mq";
import { HourPrice, SpotResponse } from "../../types/spot";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip);

declare module "chart.js" {
  interface TooltipPositionerMap {
    aboveCursor: TooltipPositionerFunction<ChartType>;
  }
}

// Pin the tooltip to the top of the chart at the pointer's x — on touch it then
// rides above the fingertip (and slides along while scrubbing) instead of
// hiding under it.
Tooltip.positioners.aboveCursor = function (_items, evt) {
  return { x: evt.x, y: this.chart.chartArea.top };
};

const HOUR_MS = 3_600_000;
const SCALE_KEY = "halo.spot.showScale";

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

const PriceChart: React.FC<{
  points: HourPrice[];
  unit: string;
  yMin: number;
  yMax: number;
  now: number;
}> = ({ points, unit, yMin, yMax, now }) => {
  const theme = useTheme();
  const prices = points.map((p) => p.price);

  // Time cues kept orthogonal to hue: past dimmed (alpha), current outlined.
  const bg: string[] = [];
  const borderColor: string[] = [];
  const borderWidth: number[] = [];
  points.forEach((p) => {
    const start = new Date(p.hour).getTime();
    const past = start + HOUR_MS <= now;
    const current = !past && start <= now;
    bg.push(
      past ? theme.colors.text.light : `hsl(${priceHue(p.price)}, 65%, 50%)`,
    );
    borderColor.push(current ? theme.colors.text.main : "transparent");
    borderWidth.push(current ? 2 : 0);
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
    plugins: {
      legend: { display: false },
      tooltip: {
        position: "aboveCursor",
        caretSize: 0,
        displayColors: false,
        callbacks: {
          title: (items) => `klo ${items[0].label}`,
          label: (ctx) => `${(ctx.parsed.y as number).toFixed(2)} ${unit}`,
        },
      },
    },
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
    <div
      css={{
        position: "relative",
        height: 120,
        touchAction: "pan-y", // let the page scroll vertically; chart scrubs horizontally
        userSelect: "none",
        WebkitTapHighlightColor: "transparent", // no grey flash on tap (iOS Safari)
      }}
    >
      <Bar data={data} options={options} />
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
// Costs no chart area, so the y-axis can stay hidden.
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
          {Math.min(...ps).toFixed(1)}
          {current !== undefined ? (
            <>
              {" – "}
              <span css={{ color: theme.colors.text.main, fontWeight: 600 }}>
                {current.toFixed(1)}
              </span>
              {" – "}
            </>
          ) : (
            "–"
          )}
          {Math.max(...ps).toFixed(1)} {unit}
        </span>
      )}
    </div>
  );
};

const SpotPrice: React.FC<{ className?: string }> = ({ className }) => {
  const theme = useTheme();
  const [data, setData] = useState<SpotResponse>();
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
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
        <div css={{ fontFamily: theme.fonts.heading, fontSize: 16 }}>
          pörssisähkö
        </div>
        {data && (
          <div css={sub}>
            ka. {data.todayAverage.toFixed(2)} {data.unit}
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
            css={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 20,
              [mq[0]]: { gridTemplateColumns: "1fr", gap: 12 },
            }}
          >
            {/* minWidth:0 lets the grid columns shrink below the canvas's
                intrinsic width, so the charts scale on narrow phones instead
                of overflowing. */}
            <div css={{ minWidth: 0 }}>
              <DayHeader
                label="tänään"
                points={data.today}
                unit={data.unit}
                now={now}
              />
              <PriceChart
                points={data.today}
                unit={data.unit}
                yMin={yMin}
                yMax={yMax}
                now={now}
              />
            </div>
            <div css={{ minWidth: 0 }}>
              <DayHeader
                label="huomenna"
                points={data.tomorrow}
                unit={data.unit}
                now={now}
              />
              {data.tomorrow.length ? (
                <PriceChart
                  points={data.tomorrow}
                  unit={data.unit}
                  yMin={yMin}
                  yMax={yMax}
                  now={now}
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
                  Huomisen hinnat klo 14 jälkeen
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default memo(SpotPrice);
