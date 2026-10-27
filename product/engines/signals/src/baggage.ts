import { ComponentKey, FeatureKey, ReleaseVersion } from "@cluenori/foundation"
import { Effect, Schema } from "effect"
import type { HttpServerResponse } from "effect/http"
import { HttpServerRequest } from "effect/http"

import { featureAttribute } from "./feature-attribute.ts"

/**
 * The attribute a service's spans name the component a trace started in, as the Cluenori helpers
 * copy it from the app's baggage (concept/Foundation.md, "Calls keep their origin"):
 * `cluenori.origin.component=notes-ios`.
 */
export const originComponentAttribute = "cluenori.origin.component"

/** The release of that component: `cluenori.origin.release=2.4.0+312`. */
export const originReleaseAttribute = "cluenori.origin.release"

// Each entry Cluenori reads from baggage, and the rule its value keeps; others are left alone.
const entries = [
  [featureAttribute, Schema.is(FeatureKey)],
  [originComponentAttribute, Schema.is(ComponentKey)],
  [originReleaseAttribute, Schema.is(ReleaseVersion)],
] as const

// A header is read this far at most, and this many entries of it: W3C's own limits.
const maxBaggageBytes = 8192
const maxEntries = 180

/**
 * Cluenori's entries of a W3C `baggage` header (`cluenori.feature=cards.flip,...`), each whose value
 * keeps its key's rule; the rest of it, other entries and their properties, is ignored. A value is
 * read as sent, without percent-decoding: Cluenori's never need it, and one that holds `%` keeps no rule.
 */
export const cluenoriBaggage = (header: string | undefined): ReadonlyArray<readonly [string, string]> => {
  if (header === undefined) {
    return []
  }
  const found = new Map<string, string>()
  for (const member of header.slice(0, maxBaggageBytes).split(",").slice(0, maxEntries)) {
    const [pair = ""] = member.split(";")
    const separator = pair.indexOf("=")
    const key = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    const rule = entries.find(([name]) => name === key)?.[1]
    if (separator > 0 && rule !== undefined && rule(value)) {
      found.set(key, value)
    }
  }
  return [...found]
}

/**
 * The host's middleware for its API: copies the feature and the origin a request's baggage names to
 * its server span, and the feature to its logs, so its operations and logs belong to the feature
 * and the client that asked (`featureAttribute`, `originComponentAttribute`).
 */
export const fromBaggage = <E, R>(
  app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R | HttpServerRequest.HttpServerRequest>,
): Effect.Effect<HttpServerResponse.HttpServerResponse, E, R | HttpServerRequest.HttpServerRequest> =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const found = cluenoriBaggage(request.headers["baggage"])
    if (found.length === 0) {
      return yield* app
    }
    for (const [key, value] of found) {
      yield* Effect.annotateCurrentSpan(key, value)
    }
    const feature = found.find(([key]) => key === featureAttribute)?.[1]
    const handled = feature === undefined ? app : app.pipe(Effect.annotateLogs(featureAttribute, feature))
    return yield* handled
  })
