import { useEffect, useState } from "react";

import { api } from "../api";
import { Sensor } from "../types/hue";

// Thresholds in °C for trend classification
const SMALL_CHANGE = 0.5;
const BIG_CHANGE = 2;

export type Trend = "big_up" | "up" | "stable" | "down" | "big_down";

export const getTrend = (diff: number): Trend => {
  if (diff >= BIG_CHANGE) return "big_up";
  if (diff >= SMALL_CHANGE) return "up";
  if (diff <= -BIG_CHANGE) return "big_down";
  if (diff <= -SMALL_CHANGE) return "down";
  return "stable";
};

type SensorReading = {
  sensorId: string;
  temperature: number;
  recordedAt: string;
};

const useSensorTrend = (sensors: Sensor[]): Trend | null => {
  const [trend, setTrend] = useState<Trend | null>(null);

  const enabledSensors = sensors.filter((s) => s.enabled && s.connected);
  const currentAvg =
    enabledSensors.length > 0
      ? enabledSensors.reduce((sum, s) => sum + (s.temperature ?? 0), 0) / enabledSensors.length
      : null;

  const sensorIds = enabledSensors
    .map((s) => s.id)
    .sort()
    .join(",");

  useEffect(() => {
    if (!sensorIds || currentAvg === null) return;
    const controller = new AbortController();

    fetch(api("/api/history/sensors?hours=2"), { signal: controller.signal })
      .then((r) => r.json())
      .then((readings: SensorReading[]) => {
        const ids = new Set(sensorIds.split(","));
        const relevant = readings.filter((r) => ids.has(r.sensorId));
        if (relevant.length === 0) {
          setTrend(null);
          return;
        }

        const oldestBySensor = new Map<string, number>();
        for (const r of relevant) {
          if (!oldestBySensor.has(r.sensorId)) {
            oldestBySensor.set(r.sensorId, r.temperature);
          }
        }

        const oldAvg =
          [...oldestBySensor.values()].reduce((a, b) => a + b, 0) / oldestBySensor.size;

        setTrend(getTrend(currentAvg - oldAvg));
      })
      .catch((err) => {
        if (err.name !== "AbortError") setTrend(null);
      });

    return () => controller.abort();
  }, [sensorIds, currentAvg]);

  return trend;
};

export default useSensorTrend;
