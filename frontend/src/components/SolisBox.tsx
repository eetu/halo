import { useTheme } from "@emotion/react";
import { memo } from "react";
import useSWR from "swr";

import { api, fetcher, type HttpError, jsonFetcher } from "../api";
import { mq } from "../mq";
import type { SolisData, SolisReading } from "../types/solis";
import Box, { DrawerRow } from "./Box";
import Icon from "./Icon";
import OfflineState from "./OfflineState";
import Sparkline from "./Sparkline";

const PV_HOURS = 24;
const PV_BUCKETS = 48;

/** Mean PV power per half hour; an empty bucket is an offline inverter (not recorded), so 0. */
const pvBuckets = (readings: SolisReading[], now: number): number[] => {
  const bucketMs = (PV_HOURS * 3600_000) / PV_BUCKETS;
  const start = now - PV_HOURS * 3600_000;
  const buckets = Array.from({ length: PV_BUCKETS }, () => ({ sum: 0, count: 0 }));
  for (const r of readings) {
    const t = new Date(r.recordedAt).getTime();
    const idx = Math.min(PV_BUCKETS - 1, Math.floor((t - start) / bucketMs));
    if (idx < 0) continue;
    buckets[idx].sum += r.power;
    buckets[idx].count++;
  }
  return buckets.map((b) => (b.count > 0 ? b.sum / b.count : 0));
};

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
  const { data: history } = useSWR<SolisReading[]>(
    api(`/api/history/solis?hours=${PV_HOURS}`),
    fetcher,
    { refreshInterval: 300_000, refreshWhenHidden: true },
  );

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
  const pvPoints = history?.length ? pvBuckets(history, Date.now()) : [];

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
          flex: 1,
          [mq[0]]: { alignItems: "stretch", gap: 4 },
        }}
      >
        <div
          css={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "2px 8px",
            ...theme.typography.caption,
            color: theme.colors.text.muted,
          }}
        >
          <div
            css={{
              display: "flex",
              alignItems: "center",
              gap: "0.3em",
              ...theme.typography.label,
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
            <span
              css={{
                display: "none",
                [mq[0]]: {
                  display: "inline",
                  marginLeft: "0.3em",
                  ...theme.typography.caption,
                  letterSpacing: "normal",
                  fontVariantNumeric: "tabular-nums",
                },
              }}
            >
              {`· ${data.today_energy} ${data.today_energy_unit} tänään`}
            </span>
          </div>
          {data.battery_soc !== null && (
            <span
              css={{
                display: "none",
                [mq[0]]: { display: "inline", fontVariantNumeric: "tabular-nums" },
              }}
            >
              {[
                `akku ${Math.round(data.battery_soc)} %`,
                batteryLabel !== "lepotila" && batteryLabel,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </div>
        <div css={{ display: "flex", alignItems: "center", gap: 20 }}>
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
          <Sparkline
            series={[{ points: pvPoints, color: theme.colors.pv }]}
            height={44}
            css={{ display: "none", [mq[0]]: { display: "block", flex: 1, minWidth: 0 } }}
          />
        </div>
      </div>
    </Box>
  );
};

export default memo(SolisBox);
