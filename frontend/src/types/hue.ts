export type Sensor = {
  id: string;
  deviceId: string;
  name: string;
  temperature?: number;
  type: "inside" | "inside_cold" | "outside";
  enabled: boolean;
  battery?: number;
  connected: boolean;
};

export type Group = {
  id: string;
  name: string;
  state: { on: boolean; brightness?: number };
};

export type MotionMemberKind = "sensor" | "area";

export type MotionMember = {
  id: string;
  kind: MotionMemberKind;
  name: string;
  enabled: boolean;
  sensitivity?: { value: number; max: number };
};

export type MotionUnit = {
  id: string;
  name: string;
  motionServiceId: string;
  motion?: boolean;
  motionUpdatedAt?: string;
  members: MotionMember[];
  /**
   * darkThreshold and lightLevel are Hue light levels; darkThreshold is null
   * when daylight is ignored. lightLevel is the reading the automation compares.
   */
  daylight?: {
    automationId: string;
    darkThreshold: number | null;
    lightLevelServiceId?: string;
    lightLevel?: number;
  };
};

export type Response = {
  sensors: Sensor[];
  groups: Group[];
  motionUnits: MotionUnit[];
};

export type HueLiveEvent =
  | {
      type: "grouped_light";
      id: string;
      on?: boolean;
      brightness?: number;
    }
  | { type: "temperature"; id: string; temperature: number }
  | { type: "device_power"; deviceId: string; battery: number }
  | { type: "motion"; id: string; motion: boolean; updatedAt: string }
  | { type: "motion_enabled"; id: string; enabled: boolean }
  | { type: "motion_sensitivity"; id: string; sensitivity: number }
  | { type: "light_level"; id: string; level: number }
  | { type: "daylight"; automationId: string; darkThreshold: number | null }
  | { type: "connectivity"; deviceId: string; connected: boolean };
