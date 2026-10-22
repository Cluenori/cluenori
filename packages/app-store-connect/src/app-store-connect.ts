import type { Es256Signing } from "@bagatka/es256-jwt"
import { signEs256 } from "@bagatka/es256-jwt"
import type { Redacted } from "effect"
import { Array as Arr, Clock, Context, DateTime, Duration, Effect, Layer, Option, Order, Ref, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

import type { App, AppStoreVersion, Build } from "./resources.ts"
import {
  AppStoreVersionsDocument,
  AppsDocument,
  BuildsDocument,
  appOf,
  appStoreVersionsOf,
  buildsOf,
} from "./resources.ts"

/**
 * An App Store Connect API key, from Users and Access, Integrations: its `.p8` file's text, or the
 * base64 inside it alone; its 10-character key ID; and the issuer ID of its team, a UUID.
 */
export interface AppStoreConnectCredentials {
  readonly key: Redacted.Redacted
  readonly keyId: string
  readonly issuerId: string
}

/**
 * App Store Connect refused the request: 401 or 403, for a key that is wrong or revoked, or whose
 * role can't read this; or 0, with nothing sent, for a key that can't sign. `reason` is Apple's
 * error code and detail. Sending again won't help until the key changes.
 */
export class AppStoreConnectRefused extends Schema.TaggedError<AppStoreConnectRefused>()("AppStoreConnectRefused", {
  status: Schema.Int,
  reason: Schema.String,
}) {}

/**
 * App Store Connect didn't answer now: nothing within 15 seconds, too many requests (429, the
 * key's hourly limit), or a server error. Asking again later may work.
 */
export class AppStoreConnectUnavailable extends Schema.TaggedError<AppStoreConnectUnavailable>()(
  "AppStoreConnectUnavailable",
  { reason: Schema.String },
) {}

const api = "https://api.appstoreconnect.apple.com"

// Apple takes a token for at most 20 minutes; one is kept for 15, so none is sent about to expire.
const tokenLasts = Duration.toSeconds(Duration.minutes(20))
const tokenKept = Duration.toMillis(Duration.minutes(15))

const answerWithin = Duration.seconds(15)

// Apple pages at most 200 resources. App Store versions come in no documented order, so all of an
// app's are read; 10 pages hold 2,000, more than an app releasing every week makes in 30 years.
const pageSize = 200
const mostPages = 10

const ErrorText = Schema.fromJsonString(
  Schema.Struct({ errors: Schema.NonEmptyArray(Schema.Struct({ code: Schema.String, detail: Schema.String })) }),
)

const AppsText = Schema.fromJsonString(AppsDocument)
const BuildsText = Schema.fromJsonString(BuildsDocument)
const AppStoreVersionsText = Schema.fromJsonString(AppStoreVersionsDocument)

const latestCreatedFirst = Order.flip(Order.mapInput(DateTime.Order, (version: AppStoreVersion) => version.createdAt))

/** Reads an app's builds and App Store versions from the App Store Connect API, with an API key. */
export class AppStoreConnect extends Context.Service<
  AppStoreConnect,
  {
    /**
     * The app with this bundle ID among those the key's team has; none when it has none. One
     * request.
     */
    readonly app: (
      bundleId: string,
    ) => Effect.Effect<Option.Option<App>, AppStoreConnectRefused | AppStoreConnectUnavailable>
    /**
     * The app's builds, the latest uploaded first, at most `limit` (1 to 200), each with its
     * marketing version and TestFlight states. One request.
     */
    readonly builds: (
      appId: string,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<Build>, AppStoreConnectRefused | AppStoreConnectUnavailable>
    /**
     * The app's App Store versions, the latest created first, at most `limit` (1 to 200), each
     * with the build it ships and its phased release. Apple lists them in no documented order, so
     * every version is read and sorted: one request per 200 versions the app has.
     */
    readonly appStoreVersions: (
      appId: string,
      limit: number,
    ) => Effect.Effect<ReadonlyArray<AppStoreVersion>, AppStoreConnectRefused | AppStoreConnectUnavailable>
  }
>()("@bagatka/app-store-connect/app-store-connect/AppStoreConnect") {
  /**
   * App Store Connect with `credentials`, signing with `signing`, on the `HttpClient` the host
   * provides. It signs a token and reuses it for 15 minutes; a token Apple refuses (401) is
   * renewed once, and the request sent once more. Every request has 15 seconds to be answered.
   * An answer in a shape this client doesn't know, or an HTTP status other than 200, 401, 403,
   * 429 and 5xx, is a defect.
   */
  static readonly layer = (credentials: AppStoreConnectCredentials, signing: Es256Signing) =>
    Layer.effect(
      AppStoreConnect,
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient
        const signed = yield* Ref.make(Option.none<{ readonly token: string; readonly at: number }>())

        const token = Effect.fn("AppStoreConnect.token")(function* (renew: boolean) {
          const now = yield* Clock.currentTimeMillis
          const kept = yield* Ref.get(signed)
          if (!renew && Option.isSome(kept) && now - kept.value.at < tokenKept) {
            return kept.value.token
          }
          const issuedAt = Math.floor(now / 1000)
          const fresh = yield* signEs256(
            signing,
            credentials.key,
            { kid: credentials.keyId, typ: "JWT" },
            { iss: credentials.issuerId, iat: issuedAt, exp: issuedAt + tokenLasts, aud: "appstoreconnect-v1" },
          ).pipe(Effect.mapError(() => new AppStoreConnectRefused({ status: 0, reason: "InvalidSigningKey" })))
          yield* Ref.set(signed, Option.some({ token: fresh, at: now }))
          return fresh
        })

        // One request with a token, and Apple's whole answer to it.
        const ask = Effect.fn("AppStoreConnect.ask")(function* (
          request: HttpClientRequest.HttpClientRequest,
          renew: boolean,
        ) {
          const bearer = yield* token(renew)
          const authorized = HttpClientRequest.bearerToken(request, bearer)
          return yield* client.execute(authorized).pipe(
            Effect.flatMap((response) => Effect.map(response.text, (text) => ({ status: response.status, text }))),
            Effect.timeout(answerWithin),
            Effect.catchTags({
              TimeoutError: () =>
                Effect.fail(
                  new AppStoreConnectUnavailable({ reason: "App Store Connect didn't answer in 15 seconds" }),
                ),
              HttpClientError: () =>
                Effect.fail(new AppStoreConnectUnavailable({ reason: "App Store Connect couldn't be reached" })),
            }),
          )
        })

        // The text of Apple's answer to `request`; a token it refuses is renewed once.
        const read = Effect.fn("AppStoreConnect.read")(function* (request: HttpClientRequest.HttpClientRequest) {
          const first = yield* ask(request, false)
          if (first.status !== 401) {
            return yield* textOf(first)
          }
          const renewed = yield* ask(request, true)
          return yield* textOf(renewed)
        })

        const app = Effect.fn("AppStoreConnect.app")(function* (bundleId: string) {
          const request = HttpClientRequest.get(`${api}/v1/apps`, {
            urlParams: { "filter[bundleId]": bundleId, limit: pageSize },
            acceptJson: true,
          })
          const text = yield* read(request)
          const document = yield* Schema.decodeEffect(AppsText)(text).pipe(
            Effect.catchTag("SchemaError", unknownShape("apps")),
          )
          return appOf(document, bundleId)
        })

        const builds = Effect.fn("AppStoreConnect.builds")(function* (appId: string, limit: number) {
          yield* checkLimit(limit)
          const request = HttpClientRequest.get(`${api}/v1/builds`, {
            urlParams: {
              "filter[app]": appId,
              sort: "-uploadedDate",
              include: "preReleaseVersion,buildBetaDetail",
              limit,
            },
            acceptJson: true,
          })
          const text = yield* read(request)
          const document = yield* Schema.decodeEffect(BuildsText)(text).pipe(
            Effect.catchTag("SchemaError", unknownShape("builds")),
          )
          return yield* buildsOf(document)
        })

        // Every App Store version on the page `request` asks for and on the pages after it.
        const versionsFrom: (
          request: HttpClientRequest.HttpClientRequest,
          pagesBefore: number,
        ) => Effect.Effect<ReadonlyArray<AppStoreVersion>, AppStoreConnectRefused | AppStoreConnectUnavailable> =
          Effect.fn("AppStoreConnect.versionsFrom")(function* (
            request: HttpClientRequest.HttpClientRequest,
            pagesBefore: number,
          ) {
            // Not handled: an app with more than 2,000 App Store versions; it dies here. Reading it
            // would take more pages, each a subrequest of the Worker's.
            if (pagesBefore === mostPages) {
              return yield* Effect.die(`An app has more than ${mostPages * pageSize} App Store versions`)
            }
            const text = yield* read(request)
            const document = yield* Schema.decodeEffect(AppStoreVersionsText)(text).pipe(
              Effect.catchTag("SchemaError", unknownShape("App Store versions")),
            )
            const versions = yield* appStoreVersionsOf(document)
            const next = document.links.next
            if (next === undefined) {
              return versions
            }
            // The token goes only to Apple's API, whatever a link says.
            if (!next.startsWith(`${api}/`)) {
              return yield* Effect.die(`App Store Connect's next page is outside its API: ${next}`)
            }
            const nextRequest = HttpClientRequest.get(next, { acceptJson: true })
            const rest = yield* versionsFrom(nextRequest, pagesBefore + 1)
            return [...versions, ...rest]
          })

        const appStoreVersions = Effect.fn("AppStoreConnect.appStoreVersions")(function* (
          appId: string,
          limit: number,
        ) {
          yield* checkLimit(limit)
          const request = HttpClientRequest.get(`${api}/v1/apps/${encodeURIComponent(appId)}/appStoreVersions`, {
            urlParams: { include: "build,appStoreVersionPhasedRelease", limit: pageSize },
            acceptJson: true,
          })
          const all = yield* versionsFrom(request, 0)
          return Arr.take(Arr.sort(all, latestCreatedFirst), limit)
        })

        return AppStoreConnect.of({ app, builds, appStoreVersions })
      }),
    )
}

// Apple's answer, if it is a document to read; refusals and outages become the errors callers act on.
const textOf = Effect.fnUntraced(function* (answer: { readonly status: number; readonly text: string }) {
  if (answer.status === 200) {
    return answer.text
  }
  const reason = yield* Schema.decodeEffect(ErrorText)(answer.text).pipe(
    Effect.map((body) => `${body.errors[0].code}: ${body.errors[0].detail}`),
    Effect.orElseSucceed(() => `HTTP ${answer.status}`),
  )
  if (answer.status === 401 || answer.status === 403) {
    return yield* new AppStoreConnectRefused({ status: answer.status, reason })
  }
  if (answer.status === 429 || answer.status >= 500) {
    return yield* new AppStoreConnectUnavailable({ reason })
  }
  // Not handled: other statuses, such as 404 for an app the team no longer has, or 400 for a
  // request Apple won't take; they die with Apple's reason. Telling a removed app apart would take
  // an error of its own in the contract.
  return yield* Effect.die(`App Store Connect answered HTTP ${answer.status}: ${reason}`)
})

// A limit the contract doesn't allow is the caller's bug.
const checkLimit = (limit: number) => {
  const allowed = Number.isInteger(limit) && limit >= 1 && limit <= pageSize
  return allowed ? Effect.void : Effect.die(`A limit is 1 to ${pageSize} items, not ${limit}`)
}

// An answer this client can't read is a defect: Apple changed, or this client is wrong.
const unknownShape = (what: string) => (error: Schema.SchemaError) =>
  Effect.die(`App Store Connect's answer of ${what} isn't in the shape this client reads: ${error.message}`)
