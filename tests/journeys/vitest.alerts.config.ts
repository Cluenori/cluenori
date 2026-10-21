import { cloudflareTest } from "@cloudflare/vitest-plugin"
import { Effect } from "effect"
import { Base64 } from "effect/encoding"
import { defineConfig } from "vitest/config"

// A token-signing key of the journey's own, made each run, so pushes are signed as with Apple's.
const apnsKey = Effect.gen(function* () {
  const pair = yield* Effect.promise(() =>
    crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]),
  )
  if (!("privateKey" in pair)) {
    return yield* Effect.die("Web Crypto made one key, not a pair")
  }
  const der = yield* Effect.promise(() => crypto.subtle.exportKey("pkcs8", pair.privateKey))
  if (!(der instanceof ArrayBuffer)) {
    return yield* Effect.die("Web Crypto exported no PKCS #8 bytes")
  }
  return `-----BEGIN PRIVATE KEY-----\n${Base64.encode(new Uint8Array(der))}\n-----END PRIVATE KEY-----\n`
})

// The pushes the journey's fake APNs took. The Worker reaches nothing else on the internet here,
// so this journey adds no monitors; the others run without the fake (vitest.config.ts).
const pushes: Array<{ readonly host: string; readonly path: string; readonly payload: unknown }> = []
const apnsHosts = new Set(["api.sandbox.push.apple.com", "api.push.apple.com"])

const fakeApns = (request: Request) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const url = new URL(request.url)
      if (!apnsHosts.has(url.hostname)) {
        return new Response(`The alerts journey reaches only APNs, not ${url.hostname}.`, { status: 502 })
      }
      const payload: unknown = yield* Effect.promise(() => request.json())
      pushes.push({ host: url.hostname, path: url.pathname, payload })
      return new Response(null, { status: 200, headers: { "apns-id": "4f0e5d2c-8b1a-4c3e-9d7f-1a2b3c4d5e6f" } })
    }),
  )

// Runs the alerts journey inside workerd, next to the Worker that wrangler.jsonc describes, with
// local storage of its own, the API settings `./setup` makes for a deployment, and push set up.
export default defineConfig(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      const key = yield* apnsKey
      return {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "../../apps/worker/wrangler.jsonc" },
            miniflare: {
              bindings: {
                CLUENORI_API_TOKEN: "journey-api-token",
                CLUENORI_OWNER: "0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53",
                CLUENORI_APNS_KEY: key,
                CLUENORI_APNS_KEY_ID: "JOURNEYKEY",
                CLUENORI_APNS_TEAM_ID: "JOURNEYTEA",
                CLUENORI_APNS_TOPIC: "com.example.cluenori",
              },
              outboundService: fakeApns,
              // What the fake APNs took, for the journey to read (test/alerts-journey.test.ts).
              serviceBindings: { APNS_PUSHES: () => Response.json(pushes) },
            },
          }),
        ],
        // No on-disk module cache: with it, the Cloudflare plugin sends a test worker every cached module in
        // one message, which outgrows workerd's 32 MiB limit (PATTERNS.md, "Testing").
        test: {
          fsModuleCache: false,
          name: "@cluenori/journeys: alerts",
          include: ["test/alerts-journey.test.ts"],
        },
      }
    }),
  ),
)
