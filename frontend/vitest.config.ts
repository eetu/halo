import { playwright } from "@vitest/browser-playwright";
import { configDefaults, defineConfig, mergeConfig } from "vitest/config";

import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          // Regular unit tests in Node.js environment
          test: {
            name: "unit",
            globals: true,
            environment: "node",
            include: ["src/**/*.{test,spec}.?(c|m)[jt]s"],
            exclude: [
              ...configDefaults.exclude,
              "**/*.browser.{test,spec}.*",
              "**/e2e-tests/**",
              "**/playwright.configuration.ts",
            ],
          },
        },
        {
          // Browser tests for React components
          // Vitest keeps process.env in pre-bundled deps, so both of React's
          // CJS builds get bundled and rolldown inlines the production build's
          // `jsxDEV = void 0`. Pin the dev build (vitest-dev/vitest#11265).
          optimizeDeps: {
            rolldownOptions: {
              transform: { define: { "process.env.NODE_ENV": JSON.stringify("development") } },
            },
          },
          test: {
            name: "browser",
            globals: true,
            include: ["src/**/*.browser.{test,spec}.?(c|m)[jt]s?(x)"],
            exclude: [
              ...configDefaults.exclude,
              "**/e2e-tests/**",
              "**/playwright.configuration.ts",
            ],
            browser: {
              enabled: true,
              headless: true,
              provider: playwright(),
              instances: [{ browser: "chromium" }],
            },
          },
        },
      ],
    },
  })
);
