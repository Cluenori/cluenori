import { webCryptoLayer } from "@bagatka/web-crypto"
import { ActivityLog, ProjectKey, WorkspaceKey } from "@cluenori/foundation"
import { IngestKeyRejected, ProjectNotFound, Projects } from "@cluenori/projects"
import { Signals } from "@cluenori/signals"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { DurableObject } from "cloudflare:workers"
import { Effect, Exit, Layer, ManagedRuntime, Redacted, Schema } from "effect"

import type { PlainSchema } from "./object-calls.ts"
import { exitText, serve } from "./object-calls.ts"
import type { ProjectCall, ProjectCallName } from "./project-calls.ts"
import { projectCalls } from "./project-calls.ts"
import { r2ArchiveLayer } from "./r2-archive.ts"
import { SyncScheduler } from "./sync-scheduler.ts"

type ProjectServices = Projects | Signals

// Set when the object is first asked to create its project. Until then it builds no database, so a
// request for a project that doesn't exist leaves nothing behind.
const projectCreated = "cluenori.project-created"

interface Served {
  /** Decodes the input, runs the call, and encodes its exit, failure or not, for the Worker. */
  readonly serve: (input: string) => Effect.Effect<string, never, ProjectServices>
  /** What the call answers before the project exists; absent for the call that creates it. */
  readonly beforeCreated: Effect.Effect<string> | undefined
}

const served = <I extends PlainSchema, S extends PlainSchema, F extends PlainSchema>(
  call: ProjectCall<I, S, F>,
  handler: (input: I["Type"]) => Effect.Effect<S["Type"], F["Type"], ProjectServices>,
  beforeCreated?: F["Type"],
): Served => ({
  serve: serve(call, handler),
  beforeCreated:
    beforeCreated === undefined
      ? undefined
      : Schema.encodeEffect(exitText(call.success, call.error))(Exit.fail(beforeCreated)).pipe(Effect.orDie),
})

// Each call the Worker can make, on a visible line, translated to the engines' services.
const servedCalls = (project: ProjectKey): Readonly<Record<ProjectCallName, Served>> => ({
  createProject: served(projectCalls.createProject, ({ actor, name }) =>
    Effect.gen(function* () {
      const projects = yield* Projects
      return yield* projects.create(actor, name)
    }),
  ),
  detail: served(
    projectCalls.detail,
    () =>
      Effect.gen(function* () {
        const projects = yield* Projects
        return { project: yield* projects.project, components: yield* projects.components }
      }),
    new ProjectNotFound({ project }),
  ),
  addComponent: served(
    projectCalls.addComponent,
    ({ actor, component }) =>
      Effect.gen(function* () {
        const projects = yield* Projects
        const added = yield* projects.addComponent(actor, component)
        return { component: added.component, ingestKey: Redacted.value(added.ingestKey) }
      }),
    new ProjectNotFound({ project }),
  ),
  ingestTraces: served(
    projectCalls.ingestTraces,
    ({ ingestKey, export: exported }) =>
      Effect.gen(function* () {
        const projects = yield* Projects
        const signals = yield* Signals
        const component = yield* projects.authenticate(Redacted.make(ingestKey))
        return yield* signals.recordTraces(component, exported)
      }),
    new IngestKeyRejected(),
  ),
  ingestLogs: served(
    projectCalls.ingestLogs,
    ({ ingestKey, export: exported }) =>
      Effect.gen(function* () {
        const projects = yield* Projects
        const signals = yield* Signals
        const component = yield* projects.authenticate(Redacted.make(ingestKey))
        return yield* signals.recordLogs(component, exported)
      }),
    new IngestKeyRejected(),
  ),
  ingestMetrics: served(
    projectCalls.ingestMetrics,
    ({ ingestKey, export: exported }) =>
      Effect.gen(function* () {
        const projects = yield* Projects
        const signals = yield* Signals
        const component = yield* projects.authenticate(Redacted.make(ingestKey))
        return yield* signals.recordMetrics(component, exported)
      }),
    new IngestKeyRejected(),
  ),
  operations: served(
    projectCalls.operations,
    (query) =>
      Effect.gen(function* () {
        const signals = yield* Signals
        return yield* signals.operations(query)
      }),
    new ProjectNotFound({ project }),
  ),
  loadOverTime: served(
    projectCalls.loadOverTime,
    ({ query, step }) =>
      Effect.gen(function* () {
        const signals = yield* Signals
        return yield* signals.loadOverTime(query, step)
      }),
    new ProjectNotFound({ project }),
  ),
  keptTraces: served(
    projectCalls.keptTraces,
    (query) =>
      Effect.gen(function* () {
        const signals = yield* Signals
        return yield* signals.keptTraces(query)
      }),
    new ProjectNotFound({ project }),
  ),
  errors: served(
    projectCalls.errors,
    (query) =>
      Effect.gen(function* () {
        const signals = yield* Signals
        return yield* signals.errors(query)
      }),
    new ProjectNotFound({ project }),
  ),
  error: served(
    projectCalls.error,
    ({ id, query }) =>
      Effect.gen(function* () {
        const signals = yield* Signals
        return yield* signals.error(id, query)
      }),
    new ProjectNotFound({ project }),
  ),
  logs: served(
    projectCalls.logs,
    (query) =>
      Effect.gen(function* () {
        const signals = yield* Signals
        return yield* signals.logs(query)
      }),
    new ProjectNotFound({ project }),
  ),
  logCounts: served(
    projectCalls.logCounts,
    (query) =>
      Effect.gen(function* () {
        const signals = yield* Signals
        return yield* signals.logCounts(query)
      }),
    new ProjectNotFound({ project }),
  ),
  trace: served(
    projectCalls.trace,
    ({ trace, around }) =>
      Effect.gen(function* () {
        const signals = yield* Signals
        return yield* signals.trace(trace, around)
      }),
    new ProjectNotFound({ project }),
  ),
})

/**
 * One project's Durable Object, named `<workspace>/<project>`: its database, and the engines that
 * keep their records in it, built once per object. The Worker reaches it through `call`.
 */
export class ProjectObject extends DurableObject<Env> {
  readonly #storage: DurableObjectStorage
  readonly #runtime: ManagedRuntime.ManagedRuntime<ProjectServices | ActivityLog, never>
  readonly #calls: Readonly<Record<ProjectCallName, Served>>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // The Worker names every object `<workspace>/<project>` from decoded keys, so these hold;
    // `make` stops the object if one doesn't.
    const [workspaceName, projectName] = (ctx.id.name ?? "").split("/")
    const workspace = WorkspaceKey.make(workspaceName ?? "")
    const project = ProjectKey.make(projectName ?? "")
    this.#storage = ctx.storage
    this.#calls = servedCalls(project)
    this.#runtime = ManagedRuntime.make(
      Layer.mergeAll(Projects.layer({ project }), Signals.layer({ workspace, project })).pipe(
        Layer.provideMerge(ActivityLog.layer({ workspace, project })),
        Layer.provide(webCryptoLayer(crypto)),
        Layer.provide(r2ArchiveLayer(env.ARCHIVE)),
        Layer.provide(SqliteClient.layer({ storage: ctx.storage })),
        // In the runtime itself, so every call runs on it as the Worker's requests do. A scheduler
        // is a reference, so it doesn't show in the runtime's type.
        Layer.provideMerge(SyncScheduler),
      ),
    )
  }

  /** Runs one of `projectCalls`: its input and answer are that call's encodings as JSON text. */
  call(name: ProjectCallName, input: string): Promise<string> {
    const call = this.#calls[name]
    const created = this.#storage.kv.get(projectCreated) === true
    if (call.beforeCreated !== undefined && !created) {
      return Effect.runPromise(call.beforeCreated)
    }
    if (!created) {
      this.#storage.kv.put(projectCreated, true)
    }
    return this.#runtime.runPromise(call.serve(input))
  }
}
