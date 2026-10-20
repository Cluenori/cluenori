import { Duration, Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { ApiToken } from "./api-token.ts"
import { CluenoriApi } from "./cluenori-api.ts"
import { signInCookie } from "./member-authorization.ts"

// For the API's paths only, never sent by another site, kept 30 days; HttpOnly and Secure are the
// cookie's defaults.
const cookie = { path: "/api", sameSite: "strict", maxAge: Duration.days(30) } as const

/** Serves the sign-in group: the cookie is set only for the deployment's own API token. */
export const SignInHandlers = HttpApiBuilder.group(CluenoriApi, "signIn", (handlers) =>
  handlers
    .handle("signIn", ({ payload }) =>
      Effect.gen(function* () {
        const token = yield* ApiToken
        yield* token.memberOf(payload.token)
        yield* HttpApiBuilder.securitySetCookie(signInCookie, payload.token, cookie)
      }),
    )
    .handle("signOut", () => HttpApiBuilder.securitySetCookie(signInCookie, "", { ...cookie, maxAge: 0 })),
)
