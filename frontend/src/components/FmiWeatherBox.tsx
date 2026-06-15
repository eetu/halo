import { useTheme } from "@emotion/react";
import { format } from "date-fns";
import { fi } from "date-fns/locale/fi";
import { type LucideProps } from "lucide-react";
import { createElement, memo, useState } from "react";
import useSWR from "swr";

import { api, jsonFetcher } from "../api";
import useLocationSettings from "../hooks/useLocationSettings";
import useScreenshotMode from "../hooks/useScreenshotMode";
import { PvForecast } from "../types/pv";
import { WeatherData } from "../types/weather/fmi";
import {
  getFmiWeatherDescription,
  getFmiWeatherIcon,
} from "../weather/fmi/icons";
import { getFmiTemperatureSegments } from "../weather/fmi/utils";
import Arrow from "./Arrow";
import Box from "./Box";
import Icon from "./Icon";
import LocationForm from "./LocationForm";
import OfflineState from "./OfflineState";
import WeatherAsciiBackground from "./WeatherAsciiBackground";
import WeatherChart from "./WeatherChart";
import WeatherTestControls, {
  type WeatherTestCase,
} from "./WeatherTestControls";

type WeatherIconProps = {
  weatherSymbol: number;
  isNight: boolean;
} & LucideProps;

const WeatherIcon: React.FC<WeatherIconProps> = ({
  weatherSymbol,
  isNight,
  ...props
}) => createElement(getFmiWeatherIcon(weatherSymbol, isNight), props);

type WeatherBoxProps = {
  className?: string;
};

const WeatherBox: React.FC<WeatherBoxProps> = ({ className }) => {
  const theme = useTheme();
  const { location, isLoading: locationLoading } = useLocationSettings();
  const [now] = useState(() => new Date());
  const demo = useScreenshotMode();
  const [testCase, setTestCase] = useState<WeatherTestCase | null>(null);

  const weatherUrl = location
    ? api(`/api/weather/fmi?lat=${location.lat}&lon=${location.lon}`)
    : null;

  const { data, error } = useSWR<WeatherData>(weatherUrl, jsonFetcher, {
    refreshInterval: 3600000,
    refreshWhenHidden: true,
    shouldRetryOnError: false,
  });

  const { data: pvForecast } = useSWR<PvForecast>(
    api("/api/pv/forecast"),
    (url: string) =>
      fetch(url).then((res) => (res.ok ? res.json() : undefined)),
    {
      refreshInterval: 3600000,
      refreshWhenHidden: true,
      shouldRetryOnError: false,
    },
  );

  const current = data?.current;
  const daily = data?.daily ?? [];
  const today = daily[0];
  const hourly = data?.hourly;

  if (!location && !locationLoading) {
    return (
      <Box className={className}>
        <div css={{ padding: "1em 0" }}>
          <div
            css={{
              ...theme.typography.body1,
              color: theme.colors.text.main,
              marginBottom: "1em",
              textAlign: "center",
            }}
          >
            aseta sijainti nähdäksesi sään
          </div>
          <LocationForm />
        </div>
      </Box>
    );
  }

  if (error && !data) {
    return (
      <Box className={className}>
        <OfflineState label="säätiedot" />
      </Box>
    );
  }

  if (!(data && current && today)) {
    return null;
  }

  const isStale = !!error;

  // Aggregate hourly PV forecast points to per-day kWh + hour count.
  // Days with partial coverage (e.g. first/last day of the 66h window) are
  // dropped from the chart to avoid showing misleading near-zero totals.
  // Today's forecast is also dropped past local noon: by midday actual
  // generation has eclipsed the forecast and the SolisBox already shows
  // the live number, making the forward-looking bar redundant.
  const FULL_DAY_HOURS = 20;
  const HIDE_TODAY_PAST_HOUR = 12;
  const pvByDate = new Map<string, { kwh: number; hours: number }>();
  for (const p of pvForecast?.points ?? []) {
    const key = p.time.slice(0, 10);
    const cur = pvByDate.get(key) ?? { kwh: 0, hours: 0 };
    pvByDate.set(key, {
      kwh: cur.kwh + p.outputW / 1000,
      hours: cur.hours + 1,
    });
  }

  const todayKey = format(now, "yyyy-MM-dd");
  const hideToday = now.getHours() >= HIDE_TODAY_PAST_HOUR;

  const chartData = daily
    .filter((d) => !(d.date.slice(0, 10) === todayKey && hideToday))
    .map((d) => {
      const key = d.date.slice(0, 10);
      const pv = pvByDate.get(key);
      const includePv = pv && pv.hours >= FULL_DAY_HOURS;
      return {
        temp: d.temperatureMax,
        rain: d.precipitation,
        pvKwh: includePv ? pv.kwh : null,
        label: `${format(new Date(d.date), "EEEEEE", {
          locale: fi,
        })}`,
      };
    });

  const segments = getFmiTemperatureSegments(hourly);

  const realIsNight =
    now < new Date(current.sunrise) || now > new Date(current.sunset);
  // In demo mode the test controls can override the rendered weather so every
  // animation kind is reachable; symbol -1 ("live") falls back to the real data.
  const override = testCase && testCase.symbol >= 0;
  const weatherSymbol = override ? testCase.symbol : current.weatherSymbol;
  const isNight = override ? testCase.isNight : realIsNight;
  const precipitation =
    override && testCase.precip !== undefined
      ? testCase.precip
      : current.precipitation1h;
  const title = getFmiWeatherDescription(weatherSymbol);

  return (
    <Box
      loading={!data}
      className={className}
      drawer={
        <div
          css={{
            position: "relative",
            backgroundColor: theme.colors.background.light,
            height: "200px",
            padding: 10,
          }}
        >
          <WeatherChart data={chartData} days={7} />
        </div>
      }
    >
      <WeatherAsciiBackground
        weatherSymbol={weatherSymbol}
        isNight={isNight}
        precipitation={precipitation}
      />
      {demo && (
        <WeatherTestControls
          activeId={testCase?.id ?? "live"}
          onSelect={setTestCase}
        />
      )}
      <div
        css={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          css={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            textTransform: "capitalize",
          }}
        >
          {title}
          <span
            css={{
              ...theme.typography.caption,
              color: theme.colors.text.muted,
              textTransform: "none",
            }}
          >
            {demo ? "" : (location?.displayName ?? "")}
          </span>
          {isStale && (
            <Icon
              size={14}
              css={{ color: theme.colors.text.muted, opacity: 0.7 }}
            >
              cloud_off
            </Icon>
          )}
        </div>
        <div
          css={{
            display: "flex",
            marginTop: "15px",
            alignItems: "center",
          }}
        >
          <div css={{ display: "flex" }}>
            <div
              css={{
                display: "flex",
                fontWeight: 300,
                fontSize: 50,
                lineHeight: 1,
                letterSpacing: "-0.1em",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {`${Math.round(current.temperature)}°`}
            </div>
            <div
              css={{
                display: "flex",
                alignItems: "flex-end",
                fontSize: 20,
                fontWeight: 300,
                alignSelf: "bottom",
                marginBottom: 5,
                fontVariantNumeric: "tabular-nums",
              }}
            >{`${Math.round(current.temperatureApparent)}°`}</div>
          </div>
          <WeatherIcon
            weatherSymbol={weatherSymbol}
            isNight={isNight}
            css={{
              marginLeft: "25px",
              alignSelf: "center",
            }}
            size={52}
          />
          <div
            css={{
              fontSize: "13px",
              marginLeft: "25px",
            }}
          >
            {today.precipitation > 0 && (
              <div
                css={{
                  display: "flex",
                  flexDirection: "row",
                  alignItems: "center",
                }}
              >
                {today.precipitationType === "snow" ? (
                  <Icon>ac_unit</Icon>
                ) : (
                  <Icon>water_drop</Icon>
                )}
                <span css={{ marginLeft: 10 }}>
                  {today.precipitation.toFixed(1)} mm
                </span>
              </div>
            )}
            <div
              css={{
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
              }}
            >
              <Icon>air</Icon>
              <span css={{ marginLeft: 10 }}>
                {current.windSpeed.toFixed(1)} m/s
              </span>
              <Arrow
                css={{ marginLeft: 5 }}
                deg={current.windDirection + 180}
              />
            </div>
          </div>
        </div>
      </div>
      <div
        css={{
          position: "relative",
          zIndex: 1,
          display: "flex",
          marginTop: "1.5em",
          justifyContent: "space-between",
          alignItems: "center",
          width: "100%",
        }}
      >
        {segments.map((s) => (
          <div
            key={s.title}
            css={{
              display: "flex",
              flexDirection: "column",
              borderRight: `1px ${theme.colors.border} solid`,
              width: "25%",
              textAlign: "center",
              "&:last-of-type": {
                borderRight: "none",
              },
            }}
          >
            <span
              css={{
                fontFamily: theme.fonts.heading,
                fontWeight: 400,
                fontSize: 14,
                color: theme.colors.text.muted,
              }}
            >
              {s.title}
            </span>
            <span
              css={{
                marginTop: 0.25,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {s.temp}°
            </span>
          </div>
        ))}
      </div>
    </Box>
  );
};

export default memo(WeatherBox);
