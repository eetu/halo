import { useTheme } from "@emotion/react";
import { memo } from "react";
import useSWR from "swr";

import { api, HttpError, jsonFetcher } from "../api";
import { mq } from "../mq";
import { SolisData } from "../types/solis";
import Box, { DrawerRow } from "./Box";
import Icon from "./Icon";
import OfflineState from "./OfflineState";

type SolisBoxProps = {
  className?: string;
};

const SolisBox: React.FC<SolisBoxProps> = ({ className }) => {
  const theme = useTheme();

  const { data, error } = useSWR<SolisData, HttpError>(api("/api/solis"), jsonFetcher, {
    refreshInterval: 300_000,
    refreshWhenHidden: true,
    shouldRetryOnError: false,
  });

  // Not configured: hide entirely.
  if (error?.status === 503) return null;

  // Full offline state when:
  // - inverter reports offline (status=2)
  // - network error and we have nothing cached to render
  const inverterOffline = data?.status === 2;
  const networkErrorNoData = !!error && !data;
  if (inverterOffline || networkErrorNoData) {
    const lastSeen = data?.updated_at ? new Date(data.updated_at) : null;
    return (
      <Box className={className}>
        <OfflineState label="aurinkopaneelit" lastSeen={lastSeen} />
      </Box>
    );
  }

  if (!data) return null;

  const isStale = !!error;

  const isAlarm = data.status === 3;
  const displayPower = data.power.toFixed(1);

  const batteryLabel =
    data.battery_power !== null
      ? data.battery_power > 0
        ? "lataa"
        : data.battery_power < 0
          ? "purkaa"
          : "lepotila"
      : null;

  return (
    <Box
      className={className}
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
          {data.grid_power !== null && (
            <DrawerRow
              label="Käyttää"
              value={`${Math.max(0, data.power - data.grid_power).toFixed(1)} ${data.power_unit}`}
            />
          )}
          <DrawerRow label="Tänään" value={`${data.today_energy} ${data.today_energy_unit}`} />
          <DrawerRow label="Kk" value={`${data.month_energy} ${data.month_energy_unit}`} />
          {data.battery_soc !== null && (
            <>
              <DrawerRow label="Akku" value={`${Math.round(data.battery_soc)}%`} />
              {data.battery_power !== null && data.battery_power_unit && (
                <DrawerRow
                  label={`${batteryLabel}`}
                  value={`${Math.abs(data.battery_power).toFixed(2)} ${data.battery_power_unit}`}
                />
              )}
            </>
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
          flex: 1,
          [mq[0]]: {
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 16,
          },
        }}
      >
        <div
          css={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            [mq[0]]: { alignItems: "flex-start", gap: 4 },
          }}
        >
          <div
            css={{
              display: "flex",
              alignItems: "center",
              gap: "0.3em",
              ...theme.typography.label,
              color: theme.colors.text.muted,
              letterSpacing: "0.04em",
            }}
          >
            <Icon
              size={18}
              css={{
                color: isAlarm ? theme.colors.error : "inherit",
                opacity: 0.7,
              }}
            >
              {isAlarm ? "warning" : "solar_power"}
            </Icon>
            {data.power_unit}
            {isStale && (
              <Icon size={14} css={{ opacity: 0.6 }}>
                cloud_off
              </Icon>
            )}
          </div>
          <div
            css={{
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
            {displayPower}
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
              gap: 6,
              ...theme.typography.caption,
              color: theme.colors.text.muted,
            },
          }}
        >
          <span css={{ fontVariantNumeric: "tabular-nums" }}>
            {`${data.today_energy} ${data.today_energy_unit} tänään`}
          </span>
          {data.battery_soc !== null && (
            <span css={{ fontVariantNumeric: "tabular-nums" }}>
              {`akku ${Math.round(data.battery_soc)} %`}
            </span>
          )}
          {batteryLabel && batteryLabel !== "lepotila" && <span>{batteryLabel}</span>}
        </div>
      </div>
    </Box>
  );
};

export default memo(SolisBox);
