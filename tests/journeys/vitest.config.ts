import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

// Runs the journeys inside workerd, next to the Worker that wrangler.jsonc describes, with local
// storage of its own and the API settings `./setup` makes for a deployment. Nothing reaches
// Cloudflare: left on, remote bindings would open a session for the Worker's Workers AI binding,
// which needs a Cloudflare sign-in, though no journey drafts notes.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "../../apps/worker/wrangler.jsonc" },
      remoteBindings: false,
      miniflare: {
        bindings: {
          CLUENORI_API_TOKEN: "journey-api-token",
          CLUENORI_OWNER: "0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53",
        },
      },
    }),
  ],
  // The alerts journey runs with push set up and a fake APNs (vitest.alerts.config.ts).
  // No on-disk module cache: with it, the Cloudflare plugin sends a test worker every cached module in
  // one message, which outgrows workerd's 32 MiB limit (PATTERNS.md, "Testing").
  test: {
    fsModuleCache: false,
    include: ["test/**/*.test.ts"],
    exclude: ["test/alerts-journey.test.ts"],
  },
})
