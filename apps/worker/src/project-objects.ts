import type { ProjectKey, WorkspaceKey } from "@cluenori/foundation"
import { Context, Effect, Layer } from "effect"

import type { PlainSchema } from "./object-calls.ts"
import { send } from "./object-calls.ts"
import type { ProjectCall } from "./project-calls.ts"
import type { ProjectObject } from "./project-object.ts"

/** The Worker's way to a project's Durable Object. */
export class ProjectObjects extends Context.Service<
  ProjectObjects,
  {
    /**
     * Runs `call` in the object of `project`, named `<workspace>/<project>`, and returns its answer,
     * or fails with its error. One request to the object, which runs its calls one at a time.
     */
    readonly call: <I extends PlainSchema, S extends PlainSchema, F extends PlainSchema>(
      project: ProjectKey,
      call: ProjectCall<I, S, F>,
      input: I["Type"],
    ) => Effect.Effect<S["Type"], F["Type"]>
  }
>()("@cluenori/worker/project-objects/ProjectObjects") {
  static readonly layer = (namespace: DurableObjectNamespace<ProjectObject>, workspace: WorkspaceKey) =>
    Layer.succeed(
      ProjectObjects,
      ProjectObjects.of({
        call: Effect.fn("ProjectObjects.call")(function* <
          I extends PlainSchema,
          S extends PlainSchema,
          F extends PlainSchema,
        >(project: ProjectKey, call: ProjectCall<I, S, F>, input: I["Type"]): Effect.fn.Return<S["Type"], F["Type"]> {
          return yield* send(namespace.getByName(`${workspace}/${project}`), call, input)
        }),
      }),
    )
}
