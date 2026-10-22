import type { AppStoreConnectCredentials } from "@bagatka/app-store-connect"
import { AppStoreConnect } from "@bagatka/app-store-connect"
import type { Es256Signing } from "@bagatka/es256-jwt"
import type { GitHubCredentials } from "@bagatka/github"
import { GitHub } from "@bagatka/github"
import { Context, Effect, Layer, Option } from "effect"
import type { HttpClient } from "effect/http"

/**
 * What the Releases module reads besides telemetry, each absent until the deployment has its
 * credentials: GitHub, with a read-only token, and App Store Connect, with an API key.
 */
export interface ReleasesSettings {
  readonly github: Option.Option<GitHubCredentials>
  readonly appStoreConnect: Option.Option<AppStoreConnectCredentials>
  /** The platform's Web Crypto, which signs App Store Connect's tokens. */
  readonly signing: Es256Signing
}

/** The clients the module reads its sources with, each absent without its credentials. */
export class ReleaseSources extends Context.Service<
  ReleaseSources,
  {
    readonly github: Option.Option<GitHub["Service"]>
    readonly appStoreConnect: Option.Option<AppStoreConnect["Service"]>
  }
>()("@cluenori/releases/sources/ReleaseSources") {
  /** The clients for `settings`, on the `HttpClient` the host provides. */
  static readonly layer = (settings: ReleasesSettings): Layer.Layer<ReleaseSources, never, HttpClient.HttpClient> =>
    Layer.effect(
      ReleaseSources,
      Effect.gen(function* () {
        const github = yield* Effect.serviceOption(GitHub)
        const appStoreConnect = yield* Effect.serviceOption(AppStoreConnect)
        return ReleaseSources.of({ github, appStoreConnect })
      }),
    ).pipe(
      Layer.provide(
        Layer.mergeAll(
          Option.match(settings.github, {
            onNone: () => Layer.empty,
            onSome: (credentials) => GitHub.layer(credentials),
          }),
          Option.match(settings.appStoreConnect, {
            onNone: () => Layer.empty,
            onSome: (credentials) => AppStoreConnect.layer(credentials, settings.signing),
          }),
        ),
      ),
    )
}
