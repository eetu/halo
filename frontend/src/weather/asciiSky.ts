// Shared sky/kind helpers for the weather ASCII animation. Kept out of the
// component file so non-component exports don't trip react-refresh, and so the
// weather box can derive a matching divider colour without duplicating logic.

export type WeatherKind =
  | "clear-day"
  | "clear-night"
  | "partly-cloudy"
  | "clouds"
  | "rain"
  | "snow"
  | "thunder"
  | "fog";

// Map an FMI WeatherSymbol3 code to a coarse animation kind. Sleet (7x/8x) is
// folded into rain; partly-cloudy (2) gets a bluer, sunnier sky than full
// overcast (3); everything unrecognised falls back to the clear sky for the
// current time of day.
export function weatherSymbolToKind(
  symbol: number,
  isNight: boolean,
): WeatherKind {
  if (symbol >= 61 && symbol <= 64) return "thunder";
  if (symbol >= 41 && symbol <= 53) return "snow";
  if ((symbol >= 21 && symbol <= 33) || (symbol >= 71 && symbol <= 83))
    return "rain";
  if (symbol === 91 || symbol === 92) return "fog";
  if (symbol === 2) return "partly-cloudy";
  if (symbol === 3) return "clouds";
  return isNight ? "clear-night" : "clear-day";
}

// Divider tint matching the sky each field kind paints (see buildConfig in
// WeatherAsciiBackground) — a touch darker than the sky so the hairline still
// reads. Returns undefined for kinds that keep the card background, letting the
// box fall back to its default border.
export function weatherBorderColor(
  symbol: number,
  isNight: boolean,
  isDark: boolean,
): string | undefined {
  switch (weatherSymbolToKind(symbol, isNight)) {
    case "partly-cloudy":
      return isDark ? "#34465e" : "#9cbce0";
    case "clouds":
      return isDark ? "#313a48" : "#c2cad6";
    case "fog":
      return isDark ? "#2e3542" : "#cdd4de";
    default:
      return undefined;
  }
}
