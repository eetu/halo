import {
  DARK_THRESHOLD_MAX,
  DARK_THRESHOLD_MIN,
  formatLux,
  levelToLux,
  luxToLevel,
  sensitivityEnds,
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

describe("sensitivityEnds", () => {
  test("names both ends of each scale", () => {
    expect(sensitivityEnds(2)).toEqual(["matala", "korkea"]);
    expect(sensitivityEnds(4)).toEqual(["hyvin matala", "hyvin korkea"]);
  });

  test("still shows the direction on an unknown scale", () => {
    expect(sensitivityEnds(3)).toEqual(["matala", "korkea"]);
  });
});
