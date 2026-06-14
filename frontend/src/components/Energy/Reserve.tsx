import { useTheme } from "@emotion/react";
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  ChartData,
  ChartOptions,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { format } from "date-fns";
import { fi } from "date-fns/locale/fi";
import { memo, useEffect, useState } from "react";
import { Chart } from "react-chartjs-2";

import { api } from "../../api";
import { mq } from "../../mq";
import { ReserveResponse } from "../../types/reserve";

ChartJS.register(
  BarController,
  BarElement,
  CategoryScale,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
);

const eur = (v: number) => `${v.toFixed(2)} €`;

const RANGES = [
  { label: "12kk", months: 12 },
  { label: "24kk", months: 24 },
  { label: "kaikki", months: Infinity },
] as const;
type Range = (typeof RANGES)[number];

const Reserve: React.FC<{ className?: string }> = ({ className }) => {
  const theme = useTheme();
  const [data, setData] = useState<ReserveResponse>();
  const [error, setError] = useState(false);
  const [range, setRange] = useState<Range>(RANGES[0]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(api("/api/reserve?steps=month"), { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: ReserveResponse) => {
        setData(d);
        setError(false);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(true);
      });
    return () => controller.abort();
  }, []);

  // Header totals stay lifetime (from the API); the chart shows a recent window
  // so it stays legible on a narrow phone as months accumulate.
  const allPoints = data?.points ?? [];
  const points =
    range.months === Infinity ? allPoints : allPoints.slice(-range.months);
  const labels = points.map((p) =>
    format(new Date(p.bucketStart), "LLL yy", { locale: fi }),
  );
  const tickColor = theme.colors.text.muted;

  // One bar = total reserve income, split at the fee threshold: the grey base is
  // the part the fee eats, the green top is what clears it (= payout). The two
  // bar segments stack to gross; the threshold line gets its own stack id so the
  // stacked y-axis renders it at its true value rather than summing.
  const chartData: ChartData<"bar" | "line", number[], string> = {
    labels,
    datasets: [
      {
        type: "bar",
        label: "tulot",
        data: points.map((p) => p.gross - p.payout),
        backgroundColor: theme.colors.rain,
        stack: "income",
        borderWidth: 0,
      },
      {
        type: "bar",
        label: "hyvitys",
        data: points.map((p) => p.payout),
        backgroundColor: theme.colors.connected,
        stack: "income",
        borderWidth: 0,
      },
      {
        type: "line",
        label: "maksuraja",
        data: points.map((p) => p.fee),
        borderColor: theme.colors.activity.on,
        borderDash: [4, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        stepped: true,
        stack: "fee",
      },
    ],
  };

  const options: ChartOptions<"bar" | "line"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "bottom",
        labels: { color: theme.colors.text.main, boxWidth: 12, padding: 14 },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${eur(ctx.parsed.y ?? 0)}`,
          footer: (items) =>
            `reservitulo ${eur(
              items
                .filter((i) => i.dataset.type === "bar")
                .reduce((s, i) => s + (i.parsed.y ?? 0), 0),
            )}`,
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        ticks: {
          color: tickColor,
          autoSkip: true,
          maxRotation: 45,
          minRotation: 45,
        },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        grid: { tickBorderDash: [2, 2] },
        ticks: { color: tickColor, callback: (v) => `${v} €` },
      },
    },
  };

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
        css={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "1em",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div css={{ fontFamily: theme.fonts.heading, fontSize: 16 }}>
          reservimarkkina
        </div>
        {data && (
          <span
            css={{
              fontFamily: theme.fonts.heading,
              fontSize: 20,
              color:
                data.totalPayout > 0
                  ? theme.colors.connected
                  : theme.colors.text.main,
            }}
          >
            {eur(data.totalPayout)}
          </span>
        )}
      </div>
      {data && allPoints.length > RANGES[0].months && (
        <div
          css={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginBottom: "1em",
          }}
        >
          {RANGES.map((r) => {
            const active = r.months === range.months;
            return (
              <button
                key={r.label}
                onClick={() => setRange(r)}
                css={{
                  cursor: "pointer",
                  padding: "5px 12px",
                  borderRadius: theme.border.radius,
                  border: `1px solid ${active ? theme.colors.activity.on : theme.colors.border}`,
                  backgroundColor: active
                    ? theme.colors.activity.onSoft
                    : theme.colors.background.main,
                  color: active
                    ? theme.colors.activity.on
                    : theme.colors.text.main,
                  ...theme.typography.body2,
                  transition: "all 0.15s",
                }}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      )}
      <div css={{ position: "relative", height: 280 }}>
        {error ? (
          <Centered color={tickColor}>Reservidataa ei saatavilla</Centered>
        ) : !data ? (
          <Centered color={tickColor}>Ladataan...</Centered>
        ) : points.length === 0 ? (
          <Centered color={tickColor}>Ei reservidataa</Centered>
        ) : (
          <Chart<"bar" | "line", number[], string>
            type="bar"
            data={chartData}
            options={options}
          />
        )}
      </div>
    </div>
  );
};

const Centered: React.FC<{ color: string; children: React.ReactNode }> = ({
  color,
  children,
}) => (
  <div
    css={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      height: "100%",
      color,
    }}
  >
    {children}
  </div>
);

export default memo(Reserve);
