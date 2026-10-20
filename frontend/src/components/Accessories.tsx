import { useTheme } from "@emotion/react";
import { type FC, memo, useMemo } from "react";

import useScreenshotMode, { anonymize } from "../hooks/useScreenshotMode";
import { byBattery, needsReplacing } from "../hue/battery";
import { mq } from "../mq";
import type { Accessory } from "../types/hue";

const ellipsis = {
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  textTransform: "lowercase",
} as const;

type AccessoriesProps = {
  className?: string;
  accessories?: Accessory[];
  error?: boolean;
};

const Accessories: FC<AccessoriesProps> = ({ className, accessories, error }) => {
  const theme = useTheme();
  const sorted = useMemo(() => [...(accessories ?? [])].sort(byBattery), [accessories]);

  return (
    <div
      className={className}
      css={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) 160px 3.5em",
        columnGap: 12,
        boxSizing: "border-box",
        width: "100%",
        fontSize: 16,
        color: error ? theme.colors.error : theme.colors.text.main,
        backgroundColor: theme.colors.background.main,
        boxShadow: theme.shadows.main,
        borderRadius: theme.border.radius,
        padding: "1em",
        "& > * + *": { borderTop: `1px solid ${theme.colors.border}` },
        [mq[0]]: {
          gridTemplateColumns: "minmax(0, 1fr) 72px 3.5em",
          padding: "0.5em",
        },
      }}
    >
      {sorted.map((a) => (
        <AccessoryRow key={a.id} accessory={a} />
      ))}
      {sorted.length === 0 && (
        <span css={{ gridColumn: "1 / -1", color: theme.colors.text.muted, padding: "8px 4px" }}>
          Ei paristokäyttöisiä laitteita
        </span>
      )}
    </div>
  );
};

export default memo(Accessories);

const AccessoryRow: FC<{ accessory: Accessory }> = ({ accessory }) => {
  const theme = useTheme();
  const demo = useScreenshotMode();
  const { battery } = accessory;
  const replace = needsReplacing(accessory);

  // A device named after its room already says where it is.
  const room =
    accessory.room?.toLowerCase() === accessory.name.toLowerCase()
      ? undefined
      : accessory.room && (demo ? anonymize(accessory.room, "huone") : accessory.room);
  const detail = [!accessory.connected && "ei yhteyttä", room, accessory.product]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      css={{
        gridColumn: "1 / -1",
        display: "grid",
        gridTemplateColumns: "subgrid",
        alignItems: "center",
        padding: "12px 4px",
      }}
    >
      <span css={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span css={ellipsis}>{demo ? anonymize(accessory.id, "laite") : accessory.name}</span>
        {detail && (
          <span css={{ ...ellipsis, fontSize: 13, color: theme.colors.text.muted }}>{detail}</span>
        )}
      </span>
      <LevelBar level={battery} color={replace ? theme.colors.error : theme.colors.text.muted} />
      <span
        css={{
          textAlign: "right",
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
          fontWeight: replace ? 600 : 400,
          color: replace ? theme.colors.error : undefined,
        }}
      >
        {battery === undefined ? "—" : `${battery} %`}
      </span>
    </div>
  );
};

const LevelBar: FC<{ level?: number; color: string }> = ({ level, color }) => {
  const theme = useTheme();
  return (
    <span
      aria-hidden
      css={{
        display: "block",
        height: 6,
        overflow: "hidden",
        borderRadius: theme.border.radiusPill,
        backgroundColor: theme.colors.border,
      }}
    >
      {level !== undefined && (
        <span
          css={{
            display: "block",
            width: `${level}%`,
            height: "100%",
            borderRadius: "inherit",
            backgroundColor: color,
            transition: `width ${theme.durations.med} ease`,
          }}
        />
      )}
    </span>
  );
};
