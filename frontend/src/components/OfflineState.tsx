import { useTheme } from "@emotion/react";
import { formatDistanceToNow } from "date-fns";
import { fi } from "date-fns/locale/fi";
import { FC } from "react";

import Icon from "./Icon";

type OfflineStateProps = {
  label: string;
  lastSeen?: Date | null;
};

const OfflineState: FC<OfflineStateProps> = ({ label, lastSeen }) => {
  const theme = useTheme();
  return (
    <div
      css={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        color: theme.colors.text.muted,
        padding: "0.5em 0",
      }}
    >
      <Icon size={32}>cloud_off</Icon>
      <div
        css={{
          ...theme.typography.label,
          color: theme.colors.text.muted,
          letterSpacing: "0.04em",
          textTransform: "lowercase",
        }}
      >
        {label}
      </div>
      {lastSeen && (
        <div
          css={{
            ...theme.typography.caption,
            color: theme.colors.text.light,
          }}
        >
          päivitetty {formatDistanceToNow(lastSeen, { locale: fi, addSuffix: true })}
        </div>
      )}
    </div>
  );
};

export default OfflineState;
