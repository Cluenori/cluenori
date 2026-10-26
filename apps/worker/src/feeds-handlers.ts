import type { ProjectWatch } from "@cluenori/feeds"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { CurrentMember } from "./member-authorization.ts"
import { MemberProjects } from "./member-projects.ts"
import { projectCalls } from "./project-calls.ts"
import { workspaceCalls } from "./workspace-calls.ts"
import { WorkspaceObjects } from "./workspace-objects.ts"

/**
 * Tells each project's object what its feeds watch now, after a change only an owner makes. One that
 * fails leaves the feed saved; saving it again tells them all again. Feeds keep only sources in
 * projects the workspace has, whose objects exist, so none is not found.
 */
const tellProjects = Effect.fn("tellProjects")(function* (watches: ReadonlyArray<ProjectWatch>) {
  const member = yield* CurrentMember
  const projects = yield* MemberProjects
  yield* Effect.forEach(
    watches,
    (watch) => projects.call(member, watch.project, projectCalls.watchFeeds, watch.events).pipe(Effect.orDie),
    { concurrency: 8, discard: true },
  )
})

/** Serves the feeds group, in the workspace's Durable Object, which tells projects' objects what to watch. */
export const FeedsHandlers = HttpApiBuilder.group(CluenoriApi, "feeds", (handlers) =>
  handlers
    .handle("feeds", () =>
      Effect.gen(function* () {
        const { access } = yield* CurrentMember
        const workspace = yield* WorkspaceObjects
        return yield* workspace.call(workspaceCalls.feeds, access)
      }),
    )
    .handle("feed", ({ params, query }) =>
      Effect.gen(function* () {
        const { access } = yield* CurrentMember
        const workspace = yield* WorkspaceObjects
        return yield* workspace.call(workspaceCalls.feed, {
          access,
          feed: params.feed,
          ...(query.before === undefined ? {} : { before: query.before }),
        })
      }),
    )
    .handle("createFeed", ({ payload }) =>
      Effect.gen(function* () {
        const { actor, access } = yield* CurrentMember
        const workspace = yield* WorkspaceObjects
        const saved = yield* workspace
          .call(workspaceCalls.saveFeed, { actor, access, input: payload })
          // A new feed has no ID to be missing.
          .pipe(Effect.catchTag("FeedNotFound", Effect.die))
        yield* tellProjects(saved.watches)
        return saved.feed
      }),
    )
    .handle("saveFeed", ({ params, payload }) =>
      Effect.gen(function* () {
        const { actor, access } = yield* CurrentMember
        const workspace = yield* WorkspaceObjects
        const saved = yield* workspace.call(workspaceCalls.saveFeed, {
          actor,
          access,
          feed: params.feed,
          input: payload,
        })
        yield* tellProjects(saved.watches)
        return saved.feed
      }),
    )
    .handle("removeFeed", ({ params }) =>
      Effect.gen(function* () {
        const { actor, access } = yield* CurrentMember
        const workspace = yield* WorkspaceObjects
        yield* tellProjects(yield* workspace.call(workspaceCalls.removeFeed, { actor, access, feed: params.feed }))
      }),
    ),
)
