import { keyframes, useTheme } from "@emotion/react";
import { formatDistanceToNow } from "date-fns";
import { fi } from "date-fns/locale/fi";
import { FC, memo, useState } from "react";
import { useMediaQuery } from "usehooks-ts";

import { api } from "../api";
import useScreenshotMode, { anonymize } from "../hooks/useScreenshotMode";
import { mq } from "../mq";
import { Sensor } from "../types/hue";

const motionPulse = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 rgba(247, 143, 8, 0.5); }
  50%      { box-shadow: 0 0 0 6px rgba(247, 143, 8, 0); }
`;

type MotionProps = {
  className?: string;
  sensors?: Sensor[];
  error?: boolean;
};

const Motion: FC<MotionProps> = ({ className, sensors = [], error }) => {
  const theme = useTheme();
  const isMobile = useMediaQuery("(max-width: 600px)");
  const demo = useScreenshotMode();

  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const motionSensors = sensors.filter(
    (s) => s.motion !== undefined || s.motionEnabled !== undefined,
  );

  const toggle = async (deviceId: string) => {
    if (pending.has(deviceId)) return;
    setPending((p) => new Set(p).add(deviceId));
    try {
      await fetch(api(`/api/hue/toggleMotion/${deviceId}`), { method: "POST" });
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(deviceId);
        return next;
      });
    }
  };

  return (
    <div
      className={className}
      css={{
        display: "table",
        width: "100%",
        fontSize: 16,
        color: error ? theme.colors.error : theme.colors.text.main,
        backgroundColor: theme.colors.background.main,
        boxShadow: theme.shadows.main,
        borderRadius: 6,
        padding: "1em",
        [mq[0]]: {
          padding: "0.5em",
        },
      }}
    >
      {motionSensors.map((s) => {
        const enabled = s.motionEnabled !== false;
        const active = enabled && s.motion;
        return (
          <div
            key={s.id}
            onClick={() => toggle(s.deviceId)}
            aria-label={enabled ? "Poista liiketunnistin käytöstä" : "Ota käyttöön"}
            css={{
              display: "table-row",
              opacity: enabled ? 1 : 0.5,
              cursor: pending.has(s.deviceId) ? "wait" : "pointer",
              border: "none",
              padding: 0,
              color: enabled ? theme.colors.text.main : theme.colors.text.muted,
              transition: "opacity 0.3s ease",
            }}
          >
            <span
              css={{
                display: "table-cell",
                padding: "8px 4px",
                verticalAlign: "middle",
                width: 20,
              }}
            >
              <span
                css={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: active ? theme.colors.activity.on : theme.colors.text.muted,
                  animation: active ? `${motionPulse} 1.8s ease-out infinite` : "none",
                }}
              />
            </span>
            <span
              css={{
                display: "table-cell",
                padding: "8px 4px",
                verticalAlign: "middle",
              }}
            >
              <span
                css={{
                  fontWeight: active ? 600 : 400,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textTransform: "lowercase",
                }}
              >
                {demo ? anonymize(s.id, "anturi") : s.name}
              </span>
            </span>
            <span
              css={{
                display: "table-cell",
                padding: "8px 4px",
                verticalAlign: "middle",
                color: active ? theme.colors.activity.on : theme.colors.text.muted,
                fontWeight: active ? 600 : 400,
                textAlign: "right",
                whiteSpace: "nowrap",
                transition: "color 0.3s ease",
              }}
            >
              {!enabled ? "pois käytöstä" : s.motion ? "liikettä" : "ei liikettä"}
            </span>
            <span
              css={{
                display: "table-cell",
                padding: "8px 4px",
                verticalAlign: "middle",
                color: theme.colors.text.muted,
                fontSize: 13,
                textAlign: "right",
                whiteSpace: "nowrap",
              }}
            >
              {enabled && s.motionUpdatedAt
                ? formatDistanceToNow(new Date(s.motionUpdatedAt), {
                    addSuffix: !isMobile,
                    locale: fi,
                  })
                : "—"}
            </span>
          </div>
        );
      })}
      {motionSensors.length === 0 && (
        <div css={{ display: "table-row" }}>
          <span
            css={{
              display: "table-cell",
              color: theme.colors.text.muted,
              padding: "8px 4px",
            }}
          >
            Ei liiketunnistimia
          </span>
        </div>
      )}
    </div>
  );
};

export default memo(Motion);
