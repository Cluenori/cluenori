import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

// Runs the journeys inside workerd, next to the Worker that wrangler.jsonc describes, with local
// storage of its own.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "../../apps/worker/wrangler.jsonc" } })],
  test: { include: ["test/**/*.test.ts"] },
})
