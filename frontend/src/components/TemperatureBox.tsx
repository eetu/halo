import { useTheme } from "@emotion/react";
import classNames from "classnames";
import { FC, memo } from "react";

import useScreenshotMode, { anonymize } from "../hooks/useScreenshotMode";
import useSensorHistorySummary from "../hooks/useSensorHistorySummary";
import useSensorTrend from "../hooks/useSensorTrend";
import { mq } from "../mq";
import { Sensor } from "../types/hue";
import Box, { DrawerRow } from "./Box";
import Icon from "./Icon";
import OfflineState from "./OfflineState";
import Sparkline from "./Sparkline";
import TrendIndicator from "./TrendIndicator";

type TemperatureBoxProps = {
  className?: string;
  title: React.ReactNode;
  sensors?: Sensor[];
  error?: boolean;
  temperatureOverride?: number;
};

const isBatteryLow = (sensor: Sensor) => sensor.battery !== undefined && sensor.battery < 2;

const TREND_PILL_THRESHOLD = 0.3;

const TemperatureBox: React.FC<TemperatureBoxProps> = ({
  className,
  title,
  sensors = [],
  error,
  temperatureOverride,
}) => {
  const theme = useTheme();
  const trend = useSensorTrend(sensors);
  const summary = useSensorHistorySummary(sensors);
  const demo = useScreenshotMode();

  const enabledSensors = sensors?.filter((r) => r.enabled);

  const temperature =
    temperatureOverride ??
    enabledSensors.reduce((acc, room) => {
      if (room.temperature === undefined) return acc;
      return acc + room.temperature;
    }, 0) / enabledSensors.length;

  const sensorCount = enabledSensors.length;
  const lowestBatterySensor = sensors
    .filter(isBatteryLow)
    .reduce<Sensor | null>(
      (acc, s) => (acc === null || (s.battery ?? 100) < (acc.battery ?? 100) ? s : acc),
      null,
    );

  // Full offline UI only when we have no prior data to fall back on.
  // With cached sensors, render the normal card and surface a subtle stale
  // hint instead — avoids flashing offline state during standby reconnects.
  const isStale = !!error && sensors.length > 0;
  if (error && sensors.length === 0) {
    return (
      <Box
        className={classNames(className)}
        css={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          [mq[0]]: {
            width: "100%",
          },
        }}
      >
        <OfflineState label={typeof title === "string" ? title : "anturit"} />
      </Box>
    );
  }

  return (
    <Box
      className={classNames(className)}
      css={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        [mq[0]]: {
          width: "100%",
        },
      }}
      loading={sensors.length === 0}
      drawer={
        <div
          css={{
            backgroundColor: theme.colors.background.light,
            padding: "5px",
            display: "flex",
            flexDirection: "column",
            gap: "0.5em",
            fontSize: "14px",
          }}
        >
          {sensors.map((r) => {
            const showBatteryPill = isBatteryLow(r) && r.battery !== undefined;
            return (
              <DrawerRow
                key={r.id}
                label={
                  <div
                    css={{
                      display: "flex",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {demo ? anonymize(r.id, "anturi") : r.name}
                  </div>
                }
                value={
                  <div
                    css={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {showBatteryPill && <BatteryPill battery={r.battery!} />}
                    <span>
                      {r.temperature !== undefined ? `${Math.round(r.temperature)}°` : ""}
                    </span>
                  </div>
                }
              />
            );
          })}
          {summary.points.length >= 2 && (
            <div
              css={{
                display: "none",
                [mq[0]]: {
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  marginTop: "0.5em",
                  paddingTop: "0.5em",
                  borderTop: `1px ${theme.colors.border} solid`,
                },
              }}
            >
              <div
                css={{
                  display: "flex",
                  justifyContent: "space-between",
                  ...theme.typography.caption,
                  color: theme.colors.text.muted,
                }}
              >
                <span>24h</span>
                {summary.minTemp !== null && summary.maxTemp !== null && (
                  <span>
                    {`min ${Math.round(summary.minTemp)}° · max ${Math.round(summary.maxTemp)}°`}
                  </span>
                )}
              </div>
              <Sparkline points={summary.points} color={theme.colors.activity.on} height={48} />
            </div>
          )}
        </div>
      }
    >
      <div
        css={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          [mq[0]]: {
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
          },
        }}
      >
        {lowestBatterySensor?.battery !== undefined && (
          <Icon
            size={20}
            css={{
              position: "absolute",
              top: -8,
              right: -4,
              color: theme.colors.error,
              [mq[0]]: { display: "none" },
            }}
          >{`battery_${getBatteryStr(lowestBatterySensor.battery)}`}</Icon>
        )}
        <div
          css={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            [mq[0]]: {
              alignItems: "flex-start",
              gap: 4,
            },
          }}
        >
          <div
            css={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              ...theme.typography.label,
              color: theme.colors.text.muted,
              letterSpacing: "0.04em",
            }}
          >
            {title}
            {isStale && (
              <Icon size={14} css={{ opacity: 0.6 }}>
                cloud_off
              </Icon>
            )}
          </div>
          <div
            css={{
              position: "relative",
              marginTop: "5px",
              display: "flex",
              fontWeight: 300,
              fontSize: 50,
              lineHeight: 1,
              letterSpacing: "-0.1em",
              fontVariantNumeric: "tabular-nums",
              [mq[0]]: { marginTop: 0, fontSize: 64 },
            }}
          >
            {Math.round(temperature)}
            <span>°</span>
            {trend && trend !== "stable" && (
              <div
                css={{
                  position: "absolute",
                  right: -25,
                  top: 0,
                  bottom: 0,
                  display: "flex",
                  alignItems: "center",
                  opacity: 0.75,
                  [mq[0]]: { display: "none" },
                }}
              >
                <TrendIndicator trend={trend} />
              </div>
            )}
          </div>
        </div>

        <div
          css={{
            display: "none",
            [mq[0]]: {
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              justifyContent: "center",
              gap: 8,
              minHeight: "100%",
            },
          }}
        >
          {summary.diff1h !== null && Math.abs(summary.diff1h) >= TREND_PILL_THRESHOLD && (
            <TrendPill diff={summary.diff1h} />
          )}
          <span
            css={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              ...theme.typography.caption,
              color: theme.colors.text.muted,
            }}
          >
            {`${sensorCount} ${sensorCount === 1 ? "anturi" : "anturia"}`}
            {lowestBatterySensor?.battery !== undefined && (
              <Icon size={16} css={{ color: theme.colors.error }}>
                {`battery_${getBatteryStr(lowestBatterySensor.battery)}`}
              </Icon>
            )}
          </span>
        </div>
      </div>
    </Box>
  );
};

type TrendPillProps = { diff: number };

const TrendPill: FC<TrendPillProps> = ({ diff }) => {
  const theme = useTheme();
  const isUp = diff >= 0;
  const sign = diff > 0 ? "+" : "";
  return (
    <div
      css={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        backgroundColor: theme.colors.activity.onSoft,
        color: theme.colors.activity.on,
        fontSize: 12,
        fontWeight: 500,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Icon
        size={14}
        css={{
          transform: isUp ? "none" : "rotate(180deg)",
        }}
      >
        trending_up
      </Icon>
      {`${sign}${diff.toFixed(1)}° / 1h`}
    </div>
  );
};

type BatteryPillProps = { battery: number };

const BatteryPill: FC<BatteryPillProps> = ({ battery }) => {
  const theme = useTheme();
  return (
    <div
      css={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        backgroundColor: "rgba(255, 99, 71, 0.14)",
        color: theme.colors.error,
        fontSize: 12,
        fontWeight: 500,
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <Icon size={14}>{`battery_${getBatteryStr(battery)}`}</Icon>
      <span
        css={{
          display: "none",
          [mq[0]]: { display: "inline" },
        }}
      >
        {`${battery} %`}
      </span>
    </div>
  );
};

const getBatteryStr = (value: number = 100) => {
  if (value > 95) {
    return "full";
  } else if (value > 85) {
    return "6_bar";
  } else if (value > 70) {
    return "5_bar";
  } else if (value > 50) {
    return "4_bar";
  } else if (value > 30) {
    return "3_bar";
  } else if (value > 10) {
    return "2_bar";
  } else if (value > 0) {
    return "1_bar";
  }
  return "0_bar";
};

export default memo(TemperatureBox);
