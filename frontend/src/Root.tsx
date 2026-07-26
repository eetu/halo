import { Global, ThemeProvider } from "@emotion/react";
import { useMediaQuery } from "usehooks-ts";

import App from "./App";
import useDeployReload from "./hooks/useDeployReload";
import { darkTheme, lightTheme } from "./themes";

const Root = () => {
  const isDarkTheme = useMediaQuery("(prefers-color-scheme: dark)");
  const theme = isDarkTheme ? darkTheme : lightTheme;

  useDeployReload();

  return (
    <ThemeProvider theme={theme}>
      <Global
        styles={{
          // Full height: 100dvh in a browser tab, but 100vh once installed. In
          // a standalone iOS PWA the dynamic viewport is stale at cold start and
          // resolves short, leaving a dead band at the bottom until a rotate;
          // 100vh resolves against the static viewport, and standalone has no
          // browser chrome, so it is exactly the screen. `.standalone` is set on
          // <html> in main.tsx.
          "html, body": {
            height: ["100svh", "100dvh"],
          },
          "html.standalone, html.standalone body": {
            height: "100vh",
          },
          html: {
            fontFamily: theme.fonts.body,
          },
          body: {
            padding: 0,
            margin: 0,
            // Body owns the viewport; #root is the scroll container. Keeps a
            // phantom page scrollbar from appearing behind the fullscreen view.
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            backgroundColor: theme.colors.body,
            color: theme.colors.text.main,
            userSelect: "none",
            WebkitFontSmoothing: "antialiased",
          },
          a: {
            color: "inherit",
            textDecoration: "none",
          },
          "*": {
            boxSizing: "border-box",
          },
          // Disables iOS double-tap-to-zoom (it misfires on quick repeated taps
          // — brightness steppers, view tabs) while keeping pinch and scroll.
          'button, [role="button"], summary, label': {
            touchAction: "manipulation",
          },
          "#root": {
            width: "100%",
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            // The top chrome (wordmark, fullscreen button) is absolute against
            // this box, so it needs to be the positioned ancestor.
            position: "relative",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            // black-translucent overlays the status bar; landscape notches eat
            // the sides. env() is 0 unless the viewport is viewport-fit=cover.
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
            paddingLeft: "env(safe-area-inset-left)",
            paddingRight: "env(safe-area-inset-right)",
          },
        }}
      />
      <App />
    </ThemeProvider>
  );
};

export default Root;
