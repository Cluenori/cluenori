import {
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  InstallationId,
  ProjectKey,
  ReleaseVersion,
  SessionId,
} from "@cluenori/foundation"
import { MonitorUrl } from "@cluenori/incidents"
import type { SdkKey } from "@cluenori/projects"
import { ComponentName, ProjectName } from "@cluenori/projects"
import { SemanticVersion } from "@cluenori/releases"
import type { AppBatch } from "@cluenori/signals"
import type { ArchiveUnavailable } from "@cluenori/signals"
import { AppSignalId, AppUserId, ArchiveStore } from "@cluenori/signals"
import { CluenoriIngestApi, SdkKeyAuthorization } from "@cluenori/worker"
import { assert, layer } from "@effect/vitest"
import { runDurableObjectAlarm } from "cloudflare:test"
import { env } from "cloudflare:workers"
import { DateTime, Deferred, Effect, Fiber, Option } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient, HttpApiMiddleware } from "effect/http-api"

import { r2ArchiveLayer } from "../../../apps/worker/src/r2-archive.ts"
import { baseUrl, CluenoriClient } from "./cluenori-client.ts"
import { logExport, traceExport } from "./trace-export.ts"

const project = ProjectKey.make("reset-journey")
const api = ComponentKey.make("notes-api")
const ios = ComponentKey.make("notes-ios")
const service = { name: "notes-api", environment: "production", version: "0.1.0+1" }
const prefix = `main/${project}/`

// A UUIDv7 made at `millis`, the `n`th.
const uuidAt = (millis: number, n: number) => {
  const time = Math.floor(millis).toString(16).padStart(12, "0")
  return `${time.slice(0, 8)}-${time.slice(8)}-7000-8000-${n.toString(16).padStart(12, "0")}`
}

// What the app's SDK sends: a session's start and an event, at `at`.
const batchOf = (at: number, n: number): AppBatch => {
  const session = SessionId.make(uuidAt(at, n * 10))
  const user = AppUserId.make("u-1")
  return {
    installation: InstallationId.make(uuidAt(at - 86_400_000, 1)),
    environment: EnvironmentKey.make("production"),
    release: ReleaseVersion.make("0.2.0+1"),
    device: { model: "iPhone17,2", platform: "iOS", osVersion: "27.2", locale: "uk-UA", timeZone: "Europe/Kyiv" },
    sdk: { name: "cluenori-swift", version: "0.1.0" },
    sentAt: DateTime.makeUnsafe(at + 1000),
    signals: [
      {
        _tag: "session.started",
        id: AppSignalId.make(uuidAt(at, n * 10 + 1)),
        at: DateTime.makeUnsafe(at),
        session,
        user,
      },
      {
        _tag: "event",
        id: AppSignalId.make(uuidAt(at, n * 10 + 2)),
        at: DateTime.makeUnsafe(at),
        session,
        user,
        name: EnvelopeName.make("card.flipped"),
      },
    ],
  }
}

// The ingest API's client, as an app's SDK calls it with its key.
const ingestClient = (key: SdkKey) =>
  HttpApiClient.make(CluenoriIngestApi, { baseUrl }).pipe(
    Effect.provide(
      HttpApiMiddleware.layerClient(SdkKeyAuthorization, ({ next, request }) =>
        next(HttpClientRequest.bearerToken(request, key)),
      ),
    ),
  )

// A POST of `body` with a component's ingest key: an OTLP export, or what `cluenori-release` sends.
const post = Effect.fn("post")(function* (path: string, ingestKey: string, body: Uint8Array | object) {
  const http = yield* HttpClient.HttpClient
  const request = HttpClientRequest.post(`${baseUrl}${path}`).pipe(HttpClientRequest.bearerToken(ingestKey))
  const response = yield* http.execute(
    body instanceof Uint8Array
      ? HttpClientRequest.bodyUint8Array(request, body, "application/x-protobuf")
      : HttpClientRequest.bodyJsonUnsafe(request, body),
  )
  return { status: response.status, text: yield* response.text }
})

// Five runs of an operation, from `start`.
const spans = (start: number) =>
  Array.from({ length: 5 }, (_, n) => ({
    name: "GET /api/notes",
    kind: "server" as const,
    startMillis: start + n,
    durationMillis: 20,
  }))

// The keys of the project's files in a bucket.
const filesIn = (bucket: R2Bucket) =>
  Effect.promise(() => bucket.list({ prefix })).pipe(Effect.map((listed) => listed.objects.map((each) => each.key)))

// Real time: the Worker counts operations by the time they started, against its own clock.
layer(CluenoriClient.layer, { excludeTestServices: true })("reset", (it) => {
  it.effect(
    "an owner resets a project: its data goes for good, its configuration stays, and what comes after counts once",
    () =>
      Effect.gen(function* () {
        const client = yield* CluenoriClient
        // The project's configuration: two components, their keys, a monitor, and a version line.
        yield* client.projects.createProject({ payload: { key: project, name: ProjectName.make("Notes") } })
        const { ingestKey } = yield* client.projects.addComponent({
          params: { project },
          payload: { key: api, name: ComponentName.make("Notes API") },
        })
        yield* client.projects.addComponent({
          params: { project },
          payload: { key: ios, name: ComponentName.make("Notes") },
        })
        const sdkKey = yield* client.projects.issueSdkKey({ params: { project, component: ios } })
        yield* client.incidents.addMonitor({
          params: { project },
          payload: {
            component: api,
            condition: {
              _tag: "noAnswer",
              subject: { _tag: "url", url: MonitorUrl.make("https://notes-api.invalid/health") },
            },
            level: "alarm",
          },
        })
        yield* client.releases.setVersion({
          params: { project, component: api },
          payload: { version: SemanticVersion.make("0.1.0") },
        })

        // Its data: operations, an error, an app's batch, a numbered commit and its deploy.
        const now = DateTime.toEpochMillis(yield* DateTime.now)
        const query = { from: DateTime.makeUnsafe(now - 3_600_000), to: DateTime.makeUnsafe(now + 3_600_000) }
        const oldTraces = traceExport(service, spans(now - 120_000))
        const oldLogs = logExport(service, [
          {
            timeMillis: now - 60_000,
            severity: 17,
            category: "Notes.Exports",
            message: "Export failed",
            exception: { type: "TimeoutException", message: "No answer", stack: "at Notes.Exports.Run()" },
          },
        ])
        const oldBatch = batchOf(now - 60_000, 1)
        const ingest = yield* ingestClient(sdkKey.key)
        const commit = "a".repeat(40)
        assert.deepStrictEqual(
          [
            (yield* post("/otlp/v1/traces", ingestKey, oldTraces)).status,
            (yield* post("/otlp/v1/logs", ingestKey, oldLogs)).status,
          ],
          [200, 200],
        )
        yield* ingest.appIngest.sendBatch({ payload: oldBatch })
        const numbered = yield* post("/ingest/v1/releases/number", ingestKey, { commit })
        assert.include(numbered.text, '"release":"0.1.0+1"')
        const reported = yield* post("/ingest/v1/releases/report", ingestKey, {
          release: "0.1.0+1",
          environment: "production",
          commit,
        })
        assert.strictEqual(reported.status, 204)

        const before = {
          operations: (yield* client.signals.operations({ params: { project }, query })).count,
          errors: (yield* client.signals.errors({ params: { project }, query })).groups.length,
          releases: (yield* client.releases.releases({ params: { project }, query })).releases.length,
          people: (yield* client.analytics.usage({ params: { project }, query })).people,
        }
        assert.deepStrictEqual(before, { operations: 5, errors: 1, releases: 1, people: 1 })
        const archivedBefore = yield* filesIn(env.ARCHIVE)
        const batchesBefore = yield* filesIn(env.APP_BATCHES)
        assert.lengthOf(archivedBefore, 2)
        assert.lengthOf(batchesBefore, 1)

        // The owner resets it.
        const reset = yield* client.projects.resetProject({ params: { project } })
        assert.strictEqual(reset.key, project)
        assert.isDefined(reset.resetAt)
        assert.deepStrictEqual((yield* client.projects.project({ params: { project } })).project, reset)

        // Its data is gone.
        const gone = {
          operations: (yield* client.signals.operations({ params: { project }, query })).count,
          errors: (yield* client.signals.errors({ params: { project }, query })).groups.length,
          logs: (yield* client.signals.logs({ params: { project }, query })).lines.length,
          releases: (yield* client.releases.releases({ params: { project }, query })).releases.length,
          people: (yield* client.analytics.usage({ params: { project }, query })).people,
          incidents: (yield* client.incidents.incidents({ params: { project } })).open.length,
        }
        assert.deepStrictEqual(gone, { operations: 0, errors: 0, logs: 0, releases: 0, people: 0, incidents: 0 })

        // Its configuration stays: components, keys, the monitor, and the version line, whose numbers
        // go on, so the commit numbered before gets the next.
        const detail = yield* client.projects.project({ params: { project } })
        const kept = {
          components: detail.components.map((each) => each.key),
          ingestKeys: (yield* client.projects.ingestKeys({ params: { project, component: api } })).keys.length,
          sdkKeys: (yield* client.projects.sdkKeys({ params: { project, component: ios } })).keys.map(
            (each) => each.key,
          ),
          monitors: (yield* client.incidents.monitors({ params: { project } })).monitors.length,
          versions: (yield* client.releases.versions({ params: { project } })).versions.map((each) => [
            each.version,
            each.lastBuild,
          ]),
        }
        assert.deepStrictEqual(kept, {
          components: [api, ios],
          ingestKeys: 1,
          sdkKeys: [sdkKey.key],
          monitors: 1,
          versions: [[SemanticVersion.make("0.1.0"), 1]],
        })
        const renumbered = yield* post("/ingest/v1/releases/number", ingestKey, { commit })
        assert.include(renumbered.text, '"release":"0.1.0+2"')

        // What was sent before, sent again, isn't counted; what is new counts once.
        assert.strictEqual((yield* post("/otlp/v1/traces", ingestKey, oldTraces)).status, 200)
        const resent = yield* ingest.appIngest.sendBatch({ payload: oldBatch })
        const later = DateTime.toEpochMillis(yield* DateTime.now)
        assert.strictEqual((yield* post("/otlp/v1/traces", ingestKey, traceExport(service, spans(later)))).status, 200)
        const fresh = yield* ingest.appIngest.sendBatch({ payload: batchOf(later, 2) })
        assert.deepStrictEqual(
          [resent, fresh],
          [
            { accepted: 0, duplicates: 2 },
            { accepted: 2, duplicates: 0 },
          ],
        )
        assert.strictEqual((yield* client.signals.operations({ params: { project }, query })).count, 5)
        assert.strictEqual((yield* client.analytics.usage({ params: { project }, query })).sessions, 1)

        // On the project's alarm, the files in R2 from before the reset go; those since stay.
        assert.isTrue(yield* Effect.promise(() => runDurableObjectAlarm(env.PROJECT.getByName(`main/${project}`))))
        const archivedAfter = yield* filesIn(env.ARCHIVE)
        const batchesAfter = yield* filesIn(env.APP_BATCHES)
        assert.lengthOf(archivedAfter, 1)
        assert.lengthOf(batchesAfter, 1)
        assert.notInclude(archivedBefore, archivedAfter[0])
        assert.notInclude(batchesBefore, batchesAfter[0])
      }),
  )

  // R2 deletes without a condition, so a file written again between a purge's listing and its delete
  // would go too: an export retried just after the reset, under the same key, must stay.
  it.effect("a purge keeps a file written again while it lists", () =>
    Effect.gen(function* () {
      const bucket = env.ARCHIVE
      const key = "main/reset-race/traces/2026-10-27/notes-api/retried.otlp"
      const old = yield* Effect.promise(() => bucket.put(key, "written before the reset"))
      assert.isNotNull(old)
      const before = (old?.uploaded.getTime() ?? 0) + 1
      yield* Effect.sleep("20 millis")
      const held: { store?: ArchiveStore["Service"] } = {}
      const written = yield* Deferred.make<void, ArchiveUnavailable>()
      const context = yield* Effect.context()
      const writtenWhileListing: R2Bucket = {
        head: bucket.head.bind(bucket),
        get: bucket.get.bind(bucket),
        put: bucket.put.bind(bucket),
        createMultipartUpload: bucket.createMultipartUpload.bind(bucket),
        resumeMultipartUpload: bucket.resumeMultipartUpload.bind(bucket),
        delete: bucket.delete.bind(bucket),
        list: (options) =>
          Effect.runPromiseWith(context)(
            Effect.gen(function* () {
              const listed = yield* Effect.promise(() => bucket.list(options))
              if (held.store !== undefined) {
                Effect.runForkWith(context)(
                  Deferred.into(held.store.put(key, new TextEncoder().encode("written after it")), written),
                )
              }
              // Long enough for the write to finish, were it not held back.
              yield* Effect.sleep("50 millis")
              return listed
            }),
          ),
      }
      const store = yield* ArchiveStore.pipe(Effect.provide(r2ArchiveLayer(writtenWhileListing)))
      held.store = store
      yield* store.deleteBefore("main/reset-race/", before, undefined)
      yield* Deferred.await(written)
      const kept = yield* Effect.promise(() => bucket.head(key))
      assert.isNotNull(kept)
      assert.isAtLeast(kept?.uploaded.getTime() ?? 0, before)
    }),
  )

  // A semaphore lets a smaller later request overtake a larger one waiting: writes that keep
  // overlapping, one starting before the last ends, must not hold a waiting page off for good.
  it.effect("a purge waiting for writes holds back the writes after it", () =>
    Effect.gen(function* () {
      const bucket = env.ARCHIVE
      const context = yield* Effect.context()
      const gates = new Map<string, { started: Deferred.Deferred<void>; finish: Deferred.Deferred<void> }>()
      let writesStarted = 0
      let writesWhenListed = -1
      const instrumented = new Proxy(bucket, {
        get(target, property) {
          if (property === "put") {
            return (key: string, value: Parameters<R2Bucket["put"]>[1], options?: R2PutOptions) =>
              Effect.runPromiseWith(context)(
                Effect.gen(function* () {
                  const gate = gates.get(key)
                  if (gate !== undefined) {
                    writesStarted++
                    yield* Deferred.succeed(gate.started, undefined)
                    yield* Deferred.await(gate.finish)
                  }
                  return yield* Effect.promise(() => target.put(key, value, options))
                }),
              )
          }
          if (property === "list") {
            return (options?: R2ListOptions) => {
              writesWhenListed = writesStarted
              return target.list(options)
            }
          }
          const value = Reflect.get(target, property, target)
          return typeof value === "function" ? value.bind(target) : value
        },
      })
      const store = yield* ArchiveStore.pipe(Effect.provide(r2ArchiveLayer(instrumented)))
      const startWrite = Effect.fnUntraced(function* (n: number) {
        const key = `main/reset-starvation/${n}.otlp`
        const started = yield* Deferred.make<void>()
        const finish = yield* Deferred.make<void>()
        gates.set(key, { started, finish })
        const fiber = yield* store.put(key, new Uint8Array([n])).pipe(Effect.forkChild)
        return { fiber, started, finish }
      })
      let previous = yield* startWrite(0)
      yield* Deferred.await(previous.started)
      const cutoff = DateTime.toEpochMillis(yield* DateTime.now)
      const purge = yield* store.deleteBefore("main/reset-starvation/", cutoff, undefined).pipe(Effect.forkChild)
      yield* Effect.sleep("20 millis")
      let overtakes = 0
      for (let n = 1; n <= 25; n++) {
        const next = yield* startWrite(n)
        const admitted = yield* Deferred.await(next.started).pipe(Effect.timeoutOption("50 millis"))
        if (Option.isSome(admitted) && writesWhenListed === -1) overtakes++
        yield* Deferred.succeed(previous.finish, undefined)
        yield* Fiber.join(previous.fiber)
        yield* Deferred.await(next.started)
        previous = next
      }
      yield* Deferred.succeed(previous.finish, undefined)
      yield* Fiber.join(previous.fiber)
      yield* Fiber.join(purge)
      assert.strictEqual(overtakes, 0)
      assert.strictEqual(writesWhenListed, 1)
    }),
  )
})
