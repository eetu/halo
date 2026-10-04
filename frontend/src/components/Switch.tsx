import { useTheme } from "@emotion/react";
import { FC } from "react";

type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
};

/** Says a thing exists or is in use, not that a feature is lit. */
const Switch: FC<SwitchProps> = ({ checked, onChange, label }) => {
  const theme = useTheme();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      css={{
        position: "relative",
        flexShrink: 0,
        width: 48,
        height: 28,
        padding: 0,
        border: "none",
        borderRadius: 14,
        cursor: "pointer",
        backgroundColor: checked ? theme.colors.activity.on : theme.colors.activity.offBackground,
        transition: `background-color ${theme.durations.fast} ease`,
      }}
    >
      <span
        css={{
          position: "absolute",
          top: 3,
          left: checked ? 23 : 3,
          width: 22,
          height: 22,
          borderRadius: "50%",
          // White in both themes: the dark surface colour vanishes into the track.
          backgroundColor: "#fff",
          boxShadow: "0 1px 2px rgba(0, 0, 0, 0.3)",
          transition: `left ${theme.durations.fast} ease`,
        }}
      />
    </button>
  );
};

export default Switch;
