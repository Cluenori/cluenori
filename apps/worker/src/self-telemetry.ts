import { EnvironmentKey, ReleaseVersion } from "@cluenori/foundation"
import { IngestKey, ingestKeyScope } from "@cluenori/projects"
import { SelfTelemetry } from "@cluenori/signals"
import { BrowserCrypto } from "@effect/platform-browser"
import { exports } from "cloudflare:workers"
import { Config, ConfigProvider, Crypto, Effect, Layer, Option, Redacted, Schema } from "effect"

// The deployment reports itself to itself, as a component of a project of its own, when it is given
// that component's ingest key (`./cluenori self-telemetry on` gives it). Its exports go through the
// Worker's own entry, as anyone's would, never the network, with the self mark.

/** Where the deployment's own telemetry goes, and as which release (PATTERNS.md, "Configuration"). */
const selfTelemetrySettings = Config.all({
  // The component's ingest key: `cluenori.<project>.<component>.<secret>`, a Worker secret.
  ingestKey: Config.option(Config.Redacted("CLUENORI_SELF_INGEST_KEY")),
  // The release `./update` deployed, `0.4.0+12`; absent for a deploy that didn't say.
  release: Config.option(Config.schema(ReleaseVersion, "CLUENORI_RELEASE")),
  environment: Config.schema(EnvironmentKey, "CLUENORI_ENVIRONMENT").pipe(
    Config.withDefault(EnvironmentKey.make("production")),
  ),
})

// One export, through the Worker's default entry, as a request from the internet would come; the
// address is any, since it never leaves the Worker.
const sendToSelf = (path: string, body: Uint8Array, headers: Readonly<Record<string, string>>): Effect.Effect<number> =>
  Effect.promise((): Promise<Response> =>
    exports.default.fetch(new Request(`https://self.cluenori${path}`, { method: "POST", headers, body })),
  ).pipe(Effect.map((response) => response.status))

/**
 * The deployment's own telemetry, in whatever the Worker's env sets: on with an ingest key, else off.
 * Built once per runtime that provides it; the Worker's runtimes share one by a memo map.
 */
export const selfTelemetryLayer = (env: Env): Layer.Layer<SelfTelemetry> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const settings = yield* selfTelemetrySettings
      if (Option.isNone(settings.ingestKey)) {
        return SelfTelemetry.layerOff
      }
      const ingestKey = Redacted.value(settings.ingestKey.value)
      if (!Schema.is(IngestKey)(ingestKey)) {
        return yield* Effect.die(
          "CLUENORI_SELF_INGEST_KEY isn't an ingest key: cluenori.<project>.<component>.<secret>",
        )
      }
      const crypto = yield* Crypto.Crypto
      const instance = yield* crypto.randomUUIDv7().pipe(Effect.orDie)
      return SelfTelemetry.layer({
        ingestKey: settings.ingestKey.value,
        component: ingestKeyScope(ingestKey).component,
        release: Option.getOrUndefined(settings.release),
        environment: settings.environment,
        instance,
        send: sendToSelf,
      })
    }),
  ).pipe(
    Layer.provide(BrowserCrypto.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
    Layer.orDie,
  )
