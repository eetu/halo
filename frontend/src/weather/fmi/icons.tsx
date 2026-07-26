import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudRain,
  CloudSnow,
  CloudSun,
  type LucideIcon,
  Moon,
  Snowflake,
  Sun,
  Zap,
} from "lucide-react";

type WeatherIconMapping = {
  icon: LucideIcon;
  description: string;
};

// FMI WeatherSymbol3 codes
export const fmiWeatherIconMap: Record<number, WeatherIconMapping> = {
  1: { icon: Sun, description: "Selkeä" },
  2: { icon: CloudSun, description: "Puolipilvinen" },
  3: { icon: Cloud, description: "Pilvinen" },
  21: { icon: CloudDrizzle, description: "Heikkoja sadekuuroja" },
  22: { icon: CloudRain, description: "Sadekuuroja" },
  23: { icon: CloudRain, description: "Voimakkaita sadekuuroja" },
  31: { icon: CloudDrizzle, description: "Heikkoa vesisadetta" },
  32: { icon: CloudRain, description: "Vesisadetta" },
  33: { icon: CloudRain, description: "Voimakasta vesisadetta" },
  41: { icon: CloudSnow, description: "Heikkoja lumikuuroja" },
  42: { icon: CloudSnow, description: "Lumikuuroja" },
  43: { icon: CloudSnow, description: "Voimakkaita lumikuuroja" },
  51: { icon: CloudSnow, description: "Heikkoa lumisadetta" },
  52: { icon: CloudSnow, description: "Lumisadetta" },
  53: { icon: Snowflake, description: "Voimakasta lumisadetta" },
  61: { icon: Zap, description: "Ukkoskuuroja" },
  62: { icon: Zap, description: "Voimakkaita ukkoskuuroja" },
  63: { icon: Zap, description: "Ukkosta" },
  64: { icon: Zap, description: "Voimakasta ukkosta" },
  71: { icon: CloudRain, description: "Heikkoa räntäsadetta" },
  72: { icon: CloudRain, description: "Räntäsadetta" },
  73: { icon: CloudRain, description: "Voimakasta räntäsadetta" },
  81: { icon: CloudDrizzle, description: "Heikkoja räntäkuuroja" },
  82: { icon: CloudRain, description: "Räntäkuuroja" },
  83: { icon: CloudRain, description: "Voimakkaita räntäkuuroja" },
  91: { icon: CloudFog, description: "Utua" },
  92: { icon: CloudFog, description: "Sumua" },
};

export const getFmiWeatherIcon = (weatherSymbol: number, isNight?: boolean): LucideIcon => {
  const mapping = fmiWeatherIconMap[weatherSymbol];

  if (!mapping) {
    return Cloud;
  }

  if (isNight && weatherSymbol === 1) {
    return Moon;
  }

  return mapping.icon;
};

export const getFmiWeatherDescription = (weatherSymbol: number): string => {
  return fmiWeatherIconMap[weatherSymbol]?.description || "Tuntematon";
};
