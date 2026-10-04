import type React from "react";

import Icon from "./Icon";

type SpinnerProps = {
  className?: string;
};

const Spinner: React.FC<SpinnerProps> = ({ className }) => {
  return (
    <div
      className={className}
      css={{
        opacity: 0.75,
      }}
    >
      <Icon
        css={{
          animation: "spin 1s alternate infinite",
          "@keyframes spin": {
            "100%": {
              transform: "rotate(360deg)",
            },
          },
        }}
      >
        wb_sunny
      </Icon>
      <Icon
        css={{
          marginLeft: -20,
          animation: "move 1s alternate infinite",
          "@keyframes move": {
            "100%": {
              transform: "translateX(10px)",
            },
          },
        }}
        type="normal"
      >
        cloud
      </Icon>
    </div>
  );
};

export default Spinner;
