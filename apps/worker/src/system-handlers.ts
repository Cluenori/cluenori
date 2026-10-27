import { EnvironmentKey, ReleaseVersion } from "@cluenori/foundation"
import { SdkKey } from "@cluenori/projects"
import { Config, Effect, Layer, Option } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { Health } from "./health.ts"

// The deployment's own clients' settings, each absent until `./cluenori self-telemetry on` sets it.
const clientTelemetrySettings = Config.all({
  release: Config.option(Config.schema(ReleaseVersion, "CLUENORI_RELEASE")),
  environment: Config.schema(EnvironmentKey, "CLUENORI_ENVIRONMENT").pipe(
    Config.withDefault(EnvironmentKey.make("production")),
  ),
  dashboard: Config.option(Config.schema(SdkKey, "CLUENORI_DASHBOARD_SDK_KEY")),
  cli: Config.option(Config.schema(SdkKey, "CLUENORI_CLI_SDK_KEY")),
})

/** Serves the system group: the deployment's health, and its clients' settings, read once from the Worker's env. */
export const SystemHandlers = Layer.unwrap(
  Effect.gen(function* () {
    const settings = yield* clientTelemetrySettings.pipe(Effect.orDie)
    const health = yield* Health
    const answer = {
      environment: settings.environment,
      ...Option.match(settings.release, { onNone: () => ({}), onSome: (release) => ({ release }) }),
      ...Option.match(settings.dashboard, { onNone: () => ({}), onSome: (dashboard) => ({ dashboard }) }),
      ...Option.match(settings.cli, { onNone: () => ({}), onSome: (cli) => ({ cli }) }),
    }
    return HttpApiBuilder.group(CluenoriApi, "system", (handlers) =>
      handlers.handle("health", () => health.check).handle("clientTelemetry", () => Effect.succeed(answer)),
    )
  }),
)
