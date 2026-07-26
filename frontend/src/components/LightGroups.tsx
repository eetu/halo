import { keyframes, useTheme } from "@emotion/react";
import { FC, memo, PointerEvent, useCallback, useRef, useState } from "react";

import { api } from "../api";
import useScreenshotMode, { anonymize } from "../hooks/useScreenshotMode";
import { mq } from "../mq";
import { Group } from "../types/hue";
import Icon from "./Icon";

const bulbGlow = keyframes`
  0%, 100% { filter: drop-shadow(0 0 4px rgba(247, 143, 8, 0.55)); }
  50%      { filter: drop-shadow(0 0 10px rgba(247, 143, 8, 0.85)); }
`;

const LONG_PRESS_MS = 350;
const MOVE_CANCEL_PX = 8;
const LIVE_THROTTLE_MS = 200;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type LightGroupsProps = {
  groups: Group[];
} & React.HTMLAttributes<HTMLDivElement>;

const LightGroups: FC<LightGroupsProps> = ({ groups, className }) => {
  const theme = useTheme();

  return (
    <div
      className={className}
      css={{
        backgroundColor: theme.colors.background.main,
        boxShadow: theme.shadows.main,
        padding: "1em",
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 12,
        borderRadius: theme.border.radius,
        [mq[0]]: {
          gridTemplateColumns: "1fr",
        },
      }}
    >
      {groups.map((g) => (
        <LightGroup key={g.id} group={g} />
      ))}
    </div>
  );
};

export default memo(LightGroups);

type LightGroupProps = {
  group: Group;
};

const LightGroup: FC<LightGroupProps> = ({ group }) => {
  const [isOn, setIsOn] = useState(group.state.on);
  const [prevOn, setPrevOn] = useState(group.state.on);
  const [brightness, setBrightness] = useState(group.state.brightness ?? 100);
  const [prevBrightness, setPrevBrightness] = useState(group.state.brightness ?? 100);
  const [dimming, setDimming] = useState(false);

  // Sync from props (live SSE updates).
  if (prevOn !== group.state.on) {
    setPrevOn(group.state.on);
    if (!dimming) setIsOn(group.state.on);
  }
  const incomingBrightness = group.state.brightness ?? 100;
  if (prevBrightness !== incomingBrightness) {
    setPrevBrightness(incomingBrightness);
    if (!dimming) setBrightness(incomingBrightness);
  }

  const buttonRef = useRef<HTMLButtonElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const dragStartRef = useRef<{
    x: number;
    y: number;
    brightness: number;
  } | null>(null);
  const skipClickRef = useRef(false);
  const lastSentRef = useRef(0);

  const sendBrightness = useCallback(
    (val: number) => {
      fetch(api(`/api/hue/setBrightness/${group.id}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brightness: val }),
      });
    },
    [group.id],
  );

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        brightness,
      };
      cancelLongPress();
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        setDimming(true);
        setIsOn(true);
        buttonRef.current?.setPointerCapture(e.pointerId);
      }, LONG_PRESS_MS);
    },
    [brightness, cancelLongPress],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      const start = dragStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;

      if (longPressTimerRef.current !== null) {
        if (Math.abs(dx) > MOVE_CANCEL_PX || Math.abs(dy) > MOVE_CANCEL_PX) {
          cancelLongPress();
          dragStartRef.current = null;
        }
        return;
      }
      if (!dimming) return;

      const width = buttonRef.current?.clientWidth ?? 1;
      const next = clamp(start.brightness + (dx / width) * 100, 0, 100);
      setBrightness(next);

      const now = performance.now();
      if (now - lastSentRef.current > LIVE_THROTTLE_MS) {
        lastSentRef.current = now;
        sendBrightness(next);
      }
    },
    [dimming, cancelLongPress, sendBrightness],
  );

  const finishGesture = useCallback(
    (e: PointerEvent<HTMLButtonElement>, commit: boolean) => {
      cancelLongPress();
      if (dimming) {
        skipClickRef.current = true;
        if (commit) {
          sendBrightness(brightness);
          setIsOn(brightness > 0);
        }
        setDimming(false);
        if (buttonRef.current?.hasPointerCapture(e.pointerId)) {
          buttonRef.current.releasePointerCapture(e.pointerId);
        }
      }
      dragStartRef.current = null;
    },
    [brightness, cancelLongPress, dimming, sendBrightness],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => finishGesture(e, true),
    [finishGesture],
  );

  const handlePointerCancel = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => finishGesture(e, false),
    [finishGesture],
  );

  const handleClick = useCallback(() => {
    if (skipClickRef.current) {
      skipClickRef.current = false;
      return;
    }
    fetch(api(`/api/hue/toggleGroup/${group.id}`), { method: "POST" }).then((res) => {
      if (res.status === 200) setIsOn((prev) => !prev);
    });
  }, [group.id]);

  const theme = useTheme();
  const demo = useScreenshotMode();
  const accent = theme.colors.activity.on;
  const muted = theme.colors.text.muted;
  const showFill = isOn || dimming;
  const fillWidth = showFill ? brightness : 0;

  return (
    <button
      ref={buttonRef}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      css={{
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        color: theme.colors.text.main,
        padding: "8px 16px 8px 6px",
        cursor: "pointer",
        width: "100%",
        borderRadius: theme.border.radius,
        border: `3px solid ${isOn ? accent : theme.colors.text.main}`,
        background: theme.colors.background.light,
        transition: "border-color 0.3s ease",
        textAlign: "left",
        touchAction: "pan-y",
        userSelect: "none",
      }}
    >
      <div
        aria-hidden
        css={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: `${fillWidth}%`,
          background: theme.colors.activity.onBackground,
          pointerEvents: "none",
          transition: dimming ? "none" : "width 0.3s ease, opacity 0.3s ease",
          opacity: showFill ? 1 : 0,
        }}
      />
      <div
        css={{
          position: "relative",
          flexShrink: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          borderRadius: "100%",
          backgroundColor: isOn ? "rgba(247, 143, 8, 0.18)" : "rgba(0, 0, 0, 0.06)",
          height: 42,
          width: 42,
          transition: "background 0.4s ease",
        }}
      >
        <Icon
          css={{
            color: isOn ? accent : muted,
            animation: isOn ? `${bulbGlow} 3.2s ease-in-out infinite` : "none",
            transition: "color 0.3s ease",
          }}
          size={32}
          type="normal"
        >
          lightbulb
        </Icon>
      </div>
      <div
        css={{
          position: "relative",
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <span
          css={{
            fontSize: 16,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textTransform: "lowercase",
          }}
        >
          {demo ? anonymize(group.id, "ryhmä") : group.name}
        </span>
      </div>
    </button>
  );
};
