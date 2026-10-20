import type { WorkspaceKey } from "@cluenori/foundation"
import type { Effect } from "effect"
import { Context, Layer } from "effect"

import type { PlainSchema } from "./object-calls.ts"
import { send } from "./object-calls.ts"
import type { WorkspaceCall } from "./workspace-calls.ts"
import type { WorkspaceObject } from "./workspace-object.ts"

/** The Worker's way to the workspace's own Durable Object. */
export class WorkspaceObjects extends Context.Service<
  WorkspaceObjects,
  {
    /**
     * Runs `call` in the workspace's object, named `<workspace>`, and returns its answer, or fails
     * with its error. One request to the object, which runs its calls one at a time.
     */
    readonly call: <I extends PlainSchema, S extends PlainSchema, F extends PlainSchema>(
      call: WorkspaceCall<I, S, F>,
      input: I["Type"],
    ) => Effect.Effect<S["Type"], F["Type"]>
  }
>()("@cluenori/worker/workspace-objects/WorkspaceObjects") {
  static readonly layer = (namespace: DurableObjectNamespace<WorkspaceObject>, workspace: WorkspaceKey) =>
    Layer.succeed(
      WorkspaceObjects,
      WorkspaceObjects.of({
        call: (call, input) => send(namespace.getByName(workspace), call, input),
      }),
    )
}
