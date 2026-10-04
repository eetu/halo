import { keyframes, useTheme } from "@emotion/react";
import { formatDistanceToNow } from "date-fns";
import { fi } from "date-fns/locale/fi";
import { ChevronDown } from "lucide-react";
import { FC, memo, ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";
import { useMediaQuery } from "usehooks-ts";

import { api } from "../api";
import useScreenshotMode, { anonymize } from "../hooks/useScreenshotMode";
import {
  DARK_THRESHOLD_DEFAULT,
  DARK_THRESHOLD_MAX,
  DARK_THRESHOLD_MIN,
  formatLux,
  sensitivityEnds,
  sensitivityLabel,
  thresholdFraction,
} from "../hue/motion";
import { mq } from "../mq";
import { MotionMember, MotionMemberKind, MotionUnit } from "../types/hue";
import Switch from "./Switch";

const motionPulse = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(247, 143, 8, 0.5); }
  50%      { box-shadow: 0 0 0 6px rgba(247, 143, 8, 0); }
`;

const KIND_LABELS: Record<MotionMemberKind, string> = {
  sensor: "anturi",
  area: "valaisimet",
};

const post = (path: string, body: unknown) =>
  fetch(api(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/**
 * Shows a requested value while the bridge catches up: held until the live
 * data agrees, dropped if the write fails.
 */
const useBridgeWrite = <T,>(actual: T) => {
  const [pending, setPending] = useState<{ value: T } | null>(null);
  const [failed, setFailed] = useState(false);
  if (pending && Object.is(pending.value, actual)) setPending(null);

  const write = (value: T, request: () => Promise<Response>) => {
    setPending({ value });
    setFailed(false);
    request()
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      })
      .catch(() => {
        setPending(null);
        setFailed(true);
      });
  };

  return { value: pending ? pending.value : actual, write, failed };
};

type MotionProps = {
  className?: string;
  units?: MotionUnit[];
  error?: boolean;
};

const Motion: FC<MotionProps> = ({ className, units = [], error }) => {
  const theme = useTheme();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div
      className={className}
      css={{
        display: "grid",
        gridTemplateColumns: "20px minmax(0, 1fr) auto auto 20px",
        columnGap: 8,
        boxSizing: "border-box",
        width: "100%",
        fontSize: 16,
        color: error ? theme.colors.error : theme.colors.text.main,
        backgroundColor: theme.colors.background.main,
        boxShadow: theme.shadows.main,
        borderRadius: theme.border.radius,
        padding: "1em",
        [mq[0]]: {
          padding: "0.5em",
        },
      }}
    >
      {units.map((u) => (
        <UnitRow
          key={u.id}
          unit={u}
          open={open === u.id}
          onToggle={() => setOpen(open === u.id ? null : u.id)}
        />
      ))}
      {units.length === 0 && (
        <span css={{ gridColumn: "1 / -1", color: theme.colors.text.muted, padding: "8px 4px" }}>
          Ei liiketunnistimia
        </span>
      )}
    </div>
  );
};

export default memo(Motion);

type UnitRowProps = {
  unit: MotionUnit;
  open: boolean;
  onToggle: () => void;
};

const UnitRow: FC<UnitRowProps> = ({ unit, open, onToggle }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery("(max-width: 600px)");
  const demo = useScreenshotMode();

  const enabled = unit.members.some((m) => m.enabled);
  const active = enabled && unit.motion;

  return (
    <div css={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "subgrid" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        css={{
          gridColumn: "1 / -1",
          display: "grid",
          gridTemplateColumns: "subgrid",
          alignItems: "center",
          padding: "8px 4px",
          border: "none",
          background: "transparent",
          font: "inherit",
          textAlign: "left",
          cursor: "pointer",
          opacity: enabled ? 1 : 0.5,
          color: enabled ? theme.colors.text.main : theme.colors.text.muted,
          transition: "opacity 0.3s ease",
        }}
      >
        <span
          css={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: active ? theme.colors.activity.on : theme.colors.text.muted,
            animation: active ? `${motionPulse} 1.8s ease-out infinite` : "none",
          }}
        />
        <span
          css={{
            fontWeight: active ? 600 : 400,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textTransform: "lowercase",
          }}
        >
          {demo ? anonymize(unit.id, "anturi") : unit.name}
        </span>
        <span
          css={{
            color: active ? theme.colors.activity.on : theme.colors.text.muted,
            fontWeight: active ? 600 : 400,
            textAlign: "right",
            whiteSpace: "nowrap",
            transition: "color 0.3s ease",
          }}
        >
          {!enabled ? "pois käytöstä" : unit.motion ? "liikettä" : "ei liikettä"}
        </span>
        <span
          css={{
            color: theme.colors.text.muted,
            fontSize: 13,
            textAlign: "right",
            whiteSpace: "nowrap",
          }}
        >
          {enabled && unit.motionUpdatedAt
            ? formatDistanceToNow(new Date(unit.motionUpdatedAt), {
                addSuffix: !isMobile,
                locale: fi,
              })
            : "—"}
        </span>
        <ChevronDown
          size={18}
          aria-hidden
          css={{
            color: theme.colors.text.muted,
            transform: open ? "rotate(180deg)" : "none",
            transition: `transform ${theme.durations.fast} ease`,
          }}
        />
      </button>
      {open && <UnitSettings unit={unit} />}
    </div>
  );
};

const UnitSettings: FC<{ unit: MotionUnit }> = ({ unit }) => {
  const theme = useTheme();
  return (
    <div
      css={{
        gridColumn: "1 / -1",
        display: "flex",
        flexDirection: "column",
        margin: "0 4px 8px 32px",
        padding: "4px 12px",
        border: `1px solid ${theme.colors.border}`,
        borderRadius: theme.border.radius,
        backgroundColor: theme.colors.background.light,
        color: theme.colors.text.main,
        fontSize: 15,
        "& > section + section": { borderTop: `1px solid ${theme.colors.border}` },
        [mq[0]]: { marginLeft: 4 },
      }}
    >
      {unit.members.map((m) => (
        <MemberSettings key={m.id} member={m} unitName={unit.name} />
      ))}
      {unit.daylight && <DaylightSettings daylight={unit.daylight} />}
    </div>
  );
};

type MemberSettingsProps = {
  member: MotionMember;
  unitName: string;
};

const MemberSettings: FC<MemberSettingsProps> = ({ member, unitName }) => {
  const demo = useScreenshotMode();
  const enabled = useBridgeWrite(member.enabled);
  const sensitivity = useBridgeWrite(member.sensitivity?.value);

  const kind = KIND_LABELS[member.kind];
  const label = demo || member.name === unitName ? kind : `${kind} · ${member.name}`;
  const scale = member.sensitivity;

  return (
    <section>
      <SettingRow label={label}>
        <Switch
          checked={enabled.value}
          label="käytössä"
          onChange={(next) =>
            enabled.write(next, () =>
              post(`/api/hue/setMotionEnabled/${member.id}`, { kind: member.kind, enabled: next }),
            )
          }
        />
      </SettingRow>
      {enabled.value && scale && sensitivity.value !== undefined && (
        <SettingRow label="herkkyys" hint={sensitivityLabel(sensitivity.value, scale.max)}>
          <Levels
            value={sensitivity.value}
            max={scale.max}
            onChange={(next) =>
              sensitivity.write(next, () =>
                post(`/api/hue/setMotionSensitivity/${member.id}`, {
                  kind: member.kind,
                  sensitivity: next,
                }),
              )
            }
          />
        </SettingRow>
      )}
      {(enabled.failed || sensitivity.failed) && <Refusal />}
    </section>
  );
};

type DaylightSettingsProps = {
  daylight: NonNullable<MotionUnit["daylight"]>;
};

const DaylightSettings: FC<DaylightSettingsProps> = ({ daylight }) => {
  const theme = useTheme();
  const threshold = useBridgeWrite(daylight.darkThreshold);
  const [dragged, setDragged] = useState<number | null>(null);

  const write = (next: number | null) =>
    threshold.write(next, () =>
      post(`/api/hue/setDaylight/${daylight.automationId}`, { darkThreshold: next }),
    );
  const level = dragged ?? threshold.value;
  const now = daylight.lightLevel;
  const dark = now !== undefined && level !== null && now < level;

  return (
    <section>
      <SettingRow label="vain hämärässä">
        <Switch
          checked={threshold.value !== null}
          label="vain hämärässä"
          onChange={(on) => write(on ? DARK_THRESHOLD_DEFAULT : null)}
        />
      </SettingRow>
      {level !== null && (
        <div css={{ paddingBottom: 8 }}>
          <SettingRow label="hämärän raja" hint={`alle ${formatLux(level)}`}>
            {now !== undefined && (
              <span
                css={{
                  ...theme.typography.caption,
                  color: dark ? theme.colors.activity.on : theme.colors.text.muted,
                }}
              >
                {`nyt ${formatLux(now)} · ${dark ? "valot syttyvät" : "valot eivät syty"}`}
              </span>
            )}
          </SettingRow>
          <ThresholdSlider
            value={level}
            now={now}
            onInput={setDragged}
            onRelease={(next) => {
              setDragged(null);
              if (next !== threshold.value) write(next);
            }}
          />
          <ScaleEnds low="pimeä" high="valoisa" />
        </div>
      )}
      {threshold.failed && <Refusal />}
    </section>
  );
};

type SettingRowProps = {
  label: string;
  hint?: string;
  children?: ReactNode;
};

const SettingRow: FC<SettingRowProps> = ({ label, hint, children }) => {
  const theme = useTheme();
  return (
    <div
      css={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 12,
        minHeight: 44,
        padding: "4px 0",
      }}
    >
      <span css={{ display: "flex", flexDirection: "column", textTransform: "lowercase" }}>
        {label}
        {hint && (
          <span css={{ ...theme.typography.caption, color: theme.colors.text.muted }}>{hint}</span>
        )}
      </span>
      {children}
    </div>
  );
};

type LevelsProps = {
  value: number;
  max: number;
  onChange: (value: number) => void;
};

const Levels: FC<LevelsProps> = ({ value, max, onChange }) => {
  const theme = useTheme();
  const [low, high] = sensitivityEnds(max);
  return (
    <div css={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div role="radiogroup" aria-label="herkkyys" css={{ display: "flex", gap: 4 }}>
        {Array.from({ length: max + 1 }, (_, level) => {
          const selected = level === value;
          return (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={sensitivityLabel(level, max)}
              onClick={() => {
                if (!selected) onChange(level);
              }}
              css={{
                width: 40,
                height: 36,
                border: `1px solid ${selected ? theme.colors.activity.on : theme.colors.border}`,
                borderRadius: theme.border.radiusPill,
                backgroundColor: selected ? theme.colors.activity.onSoft : "transparent",
                color: selected ? theme.colors.activity.on : theme.colors.text.main,
                font: "inherit",
                fontVariantNumeric: "tabular-nums",
                cursor: "pointer",
              }}
            >
              {level + 1}
            </button>
          );
        })}
      </div>
      <ScaleEnds low={low} high={high} />
    </div>
  );
};

/** Names both ends of a scale, so the direction shows before a value is picked. */
const ScaleEnds: FC<{ low: string; high: string }> = ({ low, high }) => {
  const theme = useTheme();
  return (
    <div
      aria-hidden
      css={{
        display: "flex",
        justifyContent: "space-between",
        gap: 8,
        ...theme.typography.caption,
        color: theme.colors.text.muted,
      }}
    >
      <span>{`← ${low}`}</span>
      <span>{`${high} →`}</span>
    </div>
  );
};

type ThresholdSliderProps = {
  value: number;
  /** The current reading, marked on the track. */
  now?: number;
  onInput: (value: number) => void;
  onRelease: (value: number) => void;
};

/** Writes once on release: the native `change` event, which React's onChange is not. */
const ThresholdSlider: FC<ThresholdSliderProps> = ({ value, now, onInput, onRelease }) => {
  const theme = useTheme();
  const ref = useRef<HTMLInputElement>(null);
  const release = useEffectEvent((input: HTMLInputElement) => onRelease(Number(input.value)));

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const handle = () => release(input);
    input.addEventListener("change", handle);
    return () => input.removeEventListener("change", handle);
  }, []);

  return (
    <div css={{ position: "relative", paddingTop: now === undefined ? 0 : 16 }}>
      {now !== undefined && <NowMarker fraction={thresholdFraction(now)} />}
      <input
        ref={ref}
        type="range"
        aria-label="hämärän raja"
        min={DARK_THRESHOLD_MIN}
        max={DARK_THRESHOLD_MAX}
        step={100}
        value={value}
        onChange={(e) => onInput(Number(e.target.value))}
        css={{
          display: "block",
          width: "100%",
          height: 32,
          margin: 0,
          accentColor: theme.colors.activity.on,
          cursor: "pointer",
        }}
      />
    </div>
  );
};

/** Half the native thumb: its centre never reaches the ends of the track. */
const THUMB_INSET = 8;

const NowMarker: FC<{ fraction: number }> = ({ fraction }) => {
  const theme = useTheme();
  return (
    <div
      aria-hidden
      css={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: `calc(${THUMB_INSET}px + ${fraction} * (100% - ${2 * THUMB_INSET}px))`,
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      <span css={{ ...theme.typography.caption, lineHeight: "16px" }}>nyt</span>
      <span
        css={{
          flex: 1,
          width: 2,
          margin: "6px 0",
          borderRadius: 1,
          backgroundColor: theme.colors.text.main,
        }}
      />
    </div>
  );
};

const Refusal: FC = () => {
  const theme = useTheme();
  return (
    <span
      role="alert"
      css={{
        display: "block",
        paddingBottom: 8,
        ...theme.typography.caption,
        color: theme.colors.error,
      }}
    >
      silta ei hyväksynyt muutosta
    </span>
  );
};
