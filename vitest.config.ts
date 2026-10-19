import { defineConfig } from "vitest/config"

// Every package with tests has its own vitest.config.ts; `bun run test` runs them all as projects.
export default defineConfig({
  test: {
    projects: [
      "packages/*/vitest.config.ts",
      "product/**/vitest.config.ts",
      "apps/*/vitest.config.ts",
      "sdks/*/vitest.config.ts",
      "tests/*/vitest.config.ts",
    ],
  },
})
