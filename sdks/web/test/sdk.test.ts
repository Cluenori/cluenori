import { assert, describe, it } from "@effect/vitest"
import { Deferred, Effect, Schema } from "effect"

import { makeEngine } from "../src/engine.ts"
import type { AppEvents, Cluenori, KeptStore, Runtime } from "../src/index.ts"
import { telemetryChoice, telemetryNotice } from "../src/index.ts"

// The SDK driven through its contract, against a fake deployment at `fetch` and a clock the test
// moves. Its batches' shape is the contract's by the compiler (src/wire.ts); the apps journey sends
// them to the real Worker.

const key = "cluenori-sdk.notes.notes-web.R2d2C3poBb8Wq0Lk5Xz7Aa"
const deployment = "https://cluenori.example.com"

const Batch = Schema.fromJsonString(
  Schema.Struct({
    installation: Schema.String,
    environment: Schema.String,
    release: Schema.String,
    sdk: Schema.Struct({ name: Schema.String, version: Schema.String }),
    device: Schema.Struct({ platform: Schema.String, model: Schema.String }),
    signals: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  }),
)
type Batch = typeof Batch.Type

/** A deployment that answers each batch as the test says, and keeps what reached it. */
const fakeDeployment = () => {
  const received: Array<{ readonly batch: Batch; readonly status: number; readonly authorization: string }> = []
  let answer = (batch: Batch): { status: number; body: string } => acknowledged(batch)
  let held = Deferred.makeUnsafe<void>()
  Deferred.doneUnsafe(held, Effect.void)
  const fetch: typeof globalThis.fetch = (input, init) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const request = new Request(input, init)
        const text = yield* Effect.promise(() => request.text())
        yield* Deferred.await(held)
        const batch = yield* Schema.decodeEffect(Batch)(text).pipe(Effect.orDie)
        const { status, body } = answer(batch)
        received.push({ batch, status, authorization: request.headers.get("authorization") ?? "" })
        return new Response(body, { status })
      }),
    )
  return {
    fetch,
    received,
    answer: (next: (batch: Batch) => { status: number; body: string }) => {
      answer = next
    },
    /** Answers nothing until the function returned is called. */
    hold: () => {
      const gate = Deferred.makeUnsafe<void>()
      held = gate
      return () => Deferred.doneUnsafe(gate, Effect.void)
    },
    taken: () => received.filter((each) => each.status === 200).flatMap((each) => each.batch.signals),
  }
}

/** The deployment's answer to a batch it has. */
const acknowledged = (batch: Batch) => ({
  status: 200,
  body: JSON.stringify({ accepted: batch.signals.length, duplicates: 0 }),
})

const memoryStore = (): KeptStore & { readonly texts: Map<string, string> } => {
  const texts = new Map<string, string>()
  return {
    texts,
    read: (name) => texts.get(name),
    write: (name, text) => (text === undefined ? texts.delete(name) : texts.set(name, text)),
  }
}

/** One installation: its store, its deployment, a clock, and the app's events to play. */
const world = () => {
  const store = memoryStore()
  const server = fakeDeployment()
  let time = Date.UTC(2026, 9, 27, 12)
  let events: AppEvents | undefined
  const runtime: Runtime = {
    store,
    device: () => ({
      platform: "web",
      model: "Firefox 141",
      osVersion: "unknown",
      locale: "uk-UA",
      timeZone: "Europe/Kyiv",
    }),
    visible: () => true,
    attach: (attached) => {
      events = attached
      return () => undefined
    },
  }
  const launch = (release = "1.4.0+52") =>
    makeEngine(
      { key, environment: "production", deployment, release, runtime },
      { fetch: server.fetch, now: () => time, schedules: false },
    )
  return {
    store,
    server,
    launch,
    advance: (ms: number) => {
      time += ms
    },
    app: () => {
      assert.isDefined(events)
      return (
        events ?? {
          foreground: () => undefined,
          background: () => undefined,
          hang: () => undefined,
          crash: () => undefined,
        }
      )
    },
  }
}

const flushed = (cluenori: Cluenori) => Effect.promise(() => cluenori.flush())
// What the deployment counted: each signal once, by its ID, as a batch sent twice is counted once.
const unique = (signals: ReadonlyArray<Readonly<Record<string, unknown>>>) =>
  signals.filter((signal, index) => signals.findIndex((other) => other["id"] === signal["id"]) === index)
const kinds = (signals: ReadonlyArray<Readonly<Record<string, unknown>>>) => signals.map((signal) => signal["_tag"])

describe("@cluenori/sdk", () => {
  it.effect(
    "records a session, screens with their readiness and visit, events in their feature, and sends them as one batch",
    () =>
      Effect.gen(function* () {
        const w = world()
        const cluenori = w.launch()
        cluenori.identify("u_1")
        cluenori.screen("feed")
        w.advance(120)
        cluenori.screenReady("kept")
        w.advance(380)
        cluenori.screenReady("fresh")
        cluenori.screenReady("fresh")
        const mark = cluenori.begin("cards.flip")
        cluenori.track("card.flipped", { side: "back", Bad: 1 })
        mark.end()
        w.advance(1_500)
        cluenori.screen("card")
        yield* flushed(cluenori)

        assert.strictEqual(w.server.received.length, 1)
        const [sent] = w.server.received
        assert.strictEqual(sent?.authorization, `Bearer ${key}`)
        assert.strictEqual(sent?.batch.sdk.name, "cluenori-js")
        assert.strictEqual(sent?.batch.release, "1.4.0+52")
        const signals = w.server.taken()
        assert.deepStrictEqual(kinds(signals), [
          "session.started",
          "screen",
          "screen.ready",
          "screen.ready",
          "event",
          "screen.left",
          "screen",
        ])
        const [, feed, kept, fresh, event, left] = signals
        assert.include(kept, { screen: "feed", visit: feed?.["id"], content: "kept", ms: 120, user: "u_1" })
        assert.include(fresh, { content: "fresh", ms: 500 })
        assert.include(event, { name: "card.flipped", feature: "cards.flip", screen: "feed" })
        assert.deepStrictEqual(event?.["properties"], { side: "back" })
        assert.include(left, { screen: "feed", visit: feed?.["id"], visibleMs: 2_000 })
      }),
  )

  it.effect("N signals in make N signals out, in bounded requests, whatever delivery meets", () =>
    Effect.gen(function* () {
      const w = world()
      const cluenori = w.launch()
      const n = 900
      for (let index = 0; index < n; index++) {
        cluenori.track("note.saved", { index })
      }
      // The deployment fails, then is too busy, then takes a batch only in halves.
      w.server.answer(() => ({ status: 503, body: "" }))
      yield* flushed(cluenori)
      w.server.answer(() => ({ status: 429, body: '{"_tag":"TooManySignals","retryAfterSeconds":1}' }))
      const failed = w.server.received.length
      assert.strictEqual(failed, 1)
      w.server.answer((batch) => (batch.signals.length > 250 ? { status: 413, body: "" } : acknowledged(batch)))
      // Each flush tries once more when the wait is over.
      for (let round = 0; round < 20 && w.server.taken().length < n + 1; round++) {
        w.advance(5_000)
        yield* flushed(cluenori)
      }
      const taken = w.server.taken()
      assert.strictEqual(taken.length, n + 1)
      assert.deepStrictEqual(new Set(kinds(taken)), new Set(["session.started", "event"]))
      assert.strictEqual(new Set(taken.map((signal) => signal["id"])).size, n + 1)
      // A batch of 500, refused, then halves of 250 and the rest: never one request per signal.
      assert.isAtMost(w.server.received.length, 10)
    }),
  )

  it.effect("a refused key stops sending for this release, for good, and a new release tries again", () =>
    Effect.gen(function* () {
      const w = world()
      w.server.answer(() => ({ status: 401, body: '{"_tag":"SdkKeyRejected","message":"No."}' }))
      const first = w.launch()
      first.track("a")
      yield* flushed(first)
      first.track("b")
      yield* flushed(first)
      assert.strictEqual(w.server.received.length, 1)
      yield* Effect.promise(() => first.shutdown())

      w.server.answer(acknowledged)
      const again = w.launch()
      again.track("c")
      yield* flushed(again)
      assert.strictEqual(w.server.received.length, 1)
      yield* Effect.promise(() => again.shutdown())

      const updated = w.launch("1.5.0+60")
      updated.track("d")
      yield* flushed(updated)
      assert.deepStrictEqual(kinds(w.server.taken()), ["session.started", "event"])
    }),
  )

  it.effect("a page loaded again within 30 s goes on with its session; later, the old one ends with its time", () =>
    Effect.gen(function* () {
      const w = world()
      const first = w.launch()
      w.advance(10_000)
      w.app().background()
      w.advance(5_000)
      const second = w.launch()
      yield* flushed(second)
      assert.deepStrictEqual(kinds(unique(w.server.taken())), ["session.started"])

      w.app().background()
      w.advance(60_000)
      const third = w.launch()
      yield* flushed(third)
      const signals = unique(w.server.taken())
      assert.deepStrictEqual(kinds(signals), ["session.started", "session.ended", "session.started"])
      assert.include(signals[1], { foregroundMs: 10_000, session: signals[0]?.["session"] })
      assert.notStrictEqual(signals[2]?.["session"], signals[0]?.["session"])
      assert.isDefined(first)
    }),
  )

  it.effect("consent withdrawn drops what waits and records nothing more", () =>
    Effect.gen(function* () {
      const w = world()
      const cluenori = w.launch()
      cluenori.track("a")
      cluenori.consent("none")
      cluenori.track("b")
      cluenori.error(new TypeError("x"))
      yield* flushed(cluenori)
      assert.strictEqual(w.server.received.length, 0)
      cluenori.consent("full")
      cluenori.track("c")
      yield* flushed(cluenori)
      assert.deepStrictEqual(kinds(w.server.taken()), ["session.started", "event"])
    }),
  )

  it.effect("records errors, crashes, hangs and timings with the screen they happened on", () =>
    Effect.gen(function* () {
      const w = world()
      const cluenori = w.launch()
      cluenori.screen("export")
      cluenori.error(new RangeError("too far"))
      w.app().crash(new TypeError("undefined is not a function"))
      w.app().hang(612.4)
      const timing = cluenori.timing("export.render")
      w.advance(840)
      timing.end()
      timing.end()
      yield* flushed(cluenori)
      const [, , handled, crash, hang, measured] = w.server.taken()
      assert.include(handled, {
        _tag: "error",
        type: "RangeError",
        message: "too far",
        handled: true,
        screen: "export",
      })
      assert.include(crash, { _tag: "error", type: "TypeError", handled: false })
      assert.include(hang, { _tag: "app.hang", ms: 612 })
      assert.include(measured, { _tag: "timing", name: "export.render", ms: 840 })
      assert.strictEqual(w.server.taken().length, 6)
    }),
  )

  it.effect("headers carry the feature, the component and release the trace starts in, after the request's own", () =>
    Effect.gen(function* () {
      const w = world()
      const cluenori = w.launch()
      const mark = cluenori.begin("editor.export")
      const headers = cluenori.headers({
        Baggage: "tenant=a,cluenori.feature=old",
        Authorization: "Bearer app-token",
        "cluenori-release": "0.0.1+1",
      })
      mark.end()
      // The request's own headers stay; the release and baggage are the SDK's, under one name each.
      assert.strictEqual(headers["Authorization"], "Bearer app-token")
      assert.deepStrictEqual(Object.keys(headers).toSorted(), [
        "Authorization",
        "Cluenori-Release",
        "baggage",
        "traceparent",
      ])
      assert.strictEqual(headers["Cluenori-Release"], "1.4.0+52")
      assert.match(headers["traceparent"] ?? "", /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
      assert.strictEqual(
        headers["baggage"],
        "tenant=a,cluenori.feature=editor.export,cluenori.origin.component=notes-web,cluenori.origin.release=1.4.0+52",
      )
      const traced = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
      const kept = cluenori.headers({ Traceparent: traced, "content-type": "application/json" })
      assert.deepStrictEqual([kept["Traceparent"], kept["traceparent"]], [traced, undefined])
      assert.strictEqual(kept["content-type"], "application/json")
      yield* Effect.void
    }),
  )

  it.effect("a program's run is its session, and shutdown sends its end", () =>
    Effect.gen(function* () {
      const w = world()
      const cluenori = w.launch()
      cluenori.screen("project create")
      w.advance(2_000)
      yield* Effect.promise(() => cluenori.shutdown())
      cluenori.track("after")
      assert.deepStrictEqual(kinds(w.server.taken()), ["session.started", "screen", "screen.left", "session.ended"])
      assert.include(w.server.taken()[3], { foregroundMs: 2_000 })
    }),
  )

  it.effect("options that aren't valid start nothing, and the app carries on", () =>
    Effect.gen(function* () {
      const w = world()
      const cluenori = makeEngine(
        { key: "not-a-key", environment: "production", deployment, release: "1.0.0+1", runtime: runtimeOf(w) },
        { fetch: w.server.fetch, schedules: false },
      )
      cluenori.track("a")
      yield* flushed(cluenori)
      // Keys shaped like an SDK key that the deployment wouldn't take: an ID not of 22 base64url
      // characters, or a component over 40.
      for (const malformed of [
        "cluenori-sdk.notes.notes-web.!",
        "cluenori-sdk.notes.notes-web.R2d2C3poBb8Wq0Lk5Xz7A",
        `cluenori-sdk.notes.${"c".repeat(41)}.R2d2C3poBb8Wq0Lk5Xz7Aa`,
      ]) {
        const started = makeEngine(
          { key: malformed, environment: "production", deployment, release: "1.0.0+1", runtime: runtimeOf(w) },
          { fetch: w.server.fetch, schedules: false },
        )
        started.track("a")
        yield* flushed(started)
      }
      assert.strictEqual(w.server.received.length, 0)
    }),
  )

  it.effect("deliveries asked for at once send each signal, and what was recorded meanwhile is sent too", () =>
    Effect.gen(function* () {
      const w = world()
      const cluenori = w.launch()
      cluenori.track("before")
      const release = w.server.hold()
      const first = cluenori.flush()
      const second = cluenori.flush()
      cluenori.track("after")
      release()
      yield* Effect.promise(() => Promise.all([first, second]))
      yield* flushed(cluenori)
      const names = w.server.taken().map((signal) => signal["name"] ?? signal["_tag"])
      assert.deepStrictEqual(names, ["session.started", "before", "after"])
    }),
  )

  it.effect(
    "an answer that isn't the deployment's, such as a captive portal's page, keeps the batch to send again",
    () =>
      Effect.gen(function* () {
        const w = world()
        const cluenori = w.launch()
        cluenori.track("a")
        w.server.answer(() => ({ status: 200, body: "<html>Sign in to the Wi-Fi</html>" }))
        yield* flushed(cluenori)
        w.server.answer(acknowledged)
        w.advance(10_000)
        yield* flushed(cluenori)
        assert.strictEqual(w.server.received.length, 2)
        assert.deepStrictEqual(kinds(w.server.received[1]?.batch.signals ?? []), ["session.started", "event"])
      }),
  )

  it.live("what is recorded is kept between runs once the app's task is done, without a flush", () =>
    Effect.gen(function* () {
      const w = world()
      w.server.answer(() => ({ status: 503, body: "" }))
      const cluenori = w.launch()
      cluenori.track("saved")
      yield* Effect.sleep("10 millis")
      // The page is closed, or the program killed, here; the next run sends it.
      w.server.answer(acknowledged)
      const next = w.launch()
      yield* flushed(next)
      assert.deepStrictEqual(kinds(w.server.taken()).slice(0, 2), ["session.started", "event"])
      assert.isDefined(cluenori)
    }),
  )

  it.effect("a store that throws, as a page refused localStorage, keeps nothing and the app carries on", () =>
    Effect.gen(function* () {
      const w = world()
      const denied: KeptStore = {
        read: () => {
          throw new DOMException("Access is denied", "SecurityError")
        },
        write: () => {
          throw new DOMException("Access is denied", "SecurityError")
        },
      }
      const cluenori = makeEngine(
        { key, environment: "production", deployment, release: "1.0.0+1", runtime: { ...runtimeOf(w), store: denied } },
        { fetch: w.server.fetch, schedules: false },
      )
      cluenori.track("a")
      yield* flushed(cluenori)
      assert.deepStrictEqual(kinds(w.server.taken()), ["session.started", "event"])
    }),
  )

  it("a CLI's telemetry is off by DO_NOT_TRACK or its own setting, and says where it goes", () => {
    assert.deepStrictEqual(telemetryChoice({}), { _tag: "On" })
    assert.deepStrictEqual(telemetryChoice({ DO_NOT_TRACK: "1" }), { _tag: "Off", because: "DO_NOT_TRACK" })
    assert.deepStrictEqual(telemetryChoice({ DO_NOT_TRACK: "0" }), { _tag: "On" })
    assert.deepStrictEqual(telemetryChoice({ CLUENORI_TELEMETRY: " OFF " }), {
      _tag: "Off",
      because: "CLUENORI_TELEMETRY",
    })
    assert.deepStrictEqual(telemetryChoice({ CLUENORI_TELEMETRY: "on" }), { _tag: "On" })
    assert.include(
      telemetryNotice("cluenori", "https://cluenori.example.com/api"),
      "https://cluenori.example.com, the Cluenori",
    )
  })
})

const runtimeOf = (w: ReturnType<typeof world>): Runtime => ({
  store: w.store,
  device: () => ({ platform: "web", model: "x", osVersion: "x", locale: "en", timeZone: "UTC" }),
  visible: () => true,
  attach: () => () => undefined,
})
