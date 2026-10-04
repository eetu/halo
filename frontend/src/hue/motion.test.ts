import {
  DARK_THRESHOLD_MAX,
  DARK_THRESHOLD_MIN,
  formatLux,
  levelToLux,
  luxToLevel,
  sensitivityLabel,
} from "./motion";

describe("light level", () => {
  test("round-trips through lux", () => {
    expect(luxToLevel(levelToLux(14477))).toBe(14477);
  });

  test("slider spans 1–1000 lx", () => {
    expect(DARK_THRESHOLD_MIN).toBe(1);
    expect(DARK_THRESHOLD_MAX).toBe(30001);
  });

  test("formats in Finnish, with a decimal only below 10 lx", () => {
    expect(formatLux(14477)).toBe("28 lx");
    expect(formatLux(luxToLevel(2.5))).toBe("2,5 lx");
  });
});

describe("sensitivityLabel", () => {
  test("names the level on both sensor scales", () => {
    expect(sensitivityLabel(2, 2)).toBe("korkea");
    expect(sensitivityLabel(2, 4)).toBe("normaali");
  });

  test("falls back to a fraction on an unknown scale", () => {
    expect(sensitivityLabel(1, 3)).toBe("2/4");
  });
});
