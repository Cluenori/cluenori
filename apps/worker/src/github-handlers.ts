import { ManifestCode } from "@cluenori/github"
import { Effect, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { CurrentMember } from "./member-authorization.ts"
import { workspaceCalls } from "./workspace-calls.ts"
import { WorkspaceObjects } from "./workspace-objects.ts"

/** Serves the GitHub group, in the workspace's Durable Object, which allows owners only. */
export const GitHubHandlers = HttpApiBuilder.group(CluenoriApi, "github", (handlers) =>
  handlers
    .handle("github", () =>
      Effect.gen(function* () {
        const { access } = yield* CurrentMember
        const workspace = yield* WorkspaceObjects
        return yield* workspace.call(workspaceCalls.github, access)
      }),
    )
    .handle("connectGitHub", ({ payload }) =>
      Effect.gen(function* () {
        const { actor, access } = yield* CurrentMember
        const request = yield* HttpServerRequest.HttpServerRequest
        const workspace = yield* WorkspaceObjects
        // GitHub sends the browser back to the deployment where this request reached it.
        const deployment = new URL(request.originalUrl).origin
        return yield* workspace.call(workspaceCalls.connectGitHub, { actor, access, deployment, ...payload })
      }),
    )
    .handle("disconnectGitHub", () =>
      Effect.gen(function* () {
        const { actor, access } = yield* CurrentMember
        const workspace = yield* WorkspaceObjects
        yield* workspace.call(workspaceCalls.disconnectGitHub, { actor, access })
      }),
    ),
)

const decodeReturn = Schema.decodeUnknownOption(Schema.Struct({ code: ManifestCode, state: Schema.String }))

// Back to the dashboard's GitHub page, saying how connecting went.
const toGitHubPage = (query: string) => HttpServerResponse.redirect(`/github?${query}`, { status: 303 })

/**
 * `GET /api/github/connected?code=…&state=…`: where GitHub sends an owner's browser once it created
 * the app from its manifest. Finishes connecting, then sends the browser to the dashboard's GitHub
 * page, `/github?connected`, or `/github?problem=<what to do>`. GitHub's redirect comes from its own
 * site, so the browser's sign-in cookie, SameSite=Strict, doesn't come with it: the state, which an
 * owner started within the hour and is good once, is the credential.
 */
export const GitHubConnected = HttpRouter.add(
  "GET",
  "/api/github/connected",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const query = new URL(request.originalUrl).searchParams
    const returned = decodeReturn({ code: query.get("code"), state: query.get("state") })
    if (returned._tag === "None") {
      return toGitHubPage(`problem=${encodeURIComponent("GitHub sent no app back: connect GitHub again")}`)
    }
    const workspace = yield* WorkspaceObjects
    const finished = yield* workspace.call(workspaceCalls.finishConnectingGitHub, returned.value).pipe(Effect.result)
    return finished._tag === "Success"
      ? toGitHubPage("connected")
      : toGitHubPage(`problem=${encodeURIComponent(finished.failure.reason)}`)
  }),
)
