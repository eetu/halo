import { HourlyForecast } from "../../types/weather/fmi";

type Segment = {
  title: "aamu" | "päivä" | "ilta" | "yö";
  temp: number;
  weatherSymbol: number;
  // Local hour of the sampled forecast — the caller pairs it with sunrise/sunset
  // to pick the day or night icon variant.
  hour: number;
};

export const getFmiTemperatureSegments = (forecasts: HourlyForecast[] = []) => {
  const result: Record<string, number | undefined> = {
    morning: undefined,
    day: undefined,
    evening: undefined,
    night: undefined,
  };
  const segments: Segment[] = [];

  forecasts.forEach((forecast) => {
    const time = new Date(forecast.time);
    const hour = time.getHours();

    const symbol = forecast.weatherSymbol;

    if (result.morning === undefined && hour >= 5 && hour < 12) {
      result.morning = forecast.temperature;
      segments.push({
        title: "aamu",
        temp: Math.round(result.morning ?? 0),
        weatherSymbol: symbol,
        hour,
      });
    } else if (result.day === undefined && hour >= 12 && hour < 17) {
      result.day = forecast.temperature;
      segments.push({
        title: "päivä",
        temp: Math.round(result.day ?? 0),
        weatherSymbol: symbol,
        hour,
      });
    } else if (result.evening === undefined && hour >= 17 && hour < 21) {
      result.evening = forecast.temperature;
      segments.push({
        title: "ilta",
        temp: Math.round(result.evening ?? 0),
        weatherSymbol: symbol,
        hour,
      });
    } else if (result.night === undefined && (hour >= 21 || hour < 5)) {
      result.night = forecast.temperature;
      segments.push({
        title: "yö",
        temp: Math.round(result.night ?? 0),
        weatherSymbol: symbol,
        hour,
      });
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
