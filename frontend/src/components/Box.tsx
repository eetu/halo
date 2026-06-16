import { useTheme } from "@emotion/react";
import React, { useRef, useState } from "react";

import Icon from "./Icon";
import Spinner from "./Spinner";

type BoxProps = {
  className?: string;
  drawer?: React.ReactElement;
  loading?: boolean;
  // full-bleed layer rendered behind header + footer; when set, those surfaces
  // turn transparent so it shows through continuously (e.g. weather animation)
  background?: React.ReactElement;
  // overrides the header/footer divider colour (e.g. to match a sky backdrop)
  borderColor?: string;
} & React.HTMLAttributes<HTMLDivElement>;

const Box: React.FC<BoxProps> = ({
  className,
  children,
  drawer,
  loading,
  background,
  borderColor,
}) => {
  const [collapsed, setCollapsed] = useState(true);
  const theme = useTheme();

  if (loading) {
    return (
      <div
        className={className}
        css={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Spinner />
      </div>
    );
  }

  const expandable = drawer !== undefined;

  return (
    <div
      className={className}
      css={{
        position: "relative",
        cursor: expandable ? "pointer" : "default",
        minWidth: 0,
        overflow: "hidden",
        boxShadow: theme.shadows.main,
        borderRadius: theme.border.radius,
      }}
      onClick={expandable ? () => setCollapsed(!collapsed) : undefined}
    >
      {background && (
        <div css={{ position: "absolute", inset: 0, zIndex: 0 }}>
          {background}
        </div>
      )}
      <BoxHeader
        hairline={expandable}
        transparent={background !== undefined}
        borderColor={borderColor}
      >
        {children}
      </BoxHeader>
      {expandable && (
        <>
          <BoxDrawer collapsed={collapsed}>{drawer}</BoxDrawer>
          <BoxFooter
            collapsed={collapsed}
            transparent={background !== undefined}
            borderColor={borderColor}
          />
        </>
      )}
    </div>
  );
};

export default Box;

type BoxHeaderProps = {
  hairline: boolean;
  transparent?: boolean;
  borderColor?: string;
} & React.HTMLAttributes<HTMLDivElement>;

const BoxHeader: React.FC<BoxHeaderProps> = ({
  children,
  hairline,
  transparent,
  borderColor,
}) => {
  const theme = useTheme();

  return (
    <div
      css={{
        position: "relative",
        zIndex: 1,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        backgroundColor: transparent
          ? "transparent"
          : theme.colors.background.main,
        padding: "1.5em",
        borderBottom: hairline
          ? `1px ${borderColor ?? theme.colors.border} solid`
          : "none",
      }}
    >
      {children}
    </div>
  );
};

type BoxDrawerProps = {
  collapsed: boolean;
} & React.HTMLAttributes<HTMLDivElement>;

const BoxDrawer: React.FC<BoxDrawerProps> = ({ children, collapsed }) => {
  const theme = useTheme();
  const wrapperRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={wrapperRef}
      css={{
        position: "relative",
        zIndex: 1,
        display: "grid",
        gridTemplateRows: collapsed ? "0fr" : "1fr",
        transition: "grid-template-rows 0.15s ease",
      }}
      onTransitionEnd={() => {
        if (!collapsed) {
          wrapperRef.current?.scrollIntoView({ behavior: "smooth" });
        }
      }}
    >
      <div css={{ minHeight: 0, overflow: "hidden" }}>
        <div
          css={{
            borderLeft: `1px ${theme.colors.border} solid`,
            borderRight: `1px ${theme.colors.border} solid`,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

type BoxFooterProps = {
  collapsed: boolean;
  transparent?: boolean;
  borderColor?: string;
} & React.HTMLAttributes<HTMLDivElement>;

const BoxFooter: React.FC<BoxFooterProps> = ({
  collapsed,
  transparent,
  borderColor,
}) => {
  const theme = useTheme();

  return (
    <div
      css={{
        position: "relative",
        zIndex: 1,
        display: "flex",
        justifyContent: "center",
        height: "25px",
        backgroundColor: transparent
          ? "transparent"
          : theme.colors.background.main,
        borderTop: collapsed
          ? "none"
          : `1px ${borderColor ?? theme.colors.border} solid`,
        color: theme.colors.text.light,
      }}
    >
      <Icon>menu</Icon>
    </div>
  );
};

export const DrawerRow: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
}> = ({ label, value }) => {
  const theme = useTheme();
  return (
    <div
      css={{
        width: "100%",
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <span css={{ color: theme.colors.text.muted }}>{label}</span>
      <span>{value}</span>
    </div>
  );
};
