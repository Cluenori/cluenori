import type { ProjectKey, WorkspaceKey } from "@cluenori/foundation"
import { Context, Effect, Layer, Schema } from "effect"

import type { PlainSchema, ProjectCall } from "./project-calls.ts"
import { exitText, inputText } from "./project-calls.ts"
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
          const encoded = yield* Schema.encodeEffect(inputText(call.input))(input).pipe(Effect.orDie)
          const stub = namespace.getByName(`${workspace}/${project}`)
          const reply = yield* Effect.tryPromise(() => stub.call(call.name, encoded)).pipe(Effect.orDie)
          const exit = yield* Schema.decodeEffect(exitText(call.success, call.error))(reply).pipe(Effect.orDie)
          return yield* exit
        }),
      }),
    )
}
