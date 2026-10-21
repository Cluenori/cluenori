import { Config, Effect, Layer, Option } from "effect"
import { HttpRouter, HttpServerResponse } from "effect/http"

// The iPhone app's team and bundle ID, which `./cluenori push setup` sets for its pushes
// (PATTERNS.md, "Configuration").
const appSettings = Config.option(
  Config.all({ team: Config.String("CLUENORI_APNS_TEAM_ID"), bundle: Config.String("CLUENORI_APNS_TOPIC") }),
)

/**
 * `GET /.well-known/apple-app-site-association`: the iPhone app this site's passkeys may sign in to,
 * which iOS asks for (through Apple's CDN) before letting the app use them. 404 until push is set
 * up, which names the app.
 */
export const AppleAppSiteAssociation = Layer.unwrap(
  Effect.gen(function* () {
    const app = yield* appSettings
    return HttpRouter.add(
      "GET",
      "/.well-known/apple-app-site-association",
      Option.match(app, {
        onNone: () => Effect.succeed(HttpServerResponse.empty({ status: 404 })),
        onSome: ({ team, bundle }) =>
          HttpServerResponse.json({ webcredentials: { apps: [`${team}.${bundle}`] } }).pipe(Effect.orDie),
      }),
    )
  }),
)
