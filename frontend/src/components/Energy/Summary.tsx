import { useTheme } from "@emotion/react";
import { memo, useEffect, useState } from "react";
import useSWR from "swr";

import { api, fetcher } from "../../api";
import { mq } from "../../mq";
import { SolisData, SolisReading } from "../../types/solis";

type Aggregates = {
  exportKwh: number;
  importKwh: number;
  chargeKwh: number;
  dischargeKwh: number;
};

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const integrate = (readings: SolisReading[]): Aggregates => {
  let exportKwh = 0;
  let importKwh = 0;
  let chargeKwh = 0;
  let dischargeKwh = 0;

  const today = new Date();
  const todays = readings.filter((r) => isSameDay(new Date(r.recordedAt), today));

  for (let i = 1; i < todays.length; i++) {
    const a = todays[i - 1];
    const b = todays[i];
    const dtH = (new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()) / 3_600_000;
    if (dtH <= 0 || dtH > 1) continue; // skip large gaps (>1h)

    const ag = a.gridPower ?? 0;
    const bg = b.gridPower ?? 0;
    exportKwh += ((Math.max(0, ag) + Math.max(0, bg)) / 2) * dtH;
    importKwh += ((Math.max(0, -ag) + Math.max(0, -bg)) / 2) * dtH;

    const ab = a.batteryPower ?? 0;
    const bb = b.batteryPower ?? 0;
    chargeKwh += ((Math.max(0, ab) + Math.max(0, bb)) / 2) * dtH;
    dischargeKwh += ((Math.max(0, -ab) + Math.max(0, -bb)) / 2) * dtH;
  }

  return { exportKwh, importKwh, chargeKwh, dischargeKwh };
};

const Summary: React.FC<{ className?: string }> = ({ className }) => {
  const theme = useTheme();
  const { data: live } = useSWR<SolisData>(api("/api/solis"), fetcher, {
    refreshInterval: 60_000,
    refreshWhenHidden: true,
    shouldRetryOnError: false,
  });
  const [readings, setReadings] = useState<SolisReading[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(api("/api/history/solis?hours=24"), { signal: controller.signal })
      .then((r) => r.json())
      .then((data: SolisReading[]) => setReadings(data))
      .catch((err) => {
        if (err.name !== "AbortError") setReadings([]);
      });
    return () => controller.abort();
  }, []);

  if (!live) return null;

  const { exportKwh, importKwh, chargeKwh, dischargeKwh } = integrate(readings);

  const pvTotal = live.today_energy;
  const pvToGrid = Math.min(pvTotal, exportKwh);
  const pvToBattery = Math.max(0, Math.min(pvTotal - pvToGrid, chargeKwh));
  const pvToHome = Math.max(0, pvTotal - pvToGrid - pvToBattery);
  const homeKwh = pvToHome + dischargeKwh + importKwh;

  const pct = (v: number) => (pvTotal > 0 ? Math.round((v / pvTotal) * 100) : 0);
  const homePct = pct(pvToHome);
  const batteryPct = pct(pvToBattery);
  const gridPct = pvTotal > 0 ? 100 - homePct - batteryPct : 0;

  // Donut geometry (viewBox 100x100, r=38)
  const r = 38;
  const C = 2 * Math.PI * r;
  const homeLen = (homePct / 100) * C;
  const batteryLen = (batteryPct / 100) * C;
  const gridLen = (gridPct / 100) * C;

  const metrics: [string, string, string][] = [
    ["päivän tuotto", `${pvTotal.toFixed(1)} kWh`, theme.colors.activity.on],
    ["kulutus", `${homeKwh.toFixed(1)} kWh`, theme.colors.home],
    ["lataus", `${chargeKwh.toFixed(1)} kWh`, theme.colors.battery],
    ["käyttö", `${dischargeKwh.toFixed(1)} kWh`, theme.colors.battery],
    ["vienti", `${exportKwh.toFixed(1)} kWh`, theme.colors.activity.on],
    ["tuonti", `${importKwh.toFixed(1)} kWh`, theme.colors.text.muted],
  ];

  return (
    <div
      className={className}
      css={{
        backgroundColor: theme.colors.background.main,
        boxShadow: theme.shadows.main,
        borderRadius: theme.border.radius,
        padding: "1.25em 1.5em",
        [mq[0]]: {
          padding: "1em",
        },
      }}
    >
      <div
        css={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: "1em",
          gap: 16,
        }}
      >
        <div
          css={{
            fontFamily: theme.fonts.heading,
            fontSize: 18,
          }}
        >
          päivän yhteenveto
        </div>
      </div>
      <div
        css={{
          display: "grid",
          gridTemplateColumns: "180px 1fr",
          gap: 24,
          alignItems: "center",
          "@media (max-width: 600px)": {
            gridTemplateColumns: "1fr",
            gap: 16,
          },
        }}
      >
        <div
          css={{
            position: "relative",
            width: 160,
            height: 160,
            margin: "0 auto",
          }}
        >
          <svg
            viewBox="0 0 100 100"
            css={{
              width: "100%",
              height: "100%",
              transform: "rotate(-90deg)",
            }}
          >
            <circle
              cx="50"
              cy="50"
              r={r}
              fill="none"
              stroke={theme.colors.background.light}
              strokeWidth="9"
            />
            {pvTotal > 0 && (
              <>
                <circle
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke={theme.colors.home}
                  strokeWidth="9"
                  strokeDasharray={`${homeLen} ${C}`}
                />
                <circle
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke={theme.colors.battery}
                  strokeWidth="9"
                  strokeDasharray={`${batteryLen} ${C}`}
                  strokeDashoffset={-homeLen}
                />
                <circle
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke={theme.colors.activity.on}
                  strokeWidth="9"
                  strokeDasharray={`${gridLen} ${C}`}
                  strokeDashoffset={-(homeLen + batteryLen)}
                />
              </>
            )}
          </svg>
          <div
            css={{
              position: "absolute",
              inset: 32,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
            }}
          >
            <div css={{ fontSize: 12, color: theme.colors.text.muted }}>tuotto</div>
            <div
              css={{
                fontSize: 20,
                lineHeight: 1,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {pvTotal.toFixed(1)} kWh
            </div>
          </div>
        </div>

        <div
          css={{
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <LegendRow
            color={theme.colors.home}
            label="kulutukseen"
            value={`${pvToHome.toFixed(1)} kWh`}
            pct={homePct}
          />
          <LegendRow
            color={theme.colors.battery}
            label="akkuun"
            value={`${pvToBattery.toFixed(1)} kWh`}
            pct={batteryPct}
          />
          <LegendRow
            color={theme.colors.activity.on}
            label="verkkoon"
            value={`${pvToGrid.toFixed(1)} kWh`}
            pct={gridPct}
          />
          <div
            css={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: "6px 24px",
              paddingTop: 12,
              marginTop: 8,
              borderTop: `1px solid ${theme.colors.border}`,
              fontSize: 13,
            }}
          >
            {metrics.map(([k, v, c]) => (
              <div
                key={k}
                css={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span css={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    css={{
                      display: "inline-block",
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      backgroundColor: c,
                    }}
                  />
                  <span css={{ color: theme.colors.text.muted }}>{k}</span>
                </span>
                <span css={{ fontVariantNumeric: "tabular-nums" }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const LegendRow: React.FC<{
  color: string;
  label: string;
  value: string;
  pct: number;
}> = ({ color, label, value, pct }) => {
  const theme = useTheme();
  return (
    <div
      css={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        fontSize: 13,
      }}
    >
      <span
        css={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: color,
        }}
      />
      <span css={{ color: theme.colors.text.muted, minWidth: 110 }}>pv → {label}</span>
      <span css={{ fontVariantNumeric: "tabular-nums" }}>{value}</span>
      <span
        css={{
          color: theme.colors.text.muted,
          marginLeft: "auto",
          fontSize: 12,
        }}
      >
        {pct}%
      </span>
    </div>
  );
};

export default memo(Summary);
