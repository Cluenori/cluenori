import type { Cluenori } from "@cluenori/sdk"
import { browser, start } from "@cluenori/sdk"
import { ClientTelemetry } from "@cluenori/worker"
import { Effect, ManagedRuntime, Option, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientResponse } from "effect/http"

// Starting the dashboard's measuring, loaded after start (`telemetry.ts`). What the deployment said
// of its clients is kept in this browser with the build that asked, so a load starts measuring
// without waiting for the API; a new build asks first, as its release may be new, and a crash must
// be tied to the release it happened in.

const keptName = "cluenori.client-telemetry"
const Kept = Schema.fromJsonString(Schema.Struct({ build: Schema.String, telemetry: ClientTelemetry }))
// The build, by the address of this chunk, which changes with its contents.
const build = import.meta.url

let begun = false

// Starts the SDK once a load: from what was kept, or else from the answer.
const startWith = (telemetry: ClientTelemetry, hand: (cluenori: Cluenori) => void) => {
  if (begun || telemetry.dashboard === undefined || telemetry.release === undefined) {
    return
  }
  begun = true
  hand(
    start({
      key: telemetry.dashboard,
      environment: telemetry.environment,
      deployment: window.location.origin,
      release: telemetry.release,
      runtime: browser(),
    }),
  )
}

const measuring = (hand: (cluenori: Cluenori) => void) =>
  Effect.gen(function* () {
    const kept = Option.fromNullishOr(window.localStorage.getItem(keptName)).pipe(
      Option.flatMap(Schema.decodeOption(Kept)),
      Option.filter((each) => each.build === build),
    )
    if (Option.isSome(kept)) {
      startWith(kept.value.telemetry, hand)
    }
    const http = yield* HttpClient.HttpClient
    const telemetry = yield* http
      .get("/api/client-telemetry")
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(ClientTelemetry)),
      )
    const text = yield* Schema.encodeEffect(Kept)({ build, telemetry })
    window.localStorage.setItem(keptName, text)
    startWith(telemetry, hand)
  })

const runtime = ManagedRuntime.make(FetchHttpClient.layer)

/** Starts the SDK, once, handing it to `hand`, if the deployment measures the dashboard. */
export const started = (hand: (cluenori: Cluenori) => void) => {
  // Not answering is the deployment's own trouble, which its own monitoring reports; the
  // dashboard carries on unmeasured.
  runtime.runFork(measuring(hand).pipe(Effect.ignore))
}
