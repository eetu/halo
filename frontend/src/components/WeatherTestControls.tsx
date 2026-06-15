import { useTheme } from "@emotion/react";

export type WeatherTestCase = {
  id: string;
  label: string;
  symbol: number;
  isNight: boolean;
  // optional precipitation override, mm/h, to preview rain/snow intensity
  precip?: number;
};

// Representative FMI WeatherSymbol3 codes, one per animation kind.
const CASES: WeatherTestCase[] = [
  { id: "live", label: "live", symbol: -1, isNight: false },
  { id: "clear-day", label: "selkeä ☀", symbol: 1, isNight: false },
  { id: "clear-night", label: "selkeä ☾", symbol: 1, isNight: true },
  { id: "partly", label: "puolipilv.", symbol: 2, isNight: false },
  { id: "cloudy", label: "pilvinen", symbol: 3, isNight: false },
  { id: "fog", label: "sumu", symbol: 92, isNight: false },
  { id: "drizzle", label: "tihku", symbol: 31, isNight: false, precip: 0.4 },
  { id: "showers", label: "kuuro", symbol: 21, isNight: false, precip: 2 },
  { id: "rain", label: "rankka", symbol: 31, isNight: false, precip: 7 },
  { id: "sleet", label: "räntä", symbol: 71, isNight: false, precip: 2 },
  { id: "snow", label: "lumi", symbol: 52, isNight: false, precip: 2.5 },
  { id: "thunder", label: "ukkonen", symbol: 61, isNight: false, precip: 6 },
];

type WeatherTestControlsProps = {
  activeId: string;
  onSelect: (testCase: WeatherTestCase) => void;
};

const WeatherTestControls: React.FC<WeatherTestControlsProps> = ({
  activeId,
  onSelect,
}) => {
  const theme = useTheme();

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      css={{
        position: "absolute",
        top: 6,
        right: 6,
        zIndex: 2,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "flex-end",
        gap: 4,
        maxWidth: "70%",
        padding: 4,
        borderRadius: theme.border.radius,
        backgroundColor: theme.colors.background.light,
        border: `1px ${theme.colors.border} solid`,
        boxShadow: theme.shadows.main,
      }}
    >
      {CASES.map((c) => {
        const active = c.id === activeId;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c)}
            css={{
              cursor: "pointer",
              border: "none",
              borderRadius: 4,
              padding: "3px 7px",
              fontFamily: theme.fonts.heading,
              fontSize: 11,
              lineHeight: 1.2,
              color: active
                ? theme.colors.activity.on
                : theme.colors.text.muted,
              backgroundColor: active
                ? theme.colors.activity.onSoft
                : "transparent",
              "&:hover": { color: theme.colors.text.main },
            }}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
};

export default WeatherTestControls;
