import type { WorkspaceKey } from "@cluenori/foundation"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"

import type { PlainSchema } from "./object-calls.ts"
import { send } from "./object-calls.ts"
import type { WorkspaceCall } from "./workspace-calls.ts"
import type { WorkspaceObject } from "./workspace-object.ts"

// Set by wrangler.jsonc's `eu` environment, which ./setup deploys for data kept in the EU.
const jurisdiction = Config.option(Config.schema(Schema.Literal("eu"), "CLUENORI_JURISDICTION"))

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

  /** The way there through `namespace`, made in the EU when the deployment's data stays there. */
  static readonly layerInJurisdiction = (namespace: DurableObjectNamespace<WorkspaceObject>, workspace: WorkspaceKey) =>
    Layer.unwrap(
      Effect.gen(function* () {
        const where = yield* jurisdiction
        return WorkspaceObjects.layer(Option.isSome(where) ? namespace.jurisdiction(where.value) : namespace, workspace)
      }),
    )
}
