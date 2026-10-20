import type { Accessory } from "../types/hue";
import { byBattery, needsReplacing } from "./battery";

const accessory = (name: string, battery?: number, batteryState?: Accessory["batteryState"]) => ({
  id: name,
  name,
  battery,
  batteryState,
  connected: true,
});

describe("needsReplacing", () => {
  test("trusts the bridge's verdict", () => {
    expect(needsReplacing(accessory("a", 40, "low"))).toBe(true);
    expect(needsReplacing(accessory("a", 1, "critical"))).toBe(true);
  });

  test("flags a level the bridge still calls normal", () => {
    expect(needsReplacing(accessory("a", 9, "normal"))).toBe(true);
    expect(needsReplacing(accessory("a", 11, "normal"))).toBe(false);
  });

  test("leaves an unknown level alone", () => {
    expect(needsReplacing(accessory("a"))).toBe(false);
  });
});

describe("byBattery", () => {
  test("puts the weakest first and unknown levels last", () => {
    const sorted = [
      accessory("ö", 50),
      accessory("b"),
      accessory("c", 5),
      accessory("a"),
      accessory("ä", 50),
    ].sort(byBattery);
    expect(sorted.map((a) => a.name)).toEqual(["c", "ä", "ö", "a", "b"]);
  });
});
