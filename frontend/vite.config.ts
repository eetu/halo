import react from "@vitejs/plugin-react";
import AutoImport from "unplugin-auto-import/vite";
import { defineConfig, type Plugin } from "vite";
import { qrcode } from "vite-plugin-qrcode";

// Emit the baked image tag as a fetchable asset so a running bundle can notice
// it has been superseded and reload itself (see hooks/useDeployReload.ts). The
// tag inside the bundle is stale by definition — the comparison needs a copy
// that is re-fetched from the server.
const emitVersion = (): Plugin => ({
  name: "halo-emit-version",
  apply: "build",
  generateBundle() {
    this.emitFile({
      type: "asset",
      fileName: "version.json",
      source: JSON.stringify({ build: process.env.VITE_HALO_IMAGE_TAG ?? "" }),
    });
  },
});

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
    emitVersion(),
  ],
});
