import { playwright } from "@vitest/browser-playwright"
import { defineConfig, mergeConfig } from "vitest/config"

import viteConfig from "./vite.config.ts"

// The dashboard runs in browsers, so its tests do too, built as the app is: Playwright's Chromium,
// at 1280 by 900, in a time zone and a language far from the usual ones (as `bun run test` sets for
// Node), so formatting that leans on the machine fails here too.
export default mergeConfig(
  viteConfig,
  defineConfig({
    // Every library the app and its tests use is found before the tests start, so Vite doesn't
    // reload the page mid-test when it meets a new one.
    optimizeDeps: { entries: ["src/**/*.{ts,tsx}", "test/**/*.{ts,tsx}"] },
    test: {
      include: ["test/**/*.test.{ts,tsx}"],
      setupFiles: ["test/setup.ts"],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright({ contextOptions: { locale: "tr-TR", timezoneId: "Pacific/Chatham" } }),
        instances: [{ browser: "chromium" }],
        viewport: { width: 1280, height: 900 },
      },
    },
  }),
)
