import type { TomorrowInterval } from "../../types/weather/tomorrow";

type Segment = {
  title: "aamu" | "päivä" | "ilta" | "yö";
  temp: number;
};

export const getTemperatureSegments = (intervals: TomorrowInterval[] = []) => {
  const result: Record<string, number | undefined> = {
    morning: undefined,
    day: undefined,
    evening: undefined,
    night: undefined,
  };
  const segments: Segment[] = [];

  intervals.forEach((interval) => {
    const startTime = new Date(interval.startTime);
    const hour = startTime.getHours();

    if (result.morning === undefined && hour >= 5 && hour < 12) {
      result.morning = interval.values.temperature;
      segments.push({ title: "aamu", temp: Math.round(result.morning ?? 0) });
    } else if (result.day === undefined && hour >= 12 && hour < 17) {
      result.day = interval.values.temperature;
      segments.push({ title: "päivä", temp: Math.round(result.day ?? 0) });
    } else if (result.evening === undefined && hour >= 17 && hour < 21) {
      result.evening = interval.values.temperature;
      segments.push({ title: "ilta", temp: Math.round(result.evening ?? 0) });
    } else if (result.night === undefined && (hour >= 21 || hour < 5)) {
      result.night = interval.values.temperature;
      segments.push({ title: "yö", temp: Math.round(result.night ?? 0) });
    }

    if (
      result.morning !== undefined &&
      result.day !== undefined &&
      result.evening !== undefined &&
      result.night !== undefined
    ) {
      return;
    }
  });

  return segments;
};
