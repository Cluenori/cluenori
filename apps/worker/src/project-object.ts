import { webCryptoLayer } from "@bagatka/web-crypto"
import type { ErrorSchema, ModuleDefinition, ModuleQuery, PlainSchema as QuerySchema } from "@cluenori/foundation"
import { ActivityLog, ProjectKey, WorkspaceKey } from "@cluenori/foundation"
import { Incidents } from "@cluenori/incidents"
import { IngestKeyRejected, ProjectNotFound, Projects } from "@cluenori/projects"
import { releasesModule } from "@cluenori/releases"
import { Signals } from "@cluenori/signals"
import { Today } from "@cluenori/today"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { DurableObject } from "cloudflare:workers"
import { Clock, Duration, Effect, Exit, Layer, ManagedRuntime, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"

import { sendActivity } from "./activity-queue.ts"
import type { PlainSchema } from "./object-calls.ts"
import { exitText, serve } from "./object-calls.ts"
import type { EngineCallName, ProjectCall, ProjectCallName } from "./project-calls.ts"
import { moduleCall, projectCalls } from "./project-calls.ts"
import { r2ArchiveLayer } from "./r2-archive.ts"
import { SyncScheduler } from "./sync-scheduler.ts"

type ProjectServices = Projects | Signals | Incidents | Today

// How often the detectors look: the object's alarm runs `Incidents.check` this often.
const checkEvery = Duration.toMillis(Duration.minutes(1))

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
const servedCalls = (project: ProjectKey): Readonly<Record<EngineCallName, Served>> => ({
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
  incidents: served(
    projectCalls.incidents,
    () =>
      Effect.gen(function* () {
        const incidents = yield* Incidents
        return yield* incidents.incidents
      }),
    new ProjectNotFound({ project }),
  ),
  acknowledge: served(
    projectCalls.acknowledge,
    ({ actor, incident }) =>
      Effect.gen(function* () {
        const incidents = yield* Incidents
        return yield* incidents.acknowledge(actor, incident)
      }),
    new ProjectNotFound({ project }),
  ),
  monitors: served(
    projectCalls.monitors,
    () =>
      Effect.gen(function* () {
        const incidents = yield* Incidents
        return yield* incidents.monitors
      }),
    new ProjectNotFound({ project }),
  ),
  addMonitor: served(
    projectCalls.addMonitor,
    ({ actor, monitor }) =>
      Effect.gen(function* () {
        const incidents = yield* Incidents
        return yield* incidents.addMonitor(actor, monitor)
      }),
    new ProjectNotFound({ project }),
  ),
  removeMonitor: served(
    projectCalls.removeMonitor,
    ({ actor, monitor }) =>
      Effect.gen(function* () {
        const incidents = yield* Incidents
        return yield* incidents.removeMonitor(actor, monitor)
      }),
    new ProjectNotFound({ project }),
  ),
  today: served(
    projectCalls.today,
    () =>
      Effect.gen(function* () {
        const today = yield* Today
        return yield* today.items
      }),
    new ProjectNotFound({ project }),
  ),
})

// The modules every project's object serves, each on a visible line; their queries read the engines.
const modules: ReadonlyArray<
  ModuleDefinition<
    string,
    Readonly<Record<string, ModuleQuery<QuerySchema, QuerySchema, ErrorSchema, ProjectServices>>>
  >
> = [releasesModule]

// Each module's queries, under `<module>.<query>`, answered by the module's own `run`.
const servedModules = (project: ProjectKey) =>
  modules.flatMap((module) =>
    Object.entries(module.queries).map(([name, query]) => {
      const call = moduleCall(module, name)
      const entry: readonly [ProjectCallName, Served] = [
        call.name,
        served(call, (input) => query.run(input), new ProjectNotFound({ project })),
      ]
      return entry
    }),
  )

/**
 * One project's Durable Object, named `<workspace>/<project>`: its database, and the engines that
 * keep their records in it, built once per object. The Worker reaches it through `call`.
 */
export class ProjectObject extends DurableObject<Env> {
  readonly #storage: DurableObjectStorage
  readonly #activity: Queue
  readonly #runtime: ManagedRuntime.ManagedRuntime<ProjectServices | ActivityLog, never>
  readonly #calls: ReadonlyMap<string, Served>

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // The Worker names every object `<workspace>/<project>` from decoded keys, so these hold;
    // `make` stops the object if one doesn't.
    const [workspaceName, projectName] = (ctx.id.name ?? "").split("/")
    const workspace = WorkspaceKey.make(workspaceName ?? "")
    const project = ProjectKey.make(projectName ?? "")
    this.#storage = ctx.storage
    this.#activity = env.ACTIVITY
    this.#calls = new Map([...Object.entries(servedCalls(project)), ...servedModules(project)])
    this.#runtime = ManagedRuntime.make(
      Today.layer.pipe(
        Layer.provideMerge(Incidents.layer),
        Layer.provideMerge(Layer.mergeAll(Projects.layer({ project }), Signals.layer({ workspace, project }))),
        Layer.provideMerge(ActivityLog.layer({ workspace, project })),
        Layer.provide(webCryptoLayer(crypto)),
        Layer.provide(r2ArchiveLayer(env.ARCHIVE)),
        Layer.provide(FetchHttpClient.layer),
        Layer.provide(SqliteClient.layer({ storage: ctx.storage })),
        // In the runtime itself, so every call runs on it as the Worker's requests do. A scheduler
        // is a reference, so it doesn't show in the runtime's type.
        Layer.provideMerge(SyncScheduler),
      ),
    )
  }

  /**
   * Runs one of `projectCalls`, or a module's query: its input and answer are that call's encodings
   * as JSON text.
   */
  call(name: ProjectCallName, input: string): Promise<string> {
    const call = this.#calls.get(name)
    if (call === undefined) {
      // The Worker and its objects deploy together, so every name it sends is served.
      return Promise.reject(new Error(`A project's object serves no call named ${name}`))
    }
    const created = this.#storage.kv.get(projectCreated) === true
    if (call.beforeCreated !== undefined && !created) {
      return Effect.runPromise(call.beforeCreated)
    }
    if (!created) {
      this.#storage.kv.put(projectCreated, true)
    }
    return this.#runtime.runPromise(this.#watched.pipe(Effect.andThen(call.serve(input))))
  }

  /**
   * Runs the detectors, delivers the project's new activity, and looks again in a minute. The next
   * look is scheduled first, so a check or a delivery that fails is tried again then, not retried at
   * once by the platform; its failure is logged.
   */
  override alarm(): Promise<void> {
    const storage = this.#storage
    const activity = this.#activity
    return this.#runtime.runPromise(
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        yield* Effect.promise(() => storage.setAlarm(now + checkEvery))
        const incidents = yield* Incidents
        yield* incidents.check.pipe(Effect.catchCause((cause) => Effect.logError("The detectors' check failed", cause)))
        // What the check and the calls since committed goes to the queue; what the queue doesn't
        // take goes next time.
        const log = yield* ActivityLog
        yield* log
          .deliver((entries) => sendActivity(activity, entries))
          .pipe(Effect.catchCause((cause) => Effect.logError("Delivering activity failed", cause)))
      }),
    )
  }

  // Once a project exists, its detectors look every minute: the first call sets the alarm, which
  // then sets itself again. Projects made before the detectors start on their next call.
  get #watched() {
    const storage = this.#storage
    return Effect.gen(function* () {
      if ((yield* Effect.promise(() => storage.getAlarm())) !== null) {
        return
      }
      const now = yield* Clock.currentTimeMillis
      yield* Effect.promise(() => storage.setAlarm(now + checkEvery))
    })
  }
}
