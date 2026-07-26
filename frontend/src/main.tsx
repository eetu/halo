import React from "react";
import ReactDOM from "react-dom/client";

import Root from "./Root";

// Installed-PWA detection, before first paint — drives the 100vh-vs-100dvh
// full-height rule in Root's global styles. `navigator.standalone` is the
// iOS-reliable signal; the media query covers installs elsewhere.
const standalone =
  (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
  window.matchMedia("(display-mode: standalone)").matches;
document.documentElement.classList.toggle("standalone", standalone);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
