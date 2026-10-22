import type { AppManifest } from "@cluenori/manifest"
import { AppBatch, CountryCode } from "@cluenori/signals"
import { DateTime, Duration, Effect, Option, Result, Schema } from "effect"
import type { HttpServerRequest } from "effect/http"
import { HttpServerRespondable, HttpServerResponse } from "effect/http"
import { HttpApiBuilder, HttpApiError } from "effect/http-api"

import { CluenoriIngestApi } from "./app-ingest-api.ts"
import { ManifestCache, manifestMaxAge } from "./manifest-cache.ts"
import { projectCalls } from "./project-calls.ts"
import { ProjectObjects } from "./project-objects.ts"
import { CurrentSdkComponent } from "./sdk-key-authorization.ts"

// A batch is at most 500 signals; 1 MB holds them with room to spare.
const maxBodyBytes = 1024 * 1024

const utf8 = new TextDecoder()

const tooLarge = () =>
  HttpServerResponse.text(`A batch may be at most ${maxBodyBytes} bytes; send fewer signals at once.\n`, {
    status: 413,
  })

const archiveDown = () =>
  HttpServerResponse.text("Cluenori can't keep batches right now; send this one again.\n", {
    status: 503,
    headers: { "retry-after": "30" },
  })

/**
 * The country a request came from, as Cloudflare places its address: absent when it can't (`XX`) or
 * the address is Tor's (`T1`), and outside Cloudflare, as under `./run` without one. The address
 * itself is never read.
 */
const countryOf = (request: HttpServerRequest.HttpServerRequest) => {
  const source = request.source
  const cf = source instanceof Request ? source.cf : undefined
  const country = cf !== undefined && "country" in cf ? cf.country : undefined
  return Schema.is(CountryCode)(country) && country !== "XX" ? Option.some(country) : Option.none()
}

/**
 * `POST /ingest/v1/app/batch`: reads the body itself, so one over 1 MB is refused (413) before it is
 * decoded, then has the project's object check the SDK key and record the batch, in one call. 401
 * for a key the project lacks or revoked, 429 past the limits, 503 when the batch can't be archived.
 */
export const AppIngestHandlers = HttpApiBuilder.group(CluenoriIngestApi, "appIngest", (handlers) =>
  handlers.handleRaw("sendBatch", ({ request }) =>
    Effect.gen(function* () {
      const sender = yield* CurrentSdkComponent
      // Refused before reading when the SDK says the size, and after reading when it doesn't.
      if (Number(request.headers["content-length"] ?? "0") > maxBodyBytes) {
        return tooLarge()
      }
      const body = yield* request.arrayBuffer.pipe(Effect.orDie)
      if (body.byteLength > maxBodyBytes) {
        return tooLarge()
      }
      const decoded = yield* Schema.decodeEffect(Schema.fromJsonString(AppBatch))(utf8.decode(body)).pipe(Effect.result)
      if (Result.isFailure(decoded)) {
        // The same 400 the API answers for any payload that isn't its Schema's.
        return yield* HttpServerRespondable.toResponse(
          new HttpApiError.HttpApiSchemaError({ kind: "Payload", cause: decoded.failure }),
        )
      }
      const country = countryOf(request)
      const objects = yield* ProjectObjects
      return yield* objects
        .call(sender.project, projectCalls.ingestAppBatch, {
          key: sender.key,
          batch: decoded.success,
          ...(Option.isSome(country) ? { country: country.value } : {}),
        })
        .pipe(Effect.catchTag("ArchiveUnavailable", () => Effect.succeed(archiveDown())))
    }),
  ),
)

/**
 * `GET /ingest/v1/app/manifest`: the manifest from the edge's cache, for its component, key, release,
 * environment and locale, with how much of its five minutes is left; or composed by the project's
 * object, which checks the key, and kept for five minutes. A policy change reaches every app within
 * five minutes. A key revoked meanwhile is still answered from the cache until its entry ends.
 */
export const AppManifestHandlers = HttpApiBuilder.group(CluenoriIngestApi, "appManifest", (handlers) =>
  handlers.handle("manifest", ({ query }) =>
    Effect.gen(function* () {
      const sender = yield* CurrentSdkComponent
      const cache = yield* ManifestCache
      const key = { project: sender.project, component: sender.component, key: sender.key, query }
      const current = yield* DateTime.now
      const now = DateTime.toEpochMillis(current)
      const maxAgeSeconds = Duration.toSeconds(manifestMaxAge)
      const cached = yield* cache.get(key)
      if (Option.isSome(cached)) {
        const left = maxAgeSeconds - Math.floor((now - cached.value.composedAt) / 1000)
        const answer: AppManifest = {
          versionPolicy: cached.value.versionPolicy,
          maxAgeSeconds: Math.min(maxAgeSeconds, Math.max(0, left)),
        }
        return answer
      }
      const objects = yield* ProjectObjects
      const versionPolicy = yield* objects.call(sender.project, projectCalls.appManifest, {
        key: sender.key,
        query,
      })
      yield* cache.put(key, versionPolicy, now)
      const answer: AppManifest = { versionPolicy, maxAgeSeconds }
      return answer
    }),
  ),
)
