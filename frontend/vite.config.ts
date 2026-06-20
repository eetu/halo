import react from "@vitejs/plugin-react";
import AutoImport from "unplugin-auto-import/vite";
import { defineConfig } from "vite";
import { qrcode } from "vite-plugin-qrcode";

// https://vitejs.dev/config/
export default defineConfig({
  // Proxy API calls to the backend so the frontend can use same-origin relative
  // URLs (VITE_API_URL=""). This keeps `yarn dev --host` working from other LAN
  // devices — the request hits this dev server's IP and is forwarded here to the
  // backend on localhost, instead of the device trying its own localhost:3000.
  server: {
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  plugins: [
    react({
      jsxImportSource: "@emotion/react",
      babel: {
        plugins: ["babel-plugin-react-compiler"],
      },
    }),
    AutoImport({
      imports: ["vitest"],
      dts: true,
    }),
    // Print a scannable QR code for the LAN URL with `yarn dev --host`.
    qrcode(),
  ],
});
