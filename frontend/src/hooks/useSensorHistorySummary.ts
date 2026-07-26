import { useMemo } from "react";
import useSWR from "swr";

import { api, fetcher } from "../api";
import { Sensor } from "../types/hue";

type Reading = {
  sensorId: string;
  temperature: number;
  recordedAt: string;
};

const HOURS = 24;
const BUCKETS = 48;

type Summary = {
  points: number[];
  minTemp: number | null;
  maxTemp: number | null;
  diff1h: number | null;
};

const empty: Summary = {
  points: [],
  minTemp: null,
  maxTemp: null,
  diff1h: null,
};

const useSensorHistorySummary = (sensors: Sensor[]): Summary => {
  const { data } = useSWR<Reading[]>(api(`/api/history/sensors?hours=${HOURS}`), fetcher, {
    refreshInterval: 300_000,
    refreshWhenHidden: true,
  });

  const ids = sensors
    .filter((s) => s.enabled && s.connected)
    .map((s) => s.id)
    .sort()
    .join(",");

  return useMemo(() => {
    if (!data || ids.length === 0) return empty;
    const idSet = new Set(ids.split(","));
    const filtered = data.filter((r) => idSet.has(r.sensorId));
    if (filtered.length === 0) return empty;

    const latest = filtered.reduce((acc, r) => Math.max(acc, new Date(r.recordedAt).getTime()), 0);
    const windowMs = HOURS * 3600_000;
    const bucketMs = windowMs / BUCKETS;
    const windowStart = latest - windowMs;
    const buckets = Array.from({ length: BUCKETS }, () => ({
      sum: 0,
      count: 0,
    }));
    for (const r of filtered) {
      const t = new Date(r.recordedAt).getTime();
      const idx = Math.floor((t - windowStart) / bucketMs);
      if (idx < 0 || idx >= BUCKETS) continue;
      buckets[idx].sum += r.temperature;
      buckets[idx].count++;
    }
    const points = buckets
      .map((b) => (b.count > 0 ? b.sum / b.count : null))
      .filter((v): v is number => v !== null);

    const temps = filtered.map((r) => r.temperature);
    const minTemp = Math.min(...temps);
    const maxTemp = Math.max(...temps);

    const oneHourAgo = latest - 3600_000;
    const twoHoursAgo = latest - 2 * 3600_000;
    const recent: number[] = [];
    const prior: number[] = [];
    for (const r of filtered) {
      const t = new Date(r.recordedAt).getTime();
      if (t >= oneHourAgo) recent.push(r.temperature);
      else if (t >= twoHoursAgo) prior.push(r.temperature);
    }
    const avg = (arr: number[]) =>
      arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length;
    const recentAvg = avg(recent);
    const priorAvg = avg(prior);
    const diff1h = recentAvg !== null && priorAvg !== null ? recentAvg - priorAvg : null;

    return { points, minTemp, maxTemp, diff1h };
  }, [data, ids]);
};

export default useSensorHistorySummary;
