import "chartjs-adapter-date-fns";

import { useTheme } from "@emotion/react";
import {
  CategoryScale,
  Chart as ChartJS,
  ChartData,
  ChartOptions,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  TimeScale,
  Tooltip,
} from "chart.js";
import { format } from "date-fns";
import { fi } from "date-fns/locale/fi";
import { memo, useEffect, useState } from "react";
import { Chart } from "react-chartjs-2";

import { api } from "../../api";
import { mq } from "../../mq";
import { SolisReading } from "../../types/solis";

ChartJS.register(
  CategoryScale,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  TimeScale,
  Tooltip,
);

const RANGES = [
  { label: "24h", hours: 24, maxPoints: 288 },
  { label: "7pv", hours: 168, maxPoints: 336 },
  { label: "30pv", hours: 720, maxPoints: 720 },
] as const;

type Range = (typeof RANGES)[number];

const DailyHistory: React.FC<{ className?: string }> = ({ className }) => {
  const theme = useTheme();
  const [range, setRange] = useState<Range>(RANGES[0]);
  const [response, setResponse] = useState<{
    range: Range;
    readings: SolisReading[];
  }>();
  const loading = !response || response.range !== range;
  const readings = response?.readings ?? [];

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      hours: String(range.hours),
      max_points: String(range.maxPoints),
    });
    fetch(api(`/api/history/solis?${params}`), { signal: controller.signal })
      .then((r) => r.json())
      .then((data: SolisReading[]) => {
        setResponse({ range, readings: data });
      })
      .catch((err) => {
        if (err.name !== "AbortError") setResponse({ range, readings: [] });
      });
    return () => controller.abort();
  }, [range]);

  const colors = {
    pv: theme.colors.activity.on,
    battery: theme.colors.battery,
    grid: theme.colors.grid,
    soc: theme.colors.soc,
  };

  const points = readings.map((r) => ({
    t: new Date(r.recordedAt).getTime(),
    pv: r.power,
    battery: r.batteryPower,
    grid: r.gridPower,
    soc: r.batterySoc,
  }));

  const chartData: ChartData<"line"> = {
    datasets: [
      {
        label: "aurinko",
        data: points.map((p) => ({ x: p.t, y: p.pv })),
        borderColor: colors.pv,
        backgroundColor: colors.pv,
        borderWidth: 2,
        pointRadius: 0,
        cubicInterpolationMode: "monotone",
        yAxisID: "y",
      },
      {
        label: "akku",
        data: points.map((p) => ({ x: p.t, y: p.battery ?? null })),
        borderColor: colors.battery,
        backgroundColor: colors.battery,
        borderWidth: 1.5,
        pointRadius: 0,
        cubicInterpolationMode: "monotone",
        yAxisID: "y",
        spanGaps: false,
      },
      {
        label: "verkko",
        data: points.map((p) => ({ x: p.t, y: p.grid ?? null })),
        borderColor: colors.grid,
        backgroundColor: colors.grid,
        borderWidth: 1,
        pointRadius: 0,
        cubicInterpolationMode: "monotone",
        yAxisID: "y",
        spanGaps: false,
      },
      {
        label: "soc",
        data: points.map((p) => ({ x: p.t, y: p.soc ?? null })),
        borderColor: colors.soc,
        backgroundColor: colors.soc,
        borderWidth: 1.5,
        pointRadius: 0,
        borderDash: [3, 3],
        cubicInterpolationMode: "monotone",
        yAxisID: "ySoc",
        spanGaps: false,
      },
    ],
  };

  const tickColor = theme.colors.text.muted;

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          color: theme.colors.text.main,
          boxWidth: 12,
          padding: 15,
        },
      },
      tooltip: {
        itemSort: (a, b) => Math.abs(b.parsed.y ?? 0) - Math.abs(a.parsed.y ?? 0),
        callbacks: {
          label: (ctx) => {
            const v = ctx.parsed.y;
            if (v === null || v === undefined) return "";
            const unit = ctx.dataset.yAxisID === "ySoc" ? "%" : "kW";
            return `${ctx.dataset.label}: ${v.toFixed(2)} ${unit}`;
          },
        },
      },
    },
    scales: {
      x: {
        type: "time",
        time: {
          tooltipFormat: "d.M. HH:mm",
          displayFormats: { hour: "HH:mm", day: "d.M." },
        },
        adapters: { date: { locale: fi } },
        grid: { display: false },
        ticks: {
          color: tickColor,
          maxTicksLimit: 8,
          callback: (val) => {
            const d = new Date(val as number);
            return range.hours <= 24
              ? format(d, "HH.mm", { locale: fi })
              : format(d, "EEEEEE d.M.", { locale: fi });
          },
        },
      },
      y: {
        position: "left",
        grid: { tickBorderDash: [2, 2] },
        ticks: {
          color: tickColor,
          callback: (v) => `${v} kW`,
        },
      },
      ySoc: {
        position: "right",
        min: 0,
        max: 100,
        grid: { display: false },
        ticks: {
          color: tickColor,
          callback: (v) => `${v}%`,
        },
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
        [mq[0]]: {
          padding: "1em",
        },
      }}
    >
      <div
        css={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "1em",
          gap: 16,
        }}
      >
        <div
          css={{
            fontFamily: theme.fonts.heading,
            fontSize: 16,
          }}
        >
          {range.label === "24h" ? "tänään" : range.label} · kW / soc %
        </div>
        <div css={{ display: "flex", gap: 8 }}>
          {RANGES.map((r) => {
            const active = r.hours === range.hours;
            return (
              <button
                key={r.hours}
                onClick={() => setRange(r)}
                css={{
                  cursor: "pointer",
                  padding: "5px 12px",
                  borderRadius: theme.border.radius,
                  border: `1px solid ${active ? theme.colors.activity.on : theme.colors.border}`,
                  backgroundColor: active
                    ? theme.colors.activity.onSoft
                    : theme.colors.background.main,
                  color: active ? theme.colors.activity.on : theme.colors.text.main,
                  ...theme.typography.body2,
                  transition: "all 0.15s",
                }}
              >
                {r.label}
              </button>
            );
          })}
        </div>
      </div>
      <div css={{ position: "relative", height: 280 }}>
        {loading ? (
          <div
            css={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: theme.colors.text.muted,
            }}
          >
            Ladataan...
          </div>
        ) : readings.length === 0 ? (
          <div
            css={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: theme.colors.text.muted,
            }}
          >
            Ei historiadataa
          </div>
        ) : (
          <Chart type="line" data={chartData} options={options} />
        )}
      </div>
    </div>
  );
};

export default memo(DailyHistory);
