import type { Unauthorized } from "@cluenori/worker"
import { CluenoriApi, MemberAuthorization } from "@cluenori/worker"
import { Console, Effect, Layer, Redacted, Schema } from "effect"
import type { HttpClientError } from "effect/http"
import { FetchHttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient, HttpApiMiddleware } from "effect/http-api"

import type { ApiTarget } from "./api-settings.ts"

/** The command couldn't do what was asked; it has printed why. */
export class Refused extends Schema.TaggedError<Refused>()("Refused", {}) {}

/** Prints `message` for the person at the terminal and fails, so the command exits with code 1. */
export const refuse = (message: string) => Console.error(message).pipe(Effect.andThen(new Refused()))

/** The public API's typed client, sending `target`'s token. */
export const apiClient = (target: ApiTarget) =>
  HttpApiClient.make(CluenoriApi, { baseUrl: target.url }).pipe(
    Effect.provide(
      HttpApiMiddleware.layerClient(MemberAuthorization, ({ next, request }) =>
        next(HttpClientRequest.bearerToken(request, Redacted.value(target.token))),
      ).pipe(Layer.provideMerge(FetchHttpClient.layer)),
    ),
  )

/**
 * How to explain the failures every call can have, for `Effect.catchTags`: an unreachable
 * Cluenori, a refused token, or an answer the CLI doesn't understand, such as from a deployment
 * running another version.
 */
export const reachFailures = (target: ApiTarget) => ({
  HttpClientError: (error: HttpClientError.HttpClientError) =>
    error.reason._tag === "TransportError"
      ? refuse(
          target.local
            ? `Nothing answers at ${target.url}. Start Cluenori on this computer with ./run, in another terminal.`
            : `Couldn't reach ${target.url}. Check that it is deployed: ./setup.`,
        )
      : refuse(`${target.url} answered in a way this CLI doesn't expect: ${error.message}`),
  Unauthorized: (error: Unauthorized) => refuse(`${target.url} refused the API token: ${error.message}`),
  SchemaError: (error: Schema.SchemaError) =>
    refuse(`${target.url} answered in a way this CLI doesn't expect: ${error.message}`),
})
