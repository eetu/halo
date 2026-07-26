import { useTheme } from "@emotion/react";

import { Trend } from "../hooks/useSensorTrend";
import Icon from "./Icon";

type TrendIndicatorProps = {
  trend: Trend;
  size?: number;
};

const TrendIndicator: React.FC<TrendIndicatorProps> = ({ trend, size = 24 }) => {
  const theme = useTheme();

  if (trend === "stable") return null;

  const isUp = trend === "up" || trend === "big_up";
  const isDouble = trend === "big_up" || trend === "big_down";
  const color = isUp ? theme.colors.warm : theme.colors.cool;
  const icon = isDouble ? "keyboard_double_arrow_up" : "keyboard_arrow_up";

  return (
    <Icon
      size={size}
      css={{
        color,
        transform: isUp ? "none" : "rotate(180deg)",
      }}
    >
      {icon}
    </Icon>
  );
};

export default TrendIndicator;
