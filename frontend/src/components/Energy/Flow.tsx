import { useTheme } from "@emotion/react";
import { format } from "date-fns";
import { fi } from "date-fns/locale/fi";
import { memo } from "react";
import useSWR from "swr";
import { useMediaQuery } from "usehooks-ts";

import { api, fetcher } from "../../api";
import { SolisData } from "../../types/solis";
import NeonNode, { type NodeGlyph } from "./NeonNode";

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

// Full brightness, per node, in kW. The array's nameplate is what the sun node is
// glowed against, so a clear noon in June is the only thing that lights it all the
// way; the inverter and the house sides share it. The battery runs against its
// charge/discharge power ceiling — not its 15.2 kWh of capacity, which is what the
// ring's fill shows.
const PV_NAMEPLATE_KW = 7.2;
const BATTERY_MAX_KW = 5;

// A low battery reads as a tired tube. Nothing under 30 %, then the glass gets
// steadily less able to hold its strike — at 5 % it stutters like the last letter of
// a motel sign.
const socFlicker = (soc: number) => (soc >= 30 ? 0 : Math.min(0.6, ((30 - soc) / 25) * 0.6));

const batteryGlyph = (soc: number, charging: boolean): NodeGlyph => {
  if (charging) return "batteryCharging";
  if (soc >= 75) return "batteryFull";
  if (soc >= 50) return "batteryMedium";
  if (soc >= 25) return "batteryLow";
  if (soc >= 10) return "battery";
  return "batteryWarning";
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

  const pvActive = hasFlow(pv);
  const homeActive = hasFlow(home);
  const batteryActive = hasFlow(batteryPower);
  const gridActive = hasFlow(grid);

  const nodeSize = 42;
  const nodeTitleFontSize = 24;

  // The neon ring lands at exactly 2 * nodeSize, so a node's backing disc doubles as
  // the sign's wall: it hides the conduits and packets that run under the node.
  const nodeDisc = { r: nodeSize, fill: theme.colors.background.light };

  // The nodes are neon signs overlaid on the diagram, so they need the viewBox the
  // rest of the geometry is written in.
  const viewBox: [number, number, number, number] = isMobile
    ? [80, 28, 640, 360]
    : [0, 28, 800, 364];

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
      <div css={{ position: "relative" }}>
        <svg viewBox={viewBox.join(" ")} css={{ width: "100%", height: "auto", display: "block" }}>
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

          {/* Node backing discs — they hide the conduits and packets that run under
            a node, and the neon rings land on their edge */}
          <circle cx="160" cy="110" {...nodeDisc} />
          <circle cx="400" cy="210" {...nodeDisc} />
          <circle cx="640" cy="110" {...nodeDisc} />
          <circle cx="640" cy="310" {...nodeDisc} />
          {soc !== null && <circle cx="160" cy="310" {...nodeDisc} />}

          {/* PV node */}
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

        {/* The nodes themselves — neon signs registered to the viewBox above. The
            strike delays walk outward from the inverter, so opening this view lights
            the board in the order the power actually moves. */}
        <NeonNode
          cx={160}
          cy={110}
          viewBox={viewBox}
          glyph="sun"
          color={theme.colors.activity.on}
          on={pvActive}
          magnitude={pv}
          reference={PV_NAMEPLATE_KW}
          strikeDelay={260}
          label="aurinko"
        />
        <NeonNode
          cx={400}
          cy={210}
          viewBox={viewBox}
          glyph="inverter"
          color={theme.colors.text.main}
          on
          magnitude={pv + importing + discharging}
          reference={PV_NAMEPLATE_KW}
          label="invertteri"
        />
        {soc !== null && (
          // The ring is the SoC gauge: lit as far as the charge runs, dim tube for
          // the rest.
          <NeonNode
            cx={160}
            cy={310}
            viewBox={viewBox}
            glyph={batteryGlyph(soc, charging > 0)}
            color={theme.colors.battery}
            ringTrack={theme.colors.border}
            on
            magnitude={batteryPower}
            reference={BATTERY_MAX_KW}
            ring={soc / 100}
            flicker={socFlicker(soc)}
            strikeDelay={520}
            label={`akku ${Math.round(soc)} %`}
          />
        )}
        <NeonNode
          cx={640}
          cy={110}
          viewBox={viewBox}
          glyph="plug"
          color={theme.colors.grid}
          on={gridActive}
          magnitude={grid}
          reference={PV_NAMEPLATE_KW}
          strikeDelay={780}
          label="verkko"
        />
        <NeonNode
          cx={640}
          cy={310}
          viewBox={viewBox}
          glyph="house"
          color={theme.colors.home}
          on={homeActive}
          magnitude={home}
          reference={PV_NAMEPLATE_KW}
          strikeDelay={1040}
          label="koti"
        />
      </div>
    </div>
  );
};

export default memo(Flow);
