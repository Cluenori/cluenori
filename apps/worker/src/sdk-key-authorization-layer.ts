import { SdkKey, sdkKeyScope } from "@cluenori/projects"
import { SdkKeyRejected } from "@cluenori/signals"
import { Effect, Layer, Redacted, Schema } from "effect"

import { CurrentSdkComponent, SdkKeyAuthorization } from "./sdk-key-authorization.ts"

const malformed = new SdkKeyRejected({
  message: "Send the component's SDK key: Authorization: Bearer cluenori-sdk.<project>.<component>.<id>",
})

/**
 * Lets a call through with the component its SDK key names, as `CurrentSdkComponent`; a bearer that
 * isn't an SDK key fails with `SdkKeyRejected` (401) before anything is read. Whether the key is one
 * of the project's active keys, the project's object decides in the call the handler makes, as it
 * does for ingest keys: one request to the object, not two.
 */
export const sdkKeyAuthorizationLayer = Layer.succeed(
  SdkKeyAuthorization,
  SdkKeyAuthorization.of({
    bearer: (httpEffect, { credential }) =>
      Schema.decodeEffect(SdkKey)(Redacted.value(credential)).pipe(
        Effect.mapError(() => malformed),
        Effect.flatMap((key) => Effect.provideService(httpEffect, CurrentSdkComponent, { ...sdkKeyScope(key), key })),
      ),
  }),
)
