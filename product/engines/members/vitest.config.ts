import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

// The engine runs inside the workspace's Durable Object, so its tests run inside workerd, with the
// Durable Object that test/wrangler.jsonc describes.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./test/wrangler.jsonc" } })],
  test: { include: ["test/**/*.test.ts"] },
})
