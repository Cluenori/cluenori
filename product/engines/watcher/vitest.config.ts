import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

// The engine runs inside the workspace's Durable Object, so its tests run inside workerd, with the
// Durable Object that test/wrangler.jsonc describes.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./test/wrangler.jsonc" } })],
  // No on-disk module cache: with it, the Cloudflare plugin sends a test worker every cached module in
  // one message, which outgrows workerd's 32 MiB limit (PATTERNS.md, "Testing").
  test: {
    fsModuleCache: false,
    include: ["test/**/*.test.ts"],
  },
})
