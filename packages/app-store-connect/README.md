# @bagatka/app-store-connect

Reads what a release tracker needs from the App Store Connect API: an app by its bundle ID, its
builds and their TestFlight states, and its App Store versions with the build each ships and its
phased release.

## Use it

```ts
import { AppStoreConnect } from "@bagatka/app-store-connect"
import { Effect, Option, Redacted } from "effect"

// In a host, where the platform's globals are known, on the HttpClient it provides:
const AppStoreConnectLive = AppStoreConnect.layer(
  { key: Redacted.make(p8Text), keyId: "2X9R4HXF34", issuerId: "57246542-96fe-1a63-e053-0824d011072a" },
  globalThis.crypto.subtle,
)

const program = Effect.gen(function* () {
  const appStoreConnect = yield* AppStoreConnect
  const app = yield* appStoreConnect.app("com.example.notes")
  if (Option.isNone(app)) {
    return [] // the key's team has no such app
  }
  const builds = yield* appStoreConnect.builds(app.value.id, 20)
  // [{ version: "2.4.0", buildNumber: "413", processingState: "VALID", internalTesting: "IN_BETA_TESTING", … }]
  const versions = yield* appStoreConnect.appStoreVersions(app.value.id, 5)
  // [{ version: "2.4.0", state: "READY_FOR_DISTRIBUTION", buildNumber: "413",
  //    phasedRelease: { state: "ACTIVE", currentDay: 3, … }, … }]
  return versions
})
```

A key that is wrong or revoked, or whose role can't read the app, fails with
`AppStoreConnectRefused` (401 or 403): asking again won't help until the key changes. No answer in
15 seconds, too many requests (429), or a server error fail with `AppStoreConnectUnavailable`: ask
again later.

## Contract

`src/index.ts`. Callers build the layer with an API key and the platform's Web Crypto, find an app
by bundle ID, and read its latest builds and App Store versions as plain values, with Apple's states
as Apple names them.

## Does not own

What a state means for a release, and how often to ask: the caller decides. Writing anything to
App Store Connect: the client only reads.

## Depends on

`@bagatka/es256-jwt`, to sign its tokens; `effect`; and an `HttpClient` the host provides.

## Settings

The API key's `.p8` text (or the base64 inside it), its key ID, and its team's issuer ID, from App
Store Connect's Users and Access, Integrations. They differ per team.

## Decisions and constraints

- **One token for 15 minutes.** Apple takes a token for at most 20 minutes, so each is signed for
  20 and kept for 15, and none is sent about to expire. A token Apple refuses (401) is renewed once,
  and the request sent once more; a second refusal is `AppStoreConnectRefused`. A key that can't
  sign fails the same way, with status 0, sending nothing.
- **Related resources come in the same answer.** Builds are read with `include` of their prerelease
  version (the marketing version) and beta detail (TestFlight states), and versions with their build
  and phased release, so a list is one request, not one per item.
- **Builds are sorted by Apple, versions here.** Builds are asked for with `sort=-uploadedDate`.
  Apple documents no sort for an app's App Store versions, so every page of them is read (200 a
  page, at most 10 pages) and sorted by when each was made.
- **Answers decode through Schemas.** What the client needs is required, and anything else Apple
  sends is ignored. An answer without what it needs, a related resource named but not included, a
  page link outside the API, or an HTTP status other than 200, 401, 403, 429 and 5xx is a defect,
  with a message that says what was off.
- **The bundle ID is matched exactly.** Apple's `filter[bundleId]` isn't documented as exact, so
  only an app whose bundle ID equals the one asked for is returned.
- **Apple limits each key's requests per rolling hour** (3,500 in its documentation's example; its
  `X-Rate-Limit` header says how many remain), and answers 429 past it.
