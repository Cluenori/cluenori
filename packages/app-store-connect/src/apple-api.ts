import type { Es256Signing } from "@bagatka/es256-jwt"
import { signEs256 } from "@bagatka/es256-jwt"
import type { Redacted } from "effect"
import { Clock, Duration, Effect, Option, Ref, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

import { AppStoreConnectRefused, AppStoreConnectUnavailable } from "./errors.ts"

// App Store Connect's API as every method asks it: with a token of the key's, each request
// answered within 15 seconds, and what each status Apple answers with means.

/**
 * An App Store Connect API key, from Users and Access, Integrations: its `.p8` file's text, or the
 * base64 inside it alone; its 10-character key ID; and the issuer ID of its team, a UUID.
 */
export interface AppStoreConnectCredentials {
  readonly key: Redacted.Redacted
  readonly keyId: string
  readonly issuerId: string
}

/** The query of a request, such as `{ "filter[app]": "1574205213", limit: 200 }`. */
export type UrlParams = Readonly<Record<string, string | number>>

/** App Store Connect's API, asked with one key's tokens. Paths are under `https://api.appstoreconnect.apple.com`, their IDs already encoded. */
export interface AppleApi {
  /** The text of Apple's answer to `GET path`. */
  readonly get: (
    path: string,
    urlParams: UrlParams,
  ) => Effect.Effect<string, AppStoreConnectRefused | AppStoreConnectUnavailable>
  /**
   * The text of each page of `GET path`, from the first to the last its `links.next` names: one
   * request per page, at most 10. `what` names the answer in a defect.
   */
  readonly pages: (
    path: string,
    urlParams: UrlParams,
    what: string,
  ) => Effect.Effect<ReadonlyArray<string>, AppStoreConnectRefused | AppStoreConnectUnavailable>
  /** Sends a write, with `body` as JSON, and the text of Apple's answer: empty for a 204. */
  readonly send: (
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body?: Schema.JsonObject,
  ) => Effect.Effect<string, AppStoreConnectRefused | AppStoreConnectUnavailable>
}

const api = "https://api.appstoreconnect.apple.com"

// Apple takes a token for at most 20 minutes; one is kept for 15, so none is sent about to expire.
const tokenLasts = Duration.toSeconds(Duration.minutes(20))
const tokenKept = Duration.toMillis(Duration.minutes(15))

const answerWithin = Duration.seconds(15)

/** The most resources Apple sends in one page. */
export const pageSize = 200

// App Store versions come in no documented order, so all of an app's are read; 10 pages hold
// 2,000, more than an app releasing every week makes in 30 years.
const mostPages = 10

const ErrorText = Schema.fromJsonString(
  Schema.Struct({ errors: Schema.NonEmptyArray(Schema.Struct({ code: Schema.String, detail: Schema.String })) }),
)

const PageLinks = Schema.Struct({ links: Schema.Struct({ next: Schema.optionalKey(Schema.String) }) })

/**
 * App Store Connect's API with `credentials`, signing with `signing`, on the host's `HttpClient`.
 * It signs a token and reuses it for 15 minutes; a token Apple refuses (401) is renewed once, and
 * the request sent once more.
 */
export const appleApi = Effect.fn("AppStoreConnect.api")(function* (
  credentials: AppStoreConnectCredentials,
  signing: Es256Signing,
) {
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
          Effect.fail(new AppStoreConnectUnavailable({ reason: "App Store Connect didn't answer in 15 seconds" })),
        HttpClientError: () =>
          Effect.fail(new AppStoreConnectUnavailable({ reason: "App Store Connect couldn't be reached" })),
      }),
    )
  })

  // The text of Apple's answer to `request`; a token it refuses is renewed once. A 401 means Apple
  // took nothing, so sending a write again is safe.
  const exchange = Effect.fn("AppStoreConnect.exchange")(function* (request: HttpClientRequest.HttpClientRequest) {
    const first = yield* ask(request, false)
    if (first.status !== 401) {
      return yield* textOf(request, first)
    }
    const renewed = yield* ask(request, true)
    return yield* textOf(request, renewed)
  })

  const get = Effect.fn("AppStoreConnect.get")(function* (path: string, urlParams: UrlParams) {
    const request = HttpClientRequest.get(`${api}${path}`, { urlParams, acceptJson: true })
    return yield* exchange(request)
  })

  // The text of the page `request` asks for and of the pages after it.
  const pagesFrom: (
    request: HttpClientRequest.HttpClientRequest,
    what: string,
    pagesBefore: number,
  ) => Effect.Effect<ReadonlyArray<string>, AppStoreConnectRefused | AppStoreConnectUnavailable> = Effect.fn(
    "AppStoreConnect.pagesFrom",
  )(function* (request: HttpClientRequest.HttpClientRequest, what: string, pagesBefore: number) {
    // Not handled: a listing of more than 2,000 resources, such as an app with that many App Store
    // versions; it dies here. Reading it would take more pages, each a subrequest of the Worker's.
    if (pagesBefore === mostPages) {
      return yield* Effect.die(`App Store Connect has more than ${mostPages * pageSize} ${what}`)
    }
    const text = yield* exchange(request)
    const page = yield* decoded(PageLinks, text, what)
    const next = page.links.next
    if (next === undefined) {
      return [text]
    }
    // The token goes only to Apple's API, whatever a link says.
    if (!next.startsWith(`${api}/`)) {
      return yield* Effect.die(`App Store Connect's next page is outside its API: ${next}`)
    }
    const nextRequest = HttpClientRequest.get(next, { acceptJson: true })
    const rest = yield* pagesFrom(nextRequest, what, pagesBefore + 1)
    return [text, ...rest]
  })

  const pages = Effect.fn("AppStoreConnect.pages")(function* (path: string, urlParams: UrlParams, what: string) {
    const request = HttpClientRequest.get(`${api}${path}`, { urlParams, acceptJson: true })
    return yield* pagesFrom(request, what, 0)
  })

  const send = Effect.fn("AppStoreConnect.send")(function* (
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body?: Schema.JsonObject,
  ) {
    const bare = HttpClientRequest.make(method)(`${api}${path}`, { acceptJson: true })
    const request = yield* withBody(bare, body)
    return yield* exchange(request)
  })

  const apple: AppleApi = { get, pages, send }
  return apple
})

/**
 * `text`, an answer of Apple's, decoded with `document`. An answer this client can't read is a
 * defect that says what differs: Apple changed, or this client is wrong.
 */
export const decoded = <S extends Schema.Decoder<unknown>>(document: S, text: string, what: string) =>
  Schema.decodeEffect(Schema.fromJsonString(document))(text).pipe(
    Effect.catchTag("SchemaError", (error) =>
      Effect.die(`App Store Connect's answer of ${what} isn't in the shape this client reads: ${error.message}`),
    ),
  )

const withBody = (request: HttpClientRequest.HttpClientRequest, body: Schema.JsonObject | undefined) =>
  body === undefined ? Effect.succeed(request) : HttpClientRequest.bodyJson(request, body).pipe(Effect.orDie)

// Apple's answer, if it succeeded; refusals and outages become the errors callers act on. A 409 is
// Apple's "the data conflicts with its rules" (ENTITY_ERROR, STATE_ERROR); a 400 or 422 is a request
// in a shape Apple doesn't take, this client's bug.
const textOf = Effect.fnUntraced(function* (
  request: HttpClientRequest.HttpClientRequest,
  answer: { readonly status: number; readonly text: string },
) {
  if (answer.status === 200 || answer.status === 201 || answer.status === 204) {
    return answer.text
  }
  const reason = yield* Schema.decodeEffect(ErrorText)(answer.text).pipe(
    Effect.map((body) => body.errors.map((error) => `${error.code}: ${error.detail}`).join("; ")),
    Effect.orElseSucceed(() => `HTTP ${answer.status}`),
  )
  if (answer.status === 401 || answer.status === 403 || answer.status === 409) {
    return yield* new AppStoreConnectRefused({ status: answer.status, reason })
  }
  if (answer.status === 429 || answer.status >= 500) {
    return yield* new AppStoreConnectUnavailable({ reason })
  }
  // Not handled: other statuses, such as 404 for an app or version the team no longer has, or 400
  // for a request Apple won't take; they die with Apple's reason. Telling a removed resource apart
  // would take an error of its own in the contract.
  const path = request.url.startsWith(api) ? request.url.slice(api.length) : request.url
  return yield* Effect.die(`App Store Connect answered ${request.method} ${path} with HTTP ${answer.status}: ${reason}`)
})
