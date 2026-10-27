import type { ProjectKey } from "@cluenori/foundation"
import { canSee } from "@cluenori/members"
import type { ProjectPulse, TodayItem } from "@cluenori/today"
import { sortToday } from "@cluenori/today"
import { DateTime, Effect, Exit } from "effect"
import { HttpApiBuilder } from "effect/http-api"

import { CluenoriApi } from "./cluenori-api.ts"
import { CurrentMember } from "./member-authorization.ts"
import { MemberProjects } from "./member-projects.ts"
import { projectCalls } from "./project-calls.ts"
import { workspaceCalls } from "./workspace-calls.ts"
import { WorkspaceObjects } from "./workspace-objects.ts"

// How many projects' objects are asked at once: one request each.
const askedAtOnce = 8

/**
 * Serves Today: the object of every project the member sees asked for its items and its pulse, and
 * what they say in Today's order, the pulses in the projects' order.
 */
export const TodayHandlers = HttpApiBuilder.group(CluenoriApi, "today", (handlers) =>
  handlers.handle("today", () =>
    Effect.gen(function* () {
      const member = yield* CurrentMember
      const owner = member.access._tag === "Everything"
      const workspace = yield* WorkspaceObjects
      const objects = yield* MemberProjects
      const all = yield* workspace.call(workspaceCalls.projects, undefined)
      const projects = all.projects.filter((project) => canSee(member.access, project.key))
      const answers = yield* Effect.forEach(
        projects,
        (project) => objects.call(member, project.key, projectCalls.today, undefined).pipe(Effect.exit),
        { concurrency: askedAtOnce },
      )
      const items: Array<TodayItem> = []
      const pulses: Array<ProjectPulse> = []
      const unanswered: Array<ProjectKey> = []
      for (const [index, answer] of answers.entries()) {
        const project = projects[index]
        if (Exit.isSuccess(answer)) {
          // Keys are owners' to replace, so only owners hear of one expiring.
          items.push(...answer.value.items.filter((item) => item._tag !== "keyExpiring" || owner))
          pulses.push(answer.value.pulse)
        } else if (project !== undefined) {
          yield* Effect.logWarning("A project didn't answer Today", answer.cause)
          unanswered.push(project.key)
        }
      }
      return { items: sortToday(items), projects, unanswered, pulses, at: yield* DateTime.now }
    }),
  ),
)
