import { Period } from "@cluenori/foundation"
import { releasesModule } from "@cluenori/releases"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { CurrentMember } from "./member-authorization.ts"
import { MemberProjects } from "./member-projects.ts"
import { moduleActionCall, moduleCall } from "./project-calls.ts"

/** Serves the Releases module's routes, each its query or action in the project's Durable Object. */
export const ReleasesHandlers = HttpApiBuilder.group(CluenoriApi, "releases", (handlers) =>
  handlers
    .handle("releases", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, moduleCall(releasesModule, "list"), {
          period: new Period({ from: query.from, to: query.to }),
          ...(query.environment === undefined ? {} : { environment: query.environment }),
          ...(query.component === undefined ? {} : { component: query.component }),
        })
      }),
    )
    .handle("release", ({ params, query }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, moduleCall(releasesModule, "release"), {
          component: params.component,
          release: params.release,
          ...(query.environment === undefined ? {} : { environment: query.environment }),
        })
      }),
    )
    // Anyone who sees the project may promote its releases; who did, and why, is recorded.
    .handle("promote", ({ params, payload }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, moduleActionCall(releasesModule, "promote"), {
          actor: member.actor,
          input: { component: params.component, release: params.release, ...payload },
        })
      }),
    )
    .handle("promoteLatest", ({ params, payload }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, moduleActionCall(releasesModule, "promoteLatest"), {
          actor: member.actor,
          input: { component: params.component, ...payload },
        })
      }),
    )
    .handle("releaseApproved", ({ params }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, moduleActionCall(releasesModule, "releaseApproved"), {
          actor: member.actor,
          input: { promotion: params.promotion },
        })
      }),
    )
    .handle("versions", ({ params }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, moduleCall(releasesModule, "versions"), {})
      }),
    )
    .handle("setVersion", ({ params, payload }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, moduleActionCall(releasesModule, "setVersion"), {
          actor: member.actor,
          input: { component: params.component, ...payload },
        })
      }),
    )
    .handle("saveNotes", ({ params, payload }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, moduleActionCall(releasesModule, "saveNotes"), {
          actor: member.actor,
          input: { component: params.component, release: params.release, notes: payload.notes },
        })
      }),
    )
    .handle("draftNotes", ({ params, payload }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, moduleActionCall(releasesModule, "draftNotes"), {
          actor: member.actor,
          input: { component: params.component, release: params.release, environment: payload.environment },
        })
      }),
    )
    .handle("notesStyle", ({ params }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, moduleCall(releasesModule, "notesStyle"), {})
      }),
    )
    .handle("setNotesStyle", ({ params, payload }) =>
      Effect.gen(function* () {
        const member = yield* CurrentMember
        const projects = yield* MemberProjects
        return yield* projects.call(member, params.project, moduleActionCall(releasesModule, "setNotesStyle"), {
          actor: member.actor,
          input: payload,
        })
      }),
    ),
)
