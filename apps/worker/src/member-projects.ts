import type { ProjectKey } from "@cluenori/foundation"
import { canSee } from "@cluenori/members"
import { ProjectNotFound } from "@cluenori/projects"
import { Context, Effect, Layer } from "effect"

import type { CurrentMember } from "./member-authorization.ts"
import type { PlainSchema } from "./object-calls.ts"
import type { ProjectCall } from "./project-calls.ts"
import { ProjectObjects } from "./project-objects.ts"

/**
 * The public API's way to a project's Durable Object, for the member who calls: the only one its
 * handlers have, so each keeps to the projects they see.
 */
export class MemberProjects extends Context.Service<
  MemberProjects,
  {
    /**
     * Runs `call` in `project`'s object, as `ProjectObjects.call` does, when `member` sees it. A
     * project they don't see fails with `ProjectNotFound`, as one that doesn't exist does, so its
     * name isn't told.
     */
    readonly call: <I extends PlainSchema, S extends PlainSchema, F extends PlainSchema>(
      member: CurrentMember["Service"],
      project: ProjectKey,
      call: ProjectCall<I, S, F>,
      input: I["Type"],
    ) => Effect.Effect<S["Type"], F["Type"] | ProjectNotFound>
  }
>()("@cluenori/worker/member-projects/MemberProjects") {
  static readonly layer = Layer.effect(
    MemberProjects,
    Effect.gen(function* () {
      const objects = yield* ProjectObjects
      return MemberProjects.of({
        call: (member, project, call, input) =>
          canSee(member.access, project)
            ? objects.call(project, call, input)
            : Effect.fail(new ProjectNotFound({ project })),
      })
    }),
  )
}
