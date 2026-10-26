import { CloudflareBindingLanguageModel, WorkersAiModel } from "@bagatka/ai-cloudflare-binding"
import { analyticsModule } from "@cluenori/analytics"
import type {
  ErrorSchema,
  ModuleAction,
  ModuleIngest,
  ModuleQuery,
  PlainSchema as QuerySchema,
} from "@cluenori/foundation"
import { ActivityLog, Period, ProjectKey, WorkspaceKey } from "@cluenori/foundation"
import type { GitHub } from "@cluenori/github"
import { gitHubAsApp } from "@cluenori/github-app"
import { Incidents } from "@cluenori/incidents"
import { IngestKeyRejected, ProjectNotFound, Projects } from "@cluenori/projects"
import type { ReleaseRecords, ReleaseSources } from "@cluenori/releases"
import { promotionItems, releasesLayer, releasesModule, versionPolicyFor } from "@cluenori/releases"
import { AppSignals, SdkKeyRejected, Signals } from "@cluenori/signals"
import { Today } from "@cluenori/today"
import { BrowserCrypto } from "@effect/platform-browser"
import { SqliteClient } from "@effect/sql-sqlite-do"
import { DurableObject } from "cloudflare:workers"
import type { Crypto } from "effect"
import {
  Clock,
  Config,
  ConfigProvider,
  DateTime,
  Duration,
  Effect,
  Exit,
  Layer,
  ManagedRuntime,
  Redacted,
  Schema,
} from "effect"
import type { LanguageModel } from "effect/ai"
import { FetchHttpClient } from "effect/http"

import { sendActivity } from "./activity-queue.ts"
import type { PlainSchema } from "./object-calls.ts"
import { exitText, serve } from "./object-calls.ts"
import type { EngineCallName, ProjectCall, ProjectCallName } from "./project-calls.ts"
import { moduleActionCall, moduleCall, moduleIngestCall, projectCalls } from "./project-calls.ts"
import { r2AppBatchLayer, r2ArchiveLayer } from "./r2-archive.ts"
import { SyncScheduler } from "./sync-scheduler.ts"
import { workspaceCalls } from "./workspace-calls.ts"
import { WorkspaceObjects } from "./workspace-objects.ts"

// The engines, the modules' own services, GitHub as the workspace's app, and the activity log, in
// each project's object.
type ProjectServices =
  | Projects
  | Signals
  | AppSignals
  | Incidents
  | Today
  | ReleaseRecords
  | ReleaseSources
  | GitHub
  | ActivityLog
  | Crypto.Crypto
  | LanguageModel.LanguageModel

// Where the Releases module reads and writes besides telemetry and GitHub, each absent until
// `./cluenori appstore setup` gives its key: one that reads, and one, `--manager`, that submits
// (PATTERNS.md, "Configuration").
const releasesSettings = Config.all({
  appStoreConnect: Config.option(
    Config.all({
      key: Config.Redacted("CLUENORI_ASC_KEY"),
      keyId: Config.String("CLUENORI_ASC_KEY_ID"),
      issuerId: Config.String("CLUENORI_ASC_ISSUER_ID"),
    }),
  ),
  appStoreConnectManager: Config.option(
    Config.all({
      key: Config.Redacted("CLUENORI_ASC_MANAGER_KEY"),
      keyId: Config.String("CLUENORI_ASC_MANAGER_KEY_ID"),
      issuerId: Config.String("CLUENORI_ASC_ISSUER_ID"),
    }),
  ),
})

// The Workers AI model the project's language model is, which drafts release notes.
const languageModelSetting = Config.schema(WorkersAiModel, "CLUENORI_AI_MODEL").pipe(
  Config.withDefault(WorkersAiModel.make("@cf/moonshotai/kimi-k2.6")),
)
// A draft's longest answer: release notes are at most 4000 characters, about 1000 tokens.
const draftTokens = 1500

// How often the detectors look: the object's alarm runs `Incidents.check` this often.
const checkEvery = Duration.toMillis(Duration.minutes(1))

// An SDK key the project doesn't have, a revoked one, or one for a project that doesn't exist: the
// same refusal, which tells an SDK to stop sending until its app is updated.
const sdkKeyRejected = new SdkKeyRejected({ message: "This SDK key isn't one of this deployment's, or was revoked." })

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
        const signals = yield* Signals
        const settings = yield* projects.settings
        const now = yield* DateTime.now
        const seen = yield* signals.environments(new Period({ from: DateTime.subtract(now, { days: 30 }), to: now }))
        // Production first, in the order the project chose, then the rest by name.
        const environments = [
          ...settings.productionEnvironments.filter((environment) => seen.includes(environment)),
          ...seen.filter((environment) => !settings.productionEnvironments.includes(environment)),
        ]
        return {
          project: yield* projects.project,
          components: yield* projects.components,
          settings,
          environments,
        }
      }),
    new ProjectNotFound({ project }),
  ),
  updateSettings: served(
    projectCalls.updateSettings,
    ({ actor, settings }) =>
      Effect.gen(function* () {
        const projects = yield* Projects
        return yield* projects.updateSettings(actor, settings)
      }),
    new ProjectNotFound({ project }),
  ),
  linkComponent: served(
    projectCalls.linkComponent,
    ({ actor, component, links }) =>
      Effect.gen(function* () {
        const projects = yield* Projects
        return yield* projects.linkComponent(actor, component, links)
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
  issueSdkKey: served(
    projectCalls.issueSdkKey,
    ({ actor, component }) =>
      Effect.gen(function* () {
        const projects = yield* Projects
        return yield* projects.issueSdkKey(actor, component)
      }),
    new ProjectNotFound({ project }),
  ),
  sdkKeys: served(
    projectCalls.sdkKeys,
    ({ component }) =>
      Effect.gen(function* () {
        const projects = yield* Projects
        return yield* projects.sdkKeys(component)
      }),
    new ProjectNotFound({ project }),
  ),
  revokeSdkKey: served(
    projectCalls.revokeSdkKey,
    ({ actor, component, key }) =>
      Effect.gen(function* () {
        const projects = yield* Projects
        return yield* projects.revokeSdkKey(actor, component, key)
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
  ingestAppBatch: served(
    projectCalls.ingestAppBatch,
    ({ key, country, batch }) =>
      Effect.gen(function* () {
        const projects = yield* Projects
        const apps = yield* AppSignals
        const component = yield* projects
          .authenticateSdkKey(key)
          .pipe(Effect.catchTag("SdkKeyNotFound", () => Effect.fail(sdkKeyRejected)))
        return yield* apps.record({ component, key, ...(country === undefined ? {} : { country }) }, batch)
      }),
    sdkKeyRejected,
  ),
  // The manifest's version policy, from the Releases module's; the Worker adds how long to keep it.
  appManifest: served(
    projectCalls.appManifest,
    ({ key, query }) =>
      Effect.gen(function* () {
        const projects = yield* Projects
        const component = yield* projects
          .authenticateSdkKey(key)
          .pipe(Effect.catchTag("SdkKeyNotFound", () => Effect.fail(sdkKeyRejected)))
        return yield* versionPolicyFor(component, query)
      }),
    sdkKeyRejected,
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
  logLine: served(
    projectCalls.logLine,
    (id) =>
      Effect.gen(function* () {
        const signals = yield* Signals
        return yield* signals.logLine(id)
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
  // Today's items and the project's pulse. Modules' Today detectors are composed here, each on its
  // own line beside the engines' items, until the module contract has its `today` part.
  today: served(
    projectCalls.today,
    () =>
      Effect.gen(function* () {
        const today = yield* Today
        const items = yield* today.items
        const promotions = yield* promotionItems
        const pulse = yield* today.pulse
        return { items: [...items, ...promotions], pulse }
      }),
    new ProjectNotFound({ project }),
  ),
})

// What the object uses of a module: its queries, its actions, its ingest writes, and its background
// work, each reading and writing the engines and the module's own services here.
interface ServedModule {
  readonly id: string
  readonly queries: Readonly<Record<string, ModuleQuery<QuerySchema, QuerySchema, ErrorSchema, ProjectServices>>>
  readonly actions: Readonly<Record<string, ModuleAction<QuerySchema, QuerySchema, ErrorSchema, ProjectServices>>>
  readonly ingest: Readonly<Record<string, ModuleIngest<QuerySchema, QuerySchema, ErrorSchema, ProjectServices>>>
  readonly background?: Effect.Effect<void, never, ProjectServices>
}

// The modules every project's object serves, each on a visible line.
const modules: ReadonlyArray<ServedModule> = [releasesModule, analyticsModule]

// Each module's queries, under `<module>.<query>`, its actions, under `<module>.action.<name>` for
// the actor who asks, and its ingest writes, under `<module>.ingest.<name>` for the component whose
// ingest key comes with them.
const servedModules = (project: ProjectKey) =>
  modules.flatMap((module) => [
    ...Object.entries(module.queries).map(([name, query]) => {
      const call = moduleCall(module, name)
      const entry: readonly [ProjectCallName, Served] = [
        call.name,
        served(call, (input) => query.run(input), new ProjectNotFound({ project })),
      ]
      return entry
    }),
    ...Object.entries(module.actions).map(([name, action]) => {
      const call = moduleActionCall(module, name)
      const entry: readonly [ProjectCallName, Served] = [
        call.name,
        served(call, ({ actor, input }) => action.run(actor, input), new ProjectNotFound({ project })),
      ]
      return entry
    }),
    ...Object.entries(module.ingest).map(([name, ingest]) => {
      const call = moduleIngestCall(module, name)
      const entry: readonly [ProjectCallName, Served] = [
        call.name,
        served(
          call,
          ({ ingestKey, input }) =>
            Effect.gen(function* () {
              const projects = yield* Projects
              const component = yield* projects.authenticate(Redacted.make(ingestKey))
              return yield* ingest.run(component, input)
            }),
          new IngestKeyRejected(),
        ),
      ]
      return entry
    }),
  ])

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
        Layer.provideMerge(
          Layer.mergeAll(
            Projects.layer({ project }),
            Signals.layer({ workspace, project }),
            AppSignals.layer({ workspace, project }),
          ),
        ),
        // Each module's own services, on its own line, from the settings this host reads.
        Layer.provideMerge(
          Layer.unwrap(
            Effect.map(releasesSettings, (settings) => releasesLayer({ ...settings, signing: crypto.subtle })),
          ).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))), Layer.orDie),
        ),
        Layer.provideMerge(ActivityLog.layer({ workspace, project })),
        // The project's language model, on the Worker's Workers AI binding.
        Layer.provideMerge(
          Layer.unwrap(
            Effect.map(languageModelSetting, (model) =>
              CloudflareBindingLanguageModel.layer({ binding: env.AI, model, config: { max_tokens: draftTokens } }),
            ),
          ).pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))), Layer.orDie),
        ),
        // GitHub, as the workspace's app: each repository's token comes from the workspace's object,
        // which keeps the app's key.
        Layer.provideMerge(
          Layer.unwrap(
            Effect.gen(function* () {
              const objects = yield* WorkspaceObjects
              return gitHubAsApp((repository) =>
                objects
                  .call(workspaceCalls.gitHubToken, repository)
                  .pipe(Effect.map(({ token, expiresAt }) => ({ token: Redacted.make(token), expiresAt }))),
              )
            }),
          ).pipe(
            Layer.provide(
              WorkspaceObjects.layerInJurisdiction(env.WORKSPACE, workspace).pipe(
                Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
                Layer.orDie,
              ),
            ),
          ),
        ),
        Layer.provideMerge(BrowserCrypto.layer),
        Layer.provide(r2ArchiveLayer(env.ARCHIVE)),
        Layer.provide(r2AppBatchLayer(env.APP_BATCHES)),
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
        // Each module's background work; one that fails doesn't hold up the others or the delivery.
        for (const module of modules) {
          if (module.background !== undefined) {
            yield* module.background.pipe(
              Effect.catchCause((cause) => Effect.logError(`The ${module.id} module's background work failed`, cause)),
            )
          }
        }
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
