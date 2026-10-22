import type { ComponentKey, ProjectKey } from "@cluenori/foundation"
import type { ManifestQuery } from "@cluenori/manifest"
import { VersionPolicy } from "@cluenori/manifest"
import type { SdkKey } from "@cluenori/projects"
import { Context, Duration, Effect, Layer, Option, Schema } from "effect"

/** How long a manifest is kept at the edge, and an SDK uses one: a policy change reaches apps within it. */
export const manifestMaxAge = Duration.minutes(5)

// When a cached manifest was composed, in Unix ms, so an answer from the cache says how much of its
// time is left.
const composedAtHeader = "x-cluenori-composed-at"

const PolicyJson = Schema.fromJsonString(VersionPolicy)

/** One cached manifest's version policy, and when it was composed (Unix ms). */
export interface CachedManifest {
  readonly versionPolicy: VersionPolicy
  readonly composedAt: number
}

/** What a cached manifest is for: the SDK key's project and component, the key, and the query. */
export interface ManifestKey {
  readonly project: ProjectKey
  readonly component: ComponentKey
  readonly key: SdkKey
  readonly query: ManifestQuery
}

/**
 * Where an address names it in the cache: its project, component and key, then its environment,
 * release and locale. The key is in it, so only a key the project's object accepted ever finds an
 * answer, and two components never share one. The host is never reached; it only names the entry.
 */
export const manifestCacheUrl = (manifest: ManifestKey) => {
  const url = new URL(
    `https://manifest.cluenori.invalid/${manifest.project}/${manifest.component}/${encodeURIComponent(manifest.key)}`,
  )
  url.searchParams.set("environment", manifest.query.environment)
  url.searchParams.set("release", manifest.query.release)
  url.searchParams.set("locale", manifest.query.locale ?? "")
  return url.toString()
}

/**
 * The manifests kept at the edge, in this data center's cache, for `manifestMaxAge`. Where the cache
 * keeps nothing, nothing is found and every manifest is composed again.
 */
export class ManifestCache extends Context.Service<
  ManifestCache,
  {
    /** The manifest cached for `manifest`, when there is one still fresh. A cache that fails finds none, and says so in the log. */
    readonly get: (manifest: ManifestKey) => Effect.Effect<Option.Option<CachedManifest>>
    /** Keeps `versionPolicy` for `manifest`, composed at `composedAt` (Unix ms). A cache that fails keeps nothing, and says so in the log. */
    readonly put: (manifest: ManifestKey, versionPolicy: VersionPolicy, composedAt: number) => Effect.Effect<void>
  }
>()("@cluenori/worker/manifest-cache/ManifestCache") {
  /** The cache of the data center that answers. */
  static readonly layer = Layer.sync(ManifestCache, () => {
    const cache = caches.default
    const encode = Schema.encodeEffect(PolicyJson)
    const decode = Schema.decodeEffect(PolicyJson)
    return ManifestCache.of({
      get: Effect.fn("ManifestCache.get")(
        function* (manifest: ManifestKey) {
          const found = yield* Effect.tryPromise(() => cache.match(manifestCacheUrl(manifest)))
          if (found === undefined) {
            return Option.none()
          }
          const composedAt = Number(found.headers.get(composedAtHeader) ?? "")
          const text = yield* Effect.tryPromise(() => found.text())
          const versionPolicy = yield* decode(text)
          return Number.isFinite(composedAt) ? Option.some({ versionPolicy, composedAt }) : Option.none()
        },
        (effect) =>
          effect.pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("The edge cache couldn't be read; composing the manifest again", cause).pipe(
                Effect.as(Option.none<CachedManifest>()),
              ),
            ),
          ),
      ),
      put: Effect.fn("ManifestCache.put")(
        function* (manifest: ManifestKey, versionPolicy: VersionPolicy, composedAt: number) {
          const text = yield* encode(versionPolicy)
          const response = new Response(text, {
            headers: {
              "content-type": "application/json",
              "cache-control": `max-age=${Duration.toSeconds(manifestMaxAge)}`,
              [composedAtHeader]: `${composedAt}`,
            },
          })
          yield* Effect.tryPromise(() => cache.put(manifestCacheUrl(manifest), response))
        },
        (effect) =>
          effect.pipe(
            Effect.catchCause((cause) => Effect.logWarning("The edge cache couldn't keep a manifest", cause)),
          ),
      ),
    })
  })
}
