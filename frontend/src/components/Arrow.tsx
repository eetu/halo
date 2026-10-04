import { useTheme } from "@emotion/react";
import type React from "react";

type ArrowProps = {
  className?: string;
  deg?: number;
} & React.HTMLAttributes<HTMLDivElement>;

const Arrow: React.FC<ArrowProps> = ({ className, deg }) => {
  const theme = useTheme();

  return (
    <div
      className={className}
      style={{ transform: `rotate(${deg}deg)` }}
      css={{
        position: "relative",
        height: "24px",
        width: "24px",
      }}
    >
      <div
        css={{
          position: "absolute",
          top: 0,
          left: 0,
          height: "inherit",
          width: "inherit",
          borderRadius: "100%",
          border: `2px solid ${theme.colors.text.main}`,
          opacity: 0.75,
        }}
      />
      <div
        css={{
          position: "absolute",
          left: 7,
          top: 6,
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderBottom: `10px solid ${theme.colors.text.main}`,
        }}
      />
    </div>
  );
};

export default Arrow;
