import { webCryptoLayer } from "@bagatka/web-crypto"
import { ActivityLog, WorkspaceKey } from "@cluenori/foundation"
import { Phones } from "@cluenori/phones"
import { ProjectIndex } from "@cluenori/projects"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { DurableObject } from "cloudflare:workers"
import { Effect, Layer, ManagedRuntime, Redacted } from "effect"

import { serve } from "./object-calls.ts"
import { SyncScheduler } from "./sync-scheduler.ts"
import type { WorkspaceCallName } from "./workspace-calls.ts"
import { workspaceCalls } from "./workspace-calls.ts"

// Each call the Worker can make, on a visible line, translated to the engines' services.
const servedCalls: Readonly<
  Record<WorkspaceCallName, (input: string) => Effect.Effect<string, never, ProjectIndex | Phones>>
> = {
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
  phones: serve(workspaceCalls.phones, () =>
    Effect.gen(function* () {
      const phones = yield* Phones
      return yield* phones.phones
    }),
  ),
  startPairing: serve(workspaceCalls.startPairing, ({ actor, deployment }) =>
    Effect.gen(function* () {
      const phones = yield* Phones
      return yield* phones.startPairing(actor, deployment)
    }),
  ),
  pair: serve(workspaceCalls.pair, ({ phone, caller }) =>
    Effect.gen(function* () {
      const phones = yield* Phones
      const paired = yield* phones.pair(phone, caller)
      return { phone: paired.phone, key: Redacted.value(paired.key) }
    }),
  ),
  authenticatePhone: serve(workspaceCalls.authenticatePhone, ({ key, caller }) =>
    Effect.gen(function* () {
      const phones = yield* Phones
      return yield* phones.authenticate(Redacted.make(key), caller)
    }),
  ),
  removePhone: serve(workspaceCalls.removePhone, ({ actor, phone }) =>
    Effect.gen(function* () {
      const phones = yield* Phones
      yield* phones.remove(actor, phone)
    }),
  ),
}

/**
 * The workspace's own Durable Object, named `<workspace>`: the records that belong to the whole
 * workspace rather than one project, today the index of its projects and its paired phones. The
 * Worker reaches it through `call`.
 */
export class WorkspaceObject extends DurableObject<Env> {
  readonly #runtime: ManagedRuntime.ManagedRuntime<ProjectIndex | Phones, never>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // The Worker names the object by a decoded key, so this holds; `make` stops the object if not.
    const workspace = WorkspaceKey.make(ctx.id.name ?? "")
    this.#runtime = ManagedRuntime.make(
      Layer.mergeAll(ProjectIndex.layer, Phones.layer).pipe(
        Layer.provide(ActivityLog.layer({ workspace })),
        Layer.provide(webCryptoLayer(crypto)),
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
