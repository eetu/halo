import type { Accessory } from "../types/hue";

/** The bridge still calls 9 % normal, so the level decides too. */
const REPLACE_AT = 10;

export const needsReplacing = ({ battery, batteryState }: Accessory) =>
  batteryState === "low" ||
  batteryState === "critical" ||
  (battery !== undefined && battery <= REPLACE_AT);

/** Weakest first, unknown levels last. */
export const byBattery = (a: Accessory, b: Accessory) =>
  (a.battery ?? Number.POSITIVE_INFINITY) - (b.battery ?? Number.POSITIVE_INFINITY) ||
  a.name.localeCompare(b.name, "fi");
