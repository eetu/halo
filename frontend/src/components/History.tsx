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
import { memo } from "react";
import { useEffect, useState } from "react";
import { Chart } from "react-chartjs-2";

import { api } from "../api";
import useScreenshotMode, { anonymize } from "../hooks/useScreenshotMode";

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

type SensorReading = {
  sensorId: string;
  sensorName: string;
  temperature: number;
  roomType: string;
  recordedAt: string;
};

const RANGES = [
  { label: "6h", hours: 6, maxPoints: undefined },
  { label: "24h", hours: 24, maxPoints: 288 },
  { label: "7pv", hours: 168, maxPoints: 336 },
  { label: "30pv", hours: 720, maxPoints: 720 },
] as const;

// Base hue ranges per room type to keep visual grouping
const ROOM_TYPE_HUE: Record<string, [number, number]> = {
  outside: [200, 240],
  inside: [270, 360],
  insidecold: [100, 160],
};

const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
};

const sensorColor = (sensorId: string, roomType: string): string => {
  const typeKey = roomType.replace("_", "");
  const [hueMin, hueMax] = ROOM_TYPE_HUE[typeKey] ?? [0, 360];
  const hash = hashString(sensorId);
  const hue = hueMin + (hash % (hueMax - hueMin));
  const saturation = 60 + (hash % 25);
  const lightness = 40 + ((hash >> 8) % 20);
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
};

type HistoryProps = {
  className?: string;
};

const History: React.FC<HistoryProps> = ({ className }) => {
  const theme = useTheme();
  const demo = useScreenshotMode();
  const [range, setRange] = useState<(typeof RANGES)[number]>(RANGES[1]);
  const [response, setResponse] = useState<{
    range: (typeof RANGES)[number];
    readings: SensorReading[];
  }>();
  const loading = !response || response.range !== range;
  const readings = response?.readings ?? [];

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ hours: String(range.hours) });
    if (range.maxPoints !== undefined) params.set("max_points", String(range.maxPoints));
    fetch(api(`/api/history/sensors?${params}`), { signal: controller.signal })
      .then((r) => r.json())
      .then((data: SensorReading[]) => {
        setResponse({ range, readings: data });
      })
      .catch((err) => {
        if (err.name !== "AbortError") setResponse({ range, readings: [] });
      });
    return () => controller.abort();
  }, [range]);

  // Group readings by sensor
  const bySensor = new Map<
    string,
    {
      id: string;
      name: string;
      roomType: string;
      points: { x: number; y: number }[];
    }
  >();
  for (const r of readings) {
    let sensor = bySensor.get(r.sensorId);
    if (!sensor) {
      sensor = {
        id: r.sensorId,
        name: r.sensorName,
        roomType: r.roomType,
        points: [],
      };
      bySensor.set(r.sensorId, sensor);
    }
    sensor.points.push({
      x: new Date(r.recordedAt).getTime(),
      y: r.temperature,
    });
  }

  // Assign colors per room type
  const datasets = [...bySensor.values()].map((sensor) => {
    const color = sensorColor(sensor.id, sensor.roomType);

    return {
      label: demo ? anonymize(sensor.id, "anturi") : sensor.name,
      data: sensor.points,
      borderColor: color,
      backgroundColor: color,
      pointRadius: 0,
      borderWidth: 2,
      cubicInterpolationMode: "monotone" as const,
    };
  });

  const chartData: ChartData<"line"> = { datasets };

  const tickColor = theme.colors.text.muted;

  const options: ChartOptions<"line"> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 0,
    },
    interaction: {
      mode: "index",
      intersect: false,
    },
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
        itemSort: (a, b) => (b.parsed.y ?? 0) - (a.parsed.y ?? 0),
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}°`,
        },
      },
    },
    scales: {
      x: {
        type: "time",
        time: {
          tooltipFormat: "d.M. HH:mm",
          displayFormats: {
            hour: "HH:mm",
            day: "d.M.",
          },
        },
        adapters: {
          date: { locale: fi },
        },
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
        grid: { tickBorderDash: [2, 2] },
        ticks: {
          color: tickColor,
          precision: 0,
          callback: (v) => `${v}°`,
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
        borderRadius: 6,
        padding: "1.5em",
        minHeight: 300,
      }}
    >
      <div
        css={{
          display: "flex",
          gap: 8,
          marginBottom: "1em",
        }}
      >
        {RANGES.map((r) => {
          const active = range.hours === r.hours;
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
      <div css={{ position: "relative", height: 300 }}>
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

export default memo(History);
