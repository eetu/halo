import { useMemo } from "react";
import useSWR from "swr";

import { api, fetcher } from "../api";
import type { Sensor } from "../types/hue";

type Reading = {
  sensorId: string;
  temperature: number;
  recordedAt: string;
};

const HOURS = 24;
const BUCKETS = 48;
const BUCKETS_PER_HOUR = BUCKETS / HOURS;

export type SeriesKind = "all" | "shade" | "sun";

export type Series = {
  kind: SeriesKind;
  /** One point per bucket with readings; every series of a summary drops the same buckets. */
  points: number[];
  min: number;
  max: number;
};

type Summary = {
  /** `[all]`, or `[shade, sun]` when split — lowest first. */
  series: Series[];
  /** Change of the first series over the last hour. */
  diff1h: number | null;
};

const empty: Summary = { series: [], diff1h: null };

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

const FOLD: Record<SeriesKind, (sensorMeans: number[]) => number> = {
  all: mean,
  shade: (v) => Math.min(...v),
  sun: (v) => Math.max(...v),
};

/**
 * 24 h of the sensors' history in half-hour buckets. `split` is for outdoor
 * sensors that catch the sun at times: each bucket folds into its coolest
 * sensor (shade, the air temperature) and its warmest (sun) instead of the mean.
 */
const useSensorHistorySummary = (sensors: Sensor[], split = false): Summary => {
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
    const bucketMs = 3600_000 / BUCKETS_PER_HOUR;
    const windowStart = latest - HOURS * 3600_000;
    const buckets = Array.from(
      { length: BUCKETS },
      () => new Map<string, { sum: number; count: number }>(),
    );
    for (const r of filtered) {
      const t = new Date(r.recordedAt).getTime();
      const idx = Math.min(BUCKETS - 1, Math.floor((t - windowStart) / bucketMs));
      if (idx < 0) continue;
      const acc = buckets[idx].get(r.sensorId) ?? { sum: 0, count: 0 };
      acc.sum += r.temperature;
      acc.count++;
      buckets[idx].set(r.sensorId, acc);
    }
    const sensorMeans = buckets.map((b) => [...b.values()].map((a) => a.sum / a.count));

    const kinds: SeriesKind[] = split && idSet.size > 1 ? ["shade", "sun"] : ["all"];
    const folded = kinds.map((kind) =>
      sensorMeans.map((v) => (v.length > 0 ? FOLD[kind](v) : null)),
    );

    const series = kinds.map((kind, i) => {
      const points = folded[i].filter((v): v is number => v !== null);
      return { kind, points, min: Math.min(...points), max: Math.max(...points) };
    });

    const hourMean = (values: (number | null)[]) => {
      const present = values.filter((v): v is number => v !== null);
      return present.length > 0 ? mean(present) : null;
    };
    const recent = hourMean(folded[0].slice(-BUCKETS_PER_HOUR));
    const prior = hourMean(folded[0].slice(-2 * BUCKETS_PER_HOUR, -BUCKETS_PER_HOUR));
    const diff1h = recent !== null && prior !== null ? recent - prior : null;

    return { series, diff1h };
  }, [data, ids, split]);
};

export default useSensorHistorySummary;
