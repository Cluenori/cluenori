import { ProjectIndex } from "@cluenori/projects"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { DurableObject } from "cloudflare:workers"
import { Effect, Layer, ManagedRuntime } from "effect"

import { serve } from "./object-calls.ts"
import { SyncScheduler } from "./sync-scheduler.ts"
import type { WorkspaceCallName } from "./workspace-calls.ts"
import { workspaceCalls } from "./workspace-calls.ts"

// Each call the Worker can make, on a visible line, translated to the engines' services.
const servedCalls: Readonly<Record<WorkspaceCallName, (input: string) => Effect.Effect<string, never, ProjectIndex>>> =
  {
    recordProject: serve(workspaceCalls.recordProject, (project) =>
      Effect.gen(function* () {
        const index = yield* ProjectIndex
        yield* index.record(project)
      }),
    ),
    projects: serve(workspaceCalls.projects, () =>
      Effect.gen(function* () {
        const index = yield* ProjectIndex
        return { projects: yield* index.all }
      }),
    ),
  }

/**
 * The workspace's own Durable Object, named `<workspace>`: the records that belong to the whole
 * workspace rather than one project, today the index of its projects. The Worker reaches it through
 * `call`.
 */
export class WorkspaceObject extends DurableObject<Env> {
  readonly #runtime: ManagedRuntime.ManagedRuntime<ProjectIndex, never>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.#runtime = ManagedRuntime.make(
      ProjectIndex.layer.pipe(
        Layer.provide(SqliteClient.layer({ storage: ctx.storage })),
        // In the runtime itself, so every call runs on it as the Worker's requests do.
        Layer.provideMerge(SyncScheduler),
      ),
    )
  }

  /** Runs one of `workspaceCalls`: its input and answer are that call's encodings as JSON text. */
  call(name: WorkspaceCallName, input: string): Promise<string> {
    return this.#runtime.runPromise(servedCalls[name](input))
  }
}
