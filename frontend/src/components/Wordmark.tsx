import { useTheme } from "@emotion/react";
import React, { memo } from "react";

import { mq } from "../mq";

type WordmarkProps = {
  size?: number;
} & React.HTMLAttributes<HTMLDivElement>;

const Wordmark: React.FC<WordmarkProps> = ({
  className,
  size = 22,
  ...rest
}) => {
  const theme = useTheme();

  return (
    <div
      {...rest}
      className={className}
      css={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: theme.colors.text.main,
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="32" cy="32" r="22" stroke="currentColor" strokeWidth="3" />
        <circle cx="32" cy="32" r="6" fill={theme.colors.activity.on} />
      </svg>
      <span
        css={{
          fontFamily: theme.fonts.body,
          fontWeight: 600,
          letterSpacing: "-0.04em",
          fontSize: size,
          lineHeight: 1,
          whiteSpace: "nowrap",
          [mq[0]]: { display: "none" },
        }}
      >
        i shot marvin in the halo
        <span css={{ color: theme.colors.activity.on }}>.</span>
      </span>
    </div>
  );
};

export default memo(Wordmark);
