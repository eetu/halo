import classNames from "classnames";
import React from "react";

type IconProps = {
  children: string;
  size?: number;
  type?: "normal" | "outlined";
} & React.HTMLAttributes<HTMLDivElement>;

const Icon: React.FC<IconProps> = ({
  children,
  style,
  className,
  size = 24,
  type = "outlined",
}) => {
  return (
    <span
      style={style}
      className={classNames(className, `material-icons${type === "outlined" ? "-outlined" : ""}`)}
      css={{
        fontSize: size,
      }}
    >
      {children}
    </span>
  );
};

export default Icon;
