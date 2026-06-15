import { keyframes, useTheme } from "@emotion/react";
import { format } from "date-fns";
import { fi } from "date-fns/locale/fi";
import {
  Activity,
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  BatteryWarning,
  House,
  type LucideIcon,
  Plug,
  Sun,
} from "lucide-react";
import { memo } from "react";
import useSWR from "swr";
import { useMediaQuery } from "usehooks-ts";

import { api, fetcher } from "../../api";
import { SolisData } from "../../types/solis";

const pulse = keyframes`
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.75; transform: scale(1.04); }
`;

// Energy "packets" gliding along a conduit. Count, speed and opacity all scale
// with the line's power (kW) so a trickle and a surge read differently — the
// same intensity-from-data idea used by the weather rain/snow.
const FlowParticles: React.FC<{
  pathId: string;
  color: string;
  magnitude: number; // kW, absolute
  reverse: boolean; // travel end→start (import / charging)
}> = ({ pathId, color, magnitude, reverse }) => {
  if (magnitude <= 0.05) return null;
  const count = Math.min(8, Math.max(1, Math.round(magnitude * 1.2)));
  const dur = Math.min(2.2, Math.max(0.8, 2.2 - magnitude * 0.18));
  const opacity = Math.min(1, 0.45 + magnitude * 0.12);
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <circle key={i} r={3.5} fill={color} opacity={opacity}>
          <animateMotion
            dur={`${dur}s`}
            begin={`${(-(i / count) * dur).toFixed(2)}s`}
            repeatCount="indefinite"
            calcMode="linear"
            keyPoints={reverse ? "1;0" : "0;1"}
            keyTimes="0;1"
          >
            <mpath href={`#${pathId}`} />
          </animateMotion>
        </circle>
      ))}
    </>
  );
};

const NodeIcon: React.FC<{
  cx: number;
  cy: number;
  size: number;
  color: string;
  icon: LucideIcon;
}> = ({ cx, cy, size, color, icon: Icon }) => (
  <foreignObject x={cx - size / 2} y={cy - size / 2} width={size} height={size}>
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon size={size} color={color} strokeWidth={1.8} />
    </div>
  </foreignObject>
);

const batteryIcon = (soc: number, charging: boolean): LucideIcon => {
  if (charging) return BatteryCharging;
  if (soc >= 75) return BatteryFull;
  if (soc >= 50) return BatteryMedium;
  if (soc >= 25) return BatteryLow;
  if (soc >= 10) return Battery;
  return BatteryWarning;
};

const Flow: React.FC<{ className?: string }> = ({ className }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery("(max-width: 600px)");
  const { data } = useSWR<SolisData>(api("/api/solis"), fetcher, {
    refreshInterval: 60_000,
    refreshWhenHidden: true,
    shouldRetryOnError: false,
  });

  if (!data) return null;

  const pv = data.power;
  const grid = data.grid_power ?? 0;
  const batteryPower = data.battery_power ?? 0;
  const soc = data.battery_soc;

  // Sign conventions (per backend SolisCloud):
  //   grid_power: + export, - import
  //   battery_power: + charging, - discharging
  const importing = grid < 0 ? Math.abs(grid) : 0;
  const exporting = grid > 0 ? grid : 0;
  const charging = batteryPower > 0 ? batteryPower : 0;
  const discharging = batteryPower < 0 ? Math.abs(batteryPower) : 0;
  const home = Math.max(0, pv - exporting - charging + discharging + importing);

  const hasFlow = (v: number) => Math.abs(v) > 0.05;

  const conduit = {
    fill: "none",
    strokeWidth: 4,
    strokeLinecap: "round" as const,
  };

  const pulseStyle = {
    transformOrigin: "center",
    transformBox: "fill-box" as const,
    animation: `${pulse} 2.4s ease-in-out infinite`,
  };

  const pvActive = hasFlow(pv);
  const homeActive = hasFlow(home);
  const batteryActive = hasFlow(batteryPower);
  const gridActive = hasFlow(grid);

  const strokeWidth = 4;
  const nodeSize = 42;
  const nodeTitleFontSize = 24;
  const socCircumference = 2 * Math.PI * nodeSize;
  const socArc =
    (Math.max(0, Math.min(100, soc ?? 0)) / 100) * socCircumference;

  return (
    <div
      className={className}
      css={{
        backgroundColor: theme.colors.background.main,
        boxShadow: theme.shadows.main,
        borderRadius: theme.border.radius,
        padding: "1.25em 1.5em",
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
          energiavirta
        </div>
        <div
          css={{
            fontSize: 12,
            color: theme.colors.text.muted,
            whiteSpace: "nowrap",
          }}
        >
          {data.updated_at
            ? format(new Date(data.updated_at), "dd.MM.yyyy HH.mm", {
                locale: fi,
              })
            : "—"}
        </div>
      </div>
      <svg
        viewBox={isMobile ? "80 28 640 360" : "0 28 800 364"}
        css={{ width: "100%", height: "auto" }}
      >
        {/* Conduits — quiet base lines */}
        <path
          id="flow-pv"
          d="M160,110 C260,110 300,210 400,210"
          stroke={theme.colors.activity.on}
          opacity={pvActive ? 0.3 : 0.12}
          css={conduit}
        />
        <path
          id="flow-battery"
          d="M160,310 C260,310 300,210 400,210"
          stroke={theme.colors.battery}
          opacity={batteryActive ? 0.3 : 0.12}
          css={conduit}
        />
        <path
          id="flow-grid"
          d="M400,210 C500,210 540,110 640,110"
          stroke={theme.colors.grid}
          opacity={gridActive ? 0.3 : 0.12}
          css={conduit}
        />
        <path
          id="flow-home"
          d="M400,210 C500,210 540,310 640,310"
          stroke={theme.colors.home}
          opacity={homeActive ? 0.3 : 0.12}
          css={conduit}
        />

        {/* Flowing energy packets — direction & intensity follow the data */}
        <FlowParticles
          pathId="flow-pv"
          color={theme.colors.activity.on}
          magnitude={pv}
          reverse={false}
        />
        <FlowParticles
          pathId="flow-battery"
          color={theme.colors.battery}
          magnitude={charging > 0 ? charging : discharging}
          reverse={charging > 0}
        />
        <FlowParticles
          pathId="flow-grid"
          color={theme.colors.grid}
          magnitude={importing > 0 ? importing : exporting}
          reverse={importing > 0}
        />
        <FlowParticles
          pathId="flow-home"
          color={theme.colors.home}
          magnitude={home}
          reverse={false}
        />

        {/* PV node */}
        <g css={pvActive ? pulseStyle : undefined}>
          <circle
            cx="160"
            cy="110"
            r={nodeSize}
            fill={theme.colors.background.light}
            stroke={theme.colors.activity.on}
            strokeWidth={strokeWidth}
          />
          <NodeIcon
            cx={160}
            cy={110}
            size={nodeSize}
            color={theme.colors.activity.on}
            icon={Sun}
          />
        </g>
        <text
          x="160"
          y="50"
          textAnchor="middle"
          fontFamily={theme.fonts.heading}
          fontSize={nodeTitleFontSize}
          fill={theme.colors.text.main}
        >
          aurinko
        </text>
        <text
          x="160"
          y="178"
          textAnchor="middle"
          fontSize="24"
          fill={theme.colors.text.main}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {pv.toFixed(2)} kW
        </text>

        {/* Inverter node */}
        <g>
          <circle
            cx="400"
            cy="210"
            r={nodeSize}
            fill={theme.colors.background.light}
            stroke={theme.colors.text.main}
            strokeWidth={strokeWidth}
          />
          <NodeIcon
            cx={400}
            cy={210}
            size={nodeSize}
            color={theme.colors.text.main}
            icon={Activity}
          />
        </g>
        {/* Battery node */}
        {soc !== null && (
          <>
            <text
              x="160"
              y="250"
              textAnchor="middle"
              fontFamily={theme.fonts.heading}
              fontSize={nodeTitleFontSize}
              fill={theme.colors.text.main}
            >
              akku
            </text>
            <g css={batteryActive ? pulseStyle : undefined}>
              <circle
                cx="160"
                cy="310"
                r={nodeSize}
                fill={theme.colors.background.light}
                stroke={theme.colors.battery}
                strokeWidth={strokeWidth}
                strokeOpacity={0.2}
              />
              <circle
                cx="160"
                cy="310"
                r={nodeSize}
                fill="none"
                stroke={theme.colors.battery}
                strokeWidth={strokeWidth}
                strokeDasharray={`${socArc} ${socCircumference}`}
                strokeLinecap="round"
                transform="rotate(-90 160 310)"
              />
              <NodeIcon
                cx={160}
                cy={310}
                size={nodeSize}
                color={theme.colors.battery}
                icon={batteryIcon(soc, charging > 0)}
              />
            </g>
            <text
              x="160"
              y="378"
              textAnchor="middle"
              fontSize="24"
              fill={theme.colors.text.main}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {Math.abs(batteryPower).toFixed(2)} kW
            </text>
          </>
        )}

        {/* Grid node */}
        <g css={gridActive ? pulseStyle : undefined}>
          <circle
            cx="640"
            cy="110"
            r={nodeSize}
            fill={theme.colors.background.light}
            stroke={theme.colors.grid}
            strokeWidth={strokeWidth}
          />
          <NodeIcon
            cx={640}
            cy={110}
            size={nodeSize}
            color={theme.colors.grid}
            icon={Plug}
          />
        </g>
        <text
          x="640"
          y="50"
          textAnchor="middle"
          fontFamily={theme.fonts.heading}
          fontSize={nodeTitleFontSize}
          fill={theme.colors.text.main}
        >
          verkko
        </text>
        <text
          x="640"
          y="178"
          textAnchor="middle"
          fontSize="24"
          fill={theme.colors.text.main}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {Math.abs(grid).toFixed(2)} kW
        </text>

        {/* Home node */}
        <text
          x="640"
          y="250"
          textAnchor="middle"
          fontFamily={theme.fonts.heading}
          fontSize={nodeTitleFontSize}
          fill={theme.colors.text.main}
        >
          koti
        </text>
        <g css={homeActive ? pulseStyle : undefined}>
          <circle
            cx="640"
            cy="310"
            r={nodeSize}
            fill={theme.colors.background.light}
            stroke={theme.colors.home}
            strokeWidth={strokeWidth}
          />
          <NodeIcon
            cx={640}
            cy={310}
            size={nodeSize}
            color={theme.colors.home}
            icon={House}
          />
        </g>
        <text
          x="640"
          y="378"
          textAnchor="middle"
          fontSize="24"
          fill={theme.colors.text.main}
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {home.toFixed(2)} kW
        </text>
      </svg>
    </div>
  );
};

export default memo(Flow);
