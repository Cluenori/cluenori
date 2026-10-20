import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { defineConfig } from "vitest/config"

// Runs the journeys inside workerd, next to the Worker that wrangler.jsonc describes, with local
// storage of its own and the API settings `./setup` makes for a deployment.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "../../apps/worker/wrangler.jsonc" },
      miniflare: {
        bindings: {
          CLUENORI_API_TOKEN: "journey-api-token",
          CLUENORI_OWNER: "0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53",
        },
      },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
})
