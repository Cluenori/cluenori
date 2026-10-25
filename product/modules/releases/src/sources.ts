import type { AppStoreConnectCredentials, AppStoreConnectCrypto } from "@bagatka/app-store-connect"
import { AppStoreConnect, AppStoreConnectCredentialsRefused } from "@bagatka/app-store-connect"
import { Context, Effect, Layer, Option } from "effect"
import type { HttpClient } from "effect/http"

/**
 * What the Releases module reaches besides telemetry and GitHub, each absent until the deployment
 * has its key: App Store Connect, with a key that reads (Developer), and one that submits and
 * releases (App Manager). GitHub is the `GitHub` service the host provides, acting as the
 * workspace's GitHub App.
 */
export interface ReleasesSettings {
  readonly appStoreConnect: Option.Option<AppStoreConnectCredentials>
  readonly appStoreConnectManager: Option.Option<AppStoreConnectCredentials>
  /** The platform's Web Crypto, which signs App Store Connect's tokens. */
  readonly signing: AppStoreConnectCrypto
}

/** The clients the module reaches its sources with besides GitHub, each absent without its key. */
// A client for a key that can't sign: every call fails as a key App Store Connect refused does,
// saying why, so the project's object keeps working and each place that uses it says to fix the key.
const refusingClient = (reason: string): AppStoreConnect["Service"] => {
  const refused = Effect.fail(new AppStoreConnectCredentialsRefused({ reason }))
  return AppStoreConnect.of({
    app: () => refused,
    builds: () => refused,
    build: () => refused,
    appStoreVersions: () => refused,
    appLocales: () => refused,
    prepareVersion: () => refused,
    submitForReview: () => refused,
    releaseVersion: () => refused,
    setPhasedRelease: () => refused,
    setWhatToTest: () => refused,
  })
}

export class ReleaseSources extends Context.Service<
  ReleaseSources,
  {
    /** Reads apps, builds, versions and languages. */
    readonly appStoreConnect: Option.Option<AppStoreConnect["Service"]>
    /** Prepares, submits and releases App Store versions, and sets TestFlight's What to Test. */
    readonly appStoreConnectManager: Option.Option<AppStoreConnect["Service"]>
  }
>()("@cluenori/releases/sources/ReleaseSources") {
  /** The clients for `settings`, on the `HttpClient` the host provides. */
  static readonly layer = (settings: ReleasesSettings): Layer.Layer<ReleaseSources, never, HttpClient.HttpClient> =>
    Layer.effect(
      ReleaseSources,
      Effect.gen(function* () {
        const clientOf = (credentials: Option.Option<AppStoreConnectCredentials>) =>
          Option.match(credentials, {
            onNone: () => Effect.succeed(Option.none<AppStoreConnect["Service"]>()),
            onSome: (key) =>
              AppStoreConnect.make(key, settings.signing).pipe(
                Effect.catchTag("AppStoreConnectCredentialsInvalid", (invalid) =>
                  Effect.logError("An App Store Connect key can't sign", { reason: invalid.reason }).pipe(
                    Effect.as(refusingClient(invalid.reason)),
                  ),
                ),
                Effect.asSome,
              ),
          })
        return ReleaseSources.of({
          appStoreConnect: yield* clientOf(settings.appStoreConnect),
          appStoreConnectManager: yield* clientOf(settings.appStoreConnectManager),
        })
      }),
    )
}
