// Hue reports light as a level, 10000·log10(lux) + 1, so a slider over the
// level is already logarithmic in lux.
export const levelToLux = (level: number) => 10 ** ((level - 1) / 10000);
export const luxToLevel = (lux: number) => Math.round(10000 * Math.log10(lux) + 1);

/** Daylight slider range, 1–1000 lx. */
export const DARK_THRESHOLD_MIN = luxToLevel(1);
export const DARK_THRESHOLD_MAX = luxToLevel(1000);
/** Where the threshold starts when daylight is switched on: Hue's sensor default. */
export const DARK_THRESHOLD_DEFAULT = 16000;

/** Where a light level sits along the daylight slider, 0–1, pinned at the ends. */
export const thresholdFraction = (level: number) =>
  Math.min(
    1,
    Math.max(0, (level - DARK_THRESHOLD_MIN) / (DARK_THRESHOLD_MAX - DARK_THRESHOLD_MIN)),
  );

export const formatLux = (level: number) => {
  const lux = levelToLux(level);
  return `${lux.toLocaleString("fi-FI", { maximumFractionDigits: lux < 10 ? 1 : 0 })} lx`;
};

const SENSITIVITY_WORDS: Record<number, string[]> = {
  2: ["matala", "normaali", "korkea"],
  4: ["hyvin matala", "matala", "normaali", "korkea", "hyvin korkea"],
};

export const sensitivityLabel = (value: number, max: number) =>
  SENSITIVITY_WORDS[max]?.[value] ?? `${value + 1}/${max + 1}`;

/** The scale's two ends, so the direction shows before a level is picked. */
export const sensitivityEnds = (max: number): [string, string] => {
  const words = SENSITIVITY_WORDS[max];
  return words ? [words[0], words[words.length - 1]] : ["matala", "korkea"];
};
