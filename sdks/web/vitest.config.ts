import { defineConfig } from "vitest/config"

// The SDK's engine against a fake deployment at `fetch`, outside workerd: its contract with the
// real Worker is checked by the apps journey (tests/journeys/test/apps-journey.test.ts).
export default defineConfig({
  test: { name: "@cluenori/sdk", include: ["test/**/*.test.ts"] },
})
