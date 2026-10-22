import type { Es256Signing } from "@cluenori/es256-jwt"
import { Array as Arr, Context, DateTime, Effect, Layer, Order } from "effect"
import type { Option } from "effect"
import type { HttpClient } from "effect/http"

import type { AppStoreConnectCredentials } from "./apple-api.ts"
import { appleApi, decoded, pageSize } from "./apple-api.ts"
import type { AppStoreConnectRefused, AppStoreConnectUnavailable } from "./errors.ts"
import { publishing } from "./publishing.ts"
import type {
  App,
  AppStoreVersion,
  Build,
  LocalizedText,
  PreparedVersion,
  ReviewSubmission,
  VersionToSubmit,
} from "./resources.ts"
import {
  AppInfosDocument,
  AppStoreVersionsDocument,
  AppsDocument,
  BuildsDocument,
  appLocalesOf,
  appOf,
  appStoreVersionsOf,
  buildsOf,
} from "./resources.ts"

const latestCreatedFirst = Order.flip(Order.mapInput(DateTime.Order, (version: AppStoreVersion) => version.createdAt))

type Failure = AppStoreConnectRefused | AppStoreConnectUnavailable

/**
 * An app's builds, App Store versions, and review submissions in App Store Connect, through its API
 * with one key. Reading takes a key with the Developer role; writing, `prepareVersion` to
 * `setWhatToTest`, takes App Manager (or Admin). The writes are for the app's iOS platform.
 */
export class AppStoreConnect extends Context.Service<
  AppStoreConnect,
  {
    /**
     * The app with this bundle ID among those the key's team has; none when it has none. One
     * request.
     */
    readonly app: (bundleId: string) => Effect.Effect<Option.Option<App>, Failure>
    /**
     * The app's builds, the latest uploaded first, at most `limit` (1 to 200), each with its
     * marketing version and TestFlight states. One request.
     */
    readonly builds: (appId: string, limit: number) => Effect.Effect<ReadonlyArray<Build>, Failure>
    /**
     * The app's iOS build with this marketing version and build number; none until App Store
     * Connect has it. Its `processingState` is `PROCESSING` until Apple has processed it, and
     * `VALID` once a version can ship it: for waiting until an uploaded build can be attached. One
     * request.
     */
    readonly build: (
      appId: string,
      version: string,
      buildNumber: string,
    ) => Effect.Effect<Option.Option<Build>, Failure>
    /**
     * The app's App Store versions, the latest created first, at most `limit` (1 to 200), each
     * with the build it ships and its phased release. Apple lists them in no documented order, so
     * every version is read and sorted: one request per 200 versions the app has.
     */
    readonly appStoreVersions: (appId: string, limit: number) => Effect.Effect<ReadonlyArray<AppStoreVersion>, Failure>
    /**
     * The locales the app's App Store information is in, such as `["en-US", "de-DE"]`: its
     * primary locale first, then the others in code-point order. While a version is being
     * prepared, the locales it will be released in. Apple takes a version for review only when it
     * is localized in exactly these, so they are the locales to write its What's New in. One
     * request.
     */
    readonly appLocales: (appId: string) => Effect.Effect<ReadonlyArray<string>, Failure>
    /**
     * Makes the app's editable iOS App Store version ready to submit for review, and says which
     * it is. The editable version is the one being prepared, or one rejected or removed from
     * review (`PREPARE_FOR_SUBMISSION`, `READY_FOR_REVIEW`, `INVALID_BINARY`, `REJECTED`,
     * `METADATA_REJECTED`, `DEVELOPER_REJECTED`); Apple allows one, and one is made when the app
     * has none. Then, in order: its version string and release type become the request's; the
     * build is attached; its phased release is made or cancelled; and its What's New is written in
     * each locale, a locale it lacks being added with What's New alone (Apple then takes it for
     * review only once the app's information and the version's description are in that locale
     * too).
     *
     * Each step reads first and writes only what differs, so calling again after a refusal or an
     * outage part-way finishes what was left and repeats nothing. An app's first version, when it
     * has no other, has neither What's New nor a phased release on the App Store: both are left
     * out, and the version goes to everyone once released.
     *
     * Refused (409) with Apple's detail for what it won't take, such as a build still processing
     * or of another version, a What's New over 4,000 characters, or a new version while another is
     * in review. Two requests, and one more for each change and each locale written.
     */
    readonly prepareVersion: (appId: string, request: VersionToSubmit) => Effect.Effect<PreparedVersion, Failure>
    /**
     * Submits the version to App Review, in the app's iOS review submission that holds it, else in
     * its draft submission or a new one, with the version added. A version already submitted
     * (`WAITING_FOR_REVIEW` or `IN_REVIEW`) is left as it is, and one App Review rejected is
     * resubmitted in its submission (`UNRESOLVED_ISSUES`), so calling again after a refusal or an
     * outage submits the same submission once. Refused (409) with Apple's detail when it won't take
     * the submission, such as for a version missing what review needs. Two requests, one more per
     * open submission the app has, and up to three to submit.
     */
    readonly submitForReview: (appId: string, versionId: string) => Effect.Effect<ReviewSubmission, Failure>
    /**
     * Releases a version pending developer release (`PENDING_DEVELOPER_RELEASE`): to everyone, or
     * starting its phased release. Apple can't take a release back. A version already released, or
     * being processed for release, is left as it is, so calling again is safe. Refused (409) for a
     * version in another state. Two requests.
     */
    readonly releaseVersion: (versionId: string) => Effect.Effect<void, Failure>
    /**
     * Pauses or resumes the version's phased release, or completes it, releasing the version to
     * every user at once (Apple's `PAUSED`, `ACTIVE`, `COMPLETE`). Already so, nothing is sent.
     * Refused (409) for a version without a phased release, and by Apple for a change its state
     * doesn't allow, such as resuming one that hasn't started. One or two requests.
     */
    readonly setPhasedRelease: (
      versionId: string,
      state: "pause" | "resume" | "complete",
    ) => Effect.Effect<void, Failure>
    /**
     * Writes TestFlight's What to Test for the build in each locale: changed where it differs,
     * made where the build has none; other locales are left as they are. Calling again is safe.
     * Refused (409) with Apple's detail for a text it won't take. One request, and one more for
     * each locale written.
     */
    readonly setWhatToTest: (buildId: string, notes: ReadonlyArray<LocalizedText>) => Effect.Effect<void, Failure>
  }
>()("@cluenori/app-store-connect/app-store-connect/AppStoreConnect") {
  /**
   * A client with `credentials`, signing with `signing`, on the `HttpClient` the host provides,
   * with a token of its own: for a product that holds several, such as one with a Developer key
   * for reading and one with an App Manager key for writing. It signs a token and reuses it for 15
   * minutes; a token Apple refuses (401) is renewed once, and the request sent once more. Every
   * request has 15 seconds to be answered. An answer in a shape this client doesn't know, or an
   * HTTP status other than 200, 201, 204, 401, 403, 409, 429 and 5xx, is a defect.
   */
  static readonly make = (
    credentials: AppStoreConnectCredentials,
    signing: Es256Signing,
  ): Effect.Effect<AppStoreConnect["Service"], never, HttpClient.HttpClient> =>
    Effect.gen(function* () {
      const api = yield* appleApi(credentials, signing)

      const app = Effect.fn("AppStoreConnect.app")(function* (bundleId: string) {
        const text = yield* api.get("/v1/apps", { "filter[bundleId]": bundleId, limit: pageSize })
        const document = yield* decoded(AppsDocument, text, "apps")
        return appOf(document, bundleId)
      })

      const builds = Effect.fn("AppStoreConnect.builds")(function* (appId: string, limit: number) {
        yield* checkLimit(limit)
        const text = yield* api.get("/v1/builds", {
          "filter[app]": appId,
          sort: "-uploadedDate",
          include: "preReleaseVersion,buildBetaDetail",
          limit,
        })
        const document = yield* decoded(BuildsDocument, text, "builds")
        return yield* buildsOf(document)
      })

      const build = Effect.fn("AppStoreConnect.build")(function* (appId: string, version: string, buildNumber: string) {
        const text = yield* api.get("/v1/builds", {
          "filter[app]": appId,
          "filter[preReleaseVersion.version]": version,
          "filter[version]": buildNumber,
          "filter[preReleaseVersion.platform]": "IOS",
          include: "preReleaseVersion,buildBetaDetail",
          limit: pageSize,
        })
        const document = yield* decoded(BuildsDocument, text, "builds")
        const found = yield* buildsOf(document)
        // Apple's filters aren't documented as exact: only a build with exactly this version and
        // number is the one.
        return Arr.findFirst(found, (each) => each.version === version && each.buildNumber === buildNumber)
      })

      const appStoreVersions = Effect.fn("AppStoreConnect.appStoreVersions")(function* (appId: string, limit: number) {
        yield* checkLimit(limit)
        const texts = yield* api.pages(
          `/v1/apps/${encodeURIComponent(appId)}/appStoreVersions`,
          { include: "build,appStoreVersionPhasedRelease", limit: pageSize },
          "App Store versions",
        )
        const pages = yield* Effect.forEach(texts, (text) =>
          decoded(AppStoreVersionsDocument, text, "App Store versions").pipe(Effect.flatMap(appStoreVersionsOf)),
        )
        return Arr.take(Arr.sort(Arr.flatten(pages), latestCreatedFirst), limit)
      })

      const appLocales = Effect.fn("AppStoreConnect.appLocales")(function* (appId: string) {
        // Apple has about 40 App Store locales, so an app info's localizations fit in the 50 it
        // includes at most.
        const text = yield* api.get(`/v1/apps/${encodeURIComponent(appId)}/appInfos`, {
          include: "app,appInfoLocalizations",
          "limit[appInfoLocalizations]": 50,
        })
        const document = yield* decoded(AppInfosDocument, text, "app infos")
        return yield* appLocalesOf(document, appId)
      })

      const writes = publishing(api)

      return AppStoreConnect.of({ app, builds, build, appStoreVersions, appLocales, ...writes })
    })

  /** App Store Connect with `credentials`, as `make` builds it, for one key known when the host starts. */
  static readonly layer = (
    credentials: AppStoreConnectCredentials,
    signing: Es256Signing,
  ): Layer.Layer<AppStoreConnect, never, HttpClient.HttpClient> =>
    Layer.effect(AppStoreConnect, AppStoreConnect.make(credentials, signing))
}

// A limit the contract doesn't allow is the caller's bug.
const checkLimit = (limit: number) => {
  const allowed = Number.isInteger(limit) && limit >= 1 && limit <= pageSize
  return allowed ? Effect.void : Effect.die(`A limit is 1 to ${pageSize} items, not ${limit}`)
}
