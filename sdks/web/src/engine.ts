import { BrowserCrypto } from "@effect/platform-browser"
import {
  Clock,
  Crypto,
  DateTime,
  Duration,
  Effect,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  Queue,
  Schema,
  Semaphore,
} from "effect"
import { FetchHttpClient } from "effect/http"
import type { HttpClient } from "effect/http"

import { deliverOnce, type DeliveryState, type Outcome, type Queued } from "./delivery.ts"
import { headersFor } from "./request-headers.ts"
import type { AppEvents, KeptStore, Runtime } from "./runtime.ts"
import { applySessionEvent, type OpenSession, type SessionEvent } from "./session-rules.ts"
import {
  clipped,
  componentOfKey,
  isEnvironmentKey,
  isFeatureKey,
  isName,
  isPropertyKey,
  isReleaseVersion,
  isUserId,
  shortText,
} from "./text-rules.ts"
import type { WireSignal } from "./wire.ts"

/** What `start` takes. */
export interface StartOptions {
  /** The component's SDK key, from Cluenori: `cluenori-sdk.<project>.<component>.<id>`. */
  readonly key: string
  /** Where this build runs, `production` or `staging`. */
  readonly environment: string
  /** Your Cluenori's address, `https://cluenori.example.com`, the only place the SDK sends to. */
  readonly deployment: string
  /** This build's release, `<version>+<build>`: `1.4.0+52`. */
  readonly release: string
  /** `browser()`, or `program(...)` for a command-line program. */
  readonly runtime: Runtime
}

/** A feature marked in effect by `begin`, until `end()`. Ending it twice does nothing. */
export interface FeatureMark {
  readonly end: () => void
}

/** Something timed by `timing`, until `end()`, which records how long it took. Only the first `end()` counts. */
export interface Timing {
  readonly end: () => void
}

/** A property's value: a string of at most 256 characters, a finite number, or a boolean. */
export type EventValue = string | number | boolean

/** How a screen's content came: `kept`, from what the device kept; `fresh`, from the network. */
export type ScreenContent = "kept" | "fresh"

/** Whether the person lets the app collect analytics. */
export type AnalyticsConsent = "full" | "none"

/**
 * Cluenori in a web app or a program. Every call returns at once and never throws; a mistake, such
 * as a feature key that isn't one, is logged as a warning and the call ignored.
 */
export interface Cluenori {
  /** The person signed in, by the app's own opaque ID, never an email or a name. Kept between runs. */
  readonly identify: (userId: string) => void
  /** The person signed out: the session ends, and the next one starts without them. */
  readonly reset: () => void
  /** `none` records nothing more and drops what wasn't sent; `full`, the default, records all. Kept between runs. */
  readonly consent: (analytics: AnalyticsConsent) => void
  /** Marks `feature`, `cards.flip`, in effect until the mark ends; of the marks open, the last begun wins. */
  readonly begin: (feature: string) => FeatureMark
  /**
   * The person is on screen `name` now, `card` or `profile.edit`; in a program, the command it runs,
   * `project create`. Signals from now on are this screen's, until the next.
   */
  readonly screen: (name: string) => void
  /** The screen shows its first content of this kind: how long it took since it appeared is recorded, once for each. */
  readonly screenReady: (content: ScreenContent) => void
  /** Something the person did, `autograph.requested`, with at most 32 snake_case properties. */
  readonly track: (name: string, properties?: Readonly<Record<string, EventValue>>) => void
  /** An error the app met; `handled: false` for one nothing caught, a crash. Its text is scrubbed by your Cluenori. */
  readonly error: (error: unknown, options?: { readonly handled?: boolean }) => void
  /** Starts timing `name`, `export.render`; `end()` records it. */
  readonly timing: (name: string) => Timing
  /**
   * The headers for one request to your own API, merged into the request's `existing` ones: the
   * release, a new `traceparent` unless it has one, and baggage with the feature in effect and the
   * component and release the trace starts in. Never for a third party's API.
   */
  readonly headers: (existing?: Readonly<Record<string, string>>) => Record<string, string>
  /** Sends what waits, as far as the deployment's rules allow now. */
  readonly flush: () => Promise<void>
  /** Ends the session, sends what waits, and stops: at a program's end. Calls after it do nothing. */
  readonly shutdown: () => Promise<void>
}

/** For tests: the `fetch` to send with instead of the platform's, and whether the SDK keeps its own time. */
export interface Internals {
  readonly fetch?: typeof globalThis.fetch
  /** The time, in milliseconds since 1970, for tests that move it. */
  readonly now?: () => number
  readonly schedules: boolean
}

const sdk = { name: "cluenori-js", version: "0.1.0" } as const

/** At most this many signals wait in memory; past it, the oldest are dropped. */
export const queueLimit = 1_000
/** At most this many bytes of waiting signals are kept in the store between runs. */
const keptQueueBytes = 512_000
const propertiesPerEvent = 32
const nudgeAfter = 50

const Visit = Schema.Struct({
  id: Schema.String,
  screen: Schema.String,
  session: Schema.String,
  appearedAt: Schema.Finite,
  visibleMs: Schema.Finite,
  visibleSince: Schema.optionalKey(Schema.Finite),
  ready: Schema.Array(Schema.String),
})
type Visit = typeof Visit.Type

const Session = Schema.Struct({
  id: Schema.String,
  release: Schema.String,
  environment: Schema.String,
  startedAt: Schema.Finite,
  foregroundSince: Schema.optionalKey(Schema.Finite),
  backgroundSince: Schema.optionalKey(Schema.Finite),
  foregroundMs: Schema.Finite,
  lastSeenAt: Schema.Finite,
})

/** What the SDK keeps between runs, beside the queue. */
const KeptState = Schema.Struct({
  installation: Schema.String,
  user: Schema.optionalKey(Schema.String),
  consent: Schema.Literals(["full", "none"]),
  session: Schema.optionalKey(Session),
  visit: Schema.optionalKey(Visit),
  /** A key the deployment refused, with the release it refused it for. */
  rejected: Schema.optionalKey(Schema.Struct({ key: Schema.String, release: Schema.String })),
})
type KeptState = typeof KeptState.Type

const KeptQueue = Schema.Array(
  Schema.Struct({ release: Schema.String, environment: Schema.String, json: Schema.String }),
)

const stateJson = Schema.fromJsonString(KeptState)
const queueJson = Schema.fromJsonString(KeptQueue)
const anyJson = Schema.fromJsonString(Schema.Unknown)

const iso = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis))

// What is wrong with `options`, said for the developer; undefined when nothing is.
const problemOf = (options: StartOptions): string | undefined => {
  if (componentOfKey(options.key) === undefined) {
    return "the SDK key isn't one: cluenori-sdk.<project>.<component>.<id>, from Cluenori."
  }
  if (!isEnvironmentKey(options.environment)) {
    return `"${options.environment}" isn't an environment: lowercase letters, digits and single hyphens, such as production.`
  }
  if (!isReleaseVersion(options.release)) {
    return `"${options.release}" isn't a release: <version>+<build>, such as 1.4.0+52.`
  }
  if (!isDeploymentUrl(options.deployment)) {
    return `${options.deployment} isn't a deployment's address: https, or http on this computer or its network.`
  }
  return undefined
}

// An error's message, from whatever was thrown.
const messageOf = (error: unknown) => {
  if (error instanceof Error) {
    return error.message
  }
  return typeof error === "string" ? error : ""
}

/** Starts the SDK on `options`' runtime; see `Cluenori`. */
export const makeEngine = (options: StartOptions, internals: Internals): Cluenori => {
  const fetch = internals.fetch
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      fetch === undefined
        ? FetchHttpClient.layer
        : FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))),
      BrowserCrypto.layer,
    ),
  )
  const run = <A>(effect: Effect.Effect<A, never, HttpClient.HttpClient | Crypto.Crypto>) => runtime.runSync(effect)
  const warn = (message: string) => run(Effect.logWarning(`Cluenori: ${message}`))
  // Every public call runs here: a bug in the SDK is logged, never thrown into the app.
  let disposed = false
  const guarded = (what: string, work: () => void) =>
    disposed
      ? undefined
      : run(Effect.sync(work).pipe(Effect.catchCause((cause) => Effect.logError(`Cluenori: ${what} failed`, cause))))

  const clock = internals.now
  const now = () => (clock === undefined ? run(Clock.currentTimeMillis) : clock())
  const newId = () => run(Crypto.Crypto.use((crypto) => crypto.randomUUIDv7()).pipe(Effect.orDie))
  const randomBytes = (count: number) =>
    run(Crypto.Crypto.use((crypto) => crypto.randomBytes(count)).pipe(Effect.orDie))

  const component = componentOfKey(options.key)
  const problem = problemOf(options)
  if (problem !== undefined || component === undefined) {
    warn(`Cluenori doesn't start: ${problem ?? "the SDK key isn't one."}`)
    return inert
  }
  const origin = { release: options.release, environment: options.environment }
  // The runtime's store, whose failures, such as a page refused \`localStorage\` or a full disk, do
  // nothing (KeptStore): what isn't kept is then only in memory.
  const runtimeStore = options.runtime.store
  const store: KeptStore = {
    read: (name) => run(Effect.try(() => runtimeStore.read(name)).pipe(Effect.orElseSucceed(() => undefined))),
    write: (name, text) => run(Effect.try(() => runtimeStore.write(name, text)).pipe(Effect.ignore)),
  }

  // What the last run left: nothing on a first run, or when it can't be read.
  const readState = (): KeptState => {
    const text = store.read("state")
    const kept =
      text === undefined ? Option.none<KeptState>() : run(Schema.decodeEffect(stateJson)(text).pipe(Effect.option))
    return Option.isSome(kept) ? kept.value : { installation: newId(), consent: "full" }
  }
  const readQueue = (): Array<Queued> => {
    const text = store.read("queue")
    const kept = text === undefined ? Option.none() : run(Schema.decodeEffect(queueJson)(text).pipe(Effect.option))
    return Option.isSome(kept) ? kept.value.map((each) => ({ ...each, bytes: each.json.length })) : []
  }

  let state = readState()
  let stopped = false
  if (
    state.rejected !== undefined &&
    (state.rejected.key !== options.key || state.rejected.release !== options.release)
  ) {
    // A new release, or a new key, tries again.
    const { rejected: _rejected, ...rest } = state
    state = rest
  }
  const queue: Array<Queued> = readQueue()
  const delivery: DeliveryState = {
    stopped: state.rejected !== undefined,
    notBefore: undefined,
    failures: 0,
    limit: 500,
  }
  const marks: Array<{ readonly mark: number; readonly feature: string }> = []
  let nextMark = 1
  let unsent = 0
  let currentScreen: string | undefined = state.visit?.screen

  const collecting = () => state.consent === "full" && state.rejected === undefined && !stopped
  const feature = () => marks.at(-1)?.feature

  const persist = () => {
    store.write("state", run(Schema.encodeEffect(stateJson)(state).pipe(Effect.orDie)))
  }
  const persistQueue = () => {
    // The newest that fit the budget are kept.
    const kept: Array<Queued> = []
    let bytes = 0
    for (const each of queue.toReversed()) {
      bytes += each.bytes
      if (bytes > keptQueueBytes) {
        break
      }
      kept.unshift(each)
    }
    const text = run(
      Schema.encodeEffect(queueJson)(
        kept.map(({ release, environment, json }) => ({ release, environment, json })),
      ).pipe(Effect.orDie),
    )
    store.write("queue", kept.length === 0 ? undefined : text)
  }

  // What was recorded is kept in the store once the app's current task is done: one write for all
  // it recorded in it, so a page closed or a program killed after that loses none of it.
  let keeping = false
  const keepSoon = () => {
    if (keeping || disposed) {
      return
    }
    keeping = true
    runtime.runFork(
      Effect.yieldNow.pipe(
        Effect.andThen(
          Effect.sync(() => {
            keeping = false
            guarded("keep", () => {
              persist()
              persistQueue()
            })
          }),
        ),
      ),
    )
  }

  const nudges = run(Queue.sliding<void>(1))
  const enqueue = (signal: WireSignal, where: { readonly release: string; readonly environment: string }) => {
    const json = run(Schema.encodeEffect(anyJson)(signal).pipe(Effect.orDie))
    queue.push({ release: where.release, environment: where.environment, json, bytes: json.length })
    if (queue.length > queueLimit) {
      queue.splice(0, queue.length - queueLimit)
    }
    keepSoon()
    unsent += 1
    if (unsent >= nudgeAfter) {
      unsent = 0
      run(Queue.offer(nudges, undefined))
    }
  }

  // The fields every signal of a session has, at `at`.
  const stamp = (session: OpenSession | typeof state.session, at: number) => {
    const user = state.user
    const inFeature = feature()
    return {
      id: newId(),
      at: iso(at),
      session: session?.id ?? "",
      ...(user === undefined ? {} : { user }),
      ...(inFeature === undefined ? {} : { feature: inFeature }),
      ...(currentScreen === undefined ? {} : { screen: currentScreen }),
    }
  }

  /** Records a signal of the session open now; without one, or without consent, nothing. */
  const record = (build: (fields: ReturnType<typeof stamp>) => WireSignal) => {
    const at = now()
    endIfTimedOut(at)
    const session = state.session
    if (!collecting() || session === undefined) {
      return
    }
    enqueue(build(stamp(session, at)), session)
    state = { ...state, session: { ...session, lastSeenAt: Math.max(session.lastSeenAt, at) } }
  }

  const visitLeft = (visit: Visit, at: number, session: { readonly release: string; readonly environment: string }) => {
    const visibleMs = visit.visibleMs + (visit.visibleSince === undefined ? 0 : Math.max(0, at - visit.visibleSince))
    const fields = stamp(state.session, at)
    enqueue(
      {
        ...fields,
        session: visit.session,
        screen: visit.screen,
        _tag: "screen.left",
        visit: visit.id,
        visibleMs,
      },
      session,
    )
  }

  // Records what a session change means: the screen's visit and the end of the one that ended, and
  // the start of the next, with the screen it shows.
  const apply = (event: SessionEvent) => {
    const change = applySessionEvent(event, state.session, origin, newId)
    const session = change.session
    state = session === undefined ? withoutSession(state) : { ...state, session }
    if (!collecting()) {
      return
    }
    const ended = change.ended
    if (ended !== undefined) {
      const visit = state.visit
      if (visit !== undefined && visit.session === ended.session.id) {
        visitLeft(visit, ended.at, ended.session)
        state = withoutVisit(state)
      }
      const user = state.user
      enqueue(
        {
          _tag: "session.ended",
          id: newId(),
          at: iso(ended.at),
          session: ended.session.id,
          ...(user === undefined ? {} : { user }),
          foregroundMs: Math.round(ended.foregroundMs),
        },
        ended.session,
      )
    }
    const started = change.started
    if (started !== undefined) {
      const user = state.user
      enqueue(
        {
          _tag: "session.started",
          id: newId(),
          at: iso(started.startedAt),
          session: started.id,
          ...(user === undefined ? {} : { user }),
        },
        started,
      )
      // The screen in sight goes on in the new session, as a new visit.
      if (currentScreen !== undefined) {
        showScreen(currentScreen, started.startedAt)
      }
    }
    if (event._tag === "background" && state.visit?.visibleSince !== undefined) {
      const { visibleSince, ...rest } = state.visit
      state = { ...state, visit: { ...rest, visibleMs: rest.visibleMs + Math.max(0, event.at - visibleSince) } }
    }
    if (event._tag === "foreground" && state.visit !== undefined && state.visit.visibleSince === undefined) {
      state = { ...state, visit: { ...state.visit, visibleSince: event.at } }
    }
  }

  const endIfTimedOut = (at: number) => {
    if (state.session?.backgroundSince !== undefined && at - state.session.backgroundSince >= 30_000) {
      apply({ _tag: "tick", at })
      persist()
    }
  }

  const showScreen = (name: string, at: number) => {
    const session = state.session
    const visit = state.visit
    if (visit !== undefined && session !== undefined && visit.session === session.id) {
      visitLeft(visit, at, session)
    }
    state = withoutVisit(state)
    currentScreen = name
    if (!collecting() || session === undefined) {
      return
    }
    const fields = stamp(session, at)
    enqueue({ ...fields, _tag: "screen", screen: name }, session)
    const inSight = session.backgroundSince === undefined
    state = {
      ...state,
      visit: {
        id: fields.id,
        screen: name,
        session: session.id,
        appearedAt: at,
        visibleMs: 0,
        ...(inSight ? { visibleSince: at } : {}),
        ready: [],
      },
    }
  }

  // Sending: while there is something to send, then every 30 s, at once after 50 new signals. One
  // delivery at a time, whoever asks: the loop, a flush, the page going.
  const sending = Semaphore.makeUnsafe(1)
  const deliver = (keepalive: boolean) =>
    deliverOnce({
      queue,
      state: delivery,
      keepalive,
      now: now(),
      deployment: options.deployment,
      key: options.key,
      head: (release, environment) => ({
        installation: state.installation,
        environment,
        release,
        device: deviceOf(options.runtime),
        sdk,
        sentAt: iso(now()),
      }),
      rejected: () => {
        state = withoutSession({ ...state, rejected: { key: options.key, release: options.release } })
        queue.length = 0
        persist()
        persistQueue()
      },
    }).pipe(
      Effect.tap((outcome) => (outcome._tag === "Sent" ? Effect.sync(persistQueue) : Effect.void)),
      (once) => sending.withPermit(once),
    )

  const deliverAll = (keepalive: boolean) =>
    Effect.gen(function* () {
      for (let round = 0; round < 50; round++) {
        const outcome: Outcome = yield* deliver(keepalive)
        if (outcome._tag !== "Sent" || !outcome.more) {
          return outcome
        }
      }
      const more: Outcome = { _tag: "Sent", more: true }
      return more
    })

  const loop = Effect.gen(function* () {
    while (true) {
      const outcome = yield* deliverAll(false)
      switch (outcome._tag) {
        case "Stopped":
          return
        case "Wait":
          yield* Effect.sleep(outcome.duration)
          break
        case "Idle":
        case "Sent":
          yield* Effect.raceFirst(Effect.sleep(Duration.seconds(30)), Queue.take(nudges))
          break
      }
    }
  })
  const ticks = Effect.gen(function* () {
    while (true) {
      yield* Effect.sleep(Duration.minutes(1))
      yield* Effect.sync(() => guarded("tick", () => tick()))
    }
  })
  const tick = () => {
    apply({ _tag: "tick", at: now() })
    persist()
  }
  const fibers = internals.schedules ? [runtime.runFork(loop), runtime.runFork(ticks)] : []

  const events: AppEvents = {
    foreground: () =>
      guarded("foreground", () => {
        apply({ _tag: "foreground", at: now() })
        persist()
      }),
    background: () =>
      guarded("background", () => {
        const at = now()
        apply({ _tag: "background", at })
        persist()
        persistQueue()
        // What waits leaves with the page: requests that outlive it, at most 64 KB at once.
        runtime.runFork(deliverAll(true).pipe(Effect.andThen(Effect.sync(persistQueue))))
      }),
    hang: (ms) => guarded("hang", () => record((fields) => ({ ...fields, _tag: "app.hang", ms: Math.round(ms) }))),
    crash: (error) => guarded("crash", () => recordError(error, false)),
  }

  const recordError = (error: unknown, handled: boolean) => {
    const type = error instanceof Error && isName(error.name) ? error.name : "Error"
    const message = messageOf(error)
    const stack = error instanceof Error && typeof error.stack === "string" ? error.stack : undefined
    record((fields) => ({
      ...fields,
      _tag: "error",
      type,
      message: clipped(message, 1024),
      ...(stack === undefined ? {} : { stack: clipped(stack, 16_384) }),
      handled,
    }))
  }

  // Starting: the session kept from the last run ends, unless it was left less than 30 s ago, and the
  // app in sight starts or goes on with one.
  guarded("start", () => {
    const at = now()
    apply({ _tag: "launch", at })
    if (!collecting()) {
      queue.length = 0
    }
    if (options.runtime.visible()) {
      apply({ _tag: "foreground", at })
    }
    persist()
  })
  const detach = options.runtime.attach(events)

  const cluenori: Cluenori = {
    identify: (userId) =>
      guarded("identify", () => {
        if (!isUserId(userId)) {
          warn(
            `"${userId.slice(0, 8)}…" isn't a user ID: 1 to 128 printable ASCII characters, the app's own opaque ID, never an email.`,
          )
          return
        }
        state = { ...state, user: userId }
        persist()
      }),
    reset: () =>
      guarded("reset", () => {
        const at = now()
        const inSight = state.session?.backgroundSince === undefined && state.session !== undefined
        apply({ _tag: "end", at })
        const { user: _user, ...rest } = state
        state = rest
        if (inSight) {
          apply({ _tag: "foreground", at })
        }
        persist()
      }),
    consent: (analytics) =>
      guarded("consent", () => {
        if (state.consent === analytics) {
          return
        }
        const inSight = state.session !== undefined && state.session.backgroundSince === undefined
        state = { ...state, consent: analytics }
        if (analytics === "none") {
          state = withoutVisit(withoutSession(state))
          queue.length = 0
          persistQueue()
        } else if (options.runtime.visible() || inSight) {
          apply({ _tag: "foreground", at: now() })
        }
        persist()
      }),
    begin: (key) => {
      if (!isFeatureKey(key)) {
        warn(`"${key}" isn't a feature key: keys joined by dots, such as cards.flip.`)
        return { end: () => undefined }
      }
      const mark = nextMark
      nextMark += 1
      marks.push({ mark, feature: key })
      return {
        end: () => {
          const index = marks.findIndex((each) => each.mark === mark)
          if (index >= 0) {
            marks.splice(index, 1)
          }
        },
      }
    },
    screen: (name) =>
      guarded("screen", () => {
        if (!isName(name)) {
          warn(`"${name}" isn't a screen's name: 1 to 256 characters, such as profile.edit.`)
          return
        }
        const at = now()
        endIfTimedOut(at)
        showScreen(name, at)
        persist()
      }),
    screenReady: (content) =>
      guarded("screenReady", () => {
        const at = now()
        const visit = state.visit
        if (visit === undefined || visit.ready.includes(content) || !collecting()) {
          return
        }
        state = { ...state, visit: { ...visit, ready: [...visit.ready, content] } }
        record((fields) => ({
          ...fields,
          _tag: "screen.ready",
          screen: visit.screen,
          visit: visit.id,
          content,
          ms: Math.max(0, at - visit.appearedAt),
        }))
        persist()
      }),
    track: (name, properties = {}) =>
      guarded("track", () => {
        if (!isName(name)) {
          warn(`"${name}" isn't an event's name: 1 to 256 characters, such as autograph.requested.`)
          return
        }
        const kept: Record<string, EventValue> = {}
        for (const key of Object.keys(properties).toSorted()) {
          const value = properties[key]
          if (value === undefined) {
            continue
          }
          if (!isPropertyKey(key)) {
            warn(`"${key}" isn't a property's key: snake_case words joined by dots, such as card_id.`)
          } else if (Object.keys(kept).length >= propertiesPerEvent) {
            warn(`An event has at most ${propertiesPerEvent} properties; "${key}" is left out.`)
          } else if (typeof value === "string" && value.length > 256) {
            warn(`The property "${key}" is over 256 characters, and is left out.`)
          } else if (typeof value === "number" && !Number.isFinite(value)) {
            warn(`The property "${key}" isn't a finite number, and is left out.`)
          } else {
            kept[key] = value
          }
        }
        const hasProperties = Object.keys(kept).length > 0
        record((fields) => ({ ...fields, _tag: "event", name, ...(hasProperties ? { properties: kept } : {}) }))
      }),
    error: (error, errorOptions) => guarded("error", () => recordError(error, errorOptions?.handled ?? true)),
    timing: (name) => {
      if (!isName(name)) {
        warn(`"${name}" isn't a timing's name: 1 to 256 characters, such as export.render.`)
        return { end: () => undefined }
      }
      const started = now()
      let ended = false
      return {
        end: () =>
          guarded("timing", () => {
            if (ended) {
              return
            }
            ended = true
            const ms = Math.max(0, now() - started)
            record((fields) => ({ ...fields, _tag: "timing", name, ms }))
          }),
      }
    },
    headers: (existing = {}) =>
      disposed
        ? { ...existing }
        : headersFor({ release: options.release, component, feature: feature(), existing, random: randomBytes(24) }),
    flush: () =>
      runtime.runPromise(
        deliverAll(false).pipe(
          Effect.andThen(Effect.sync(persistQueue)),
          Effect.asVoid,
          Effect.catchCause((cause) => Effect.logError("Cluenori: flush failed", cause)),
        ),
      ),
    shutdown: () => {
      if (stopped) {
        return Promise.resolve()
      }
      guarded("shutdown", () => {
        apply({ _tag: "end", at: now() })
        persist()
      })
      stopped = true
      disposed = true
      detach()
      const last = Effect.gen(function* () {
        for (const fiber of fibers) {
          yield* Fiber.interrupt(fiber)
        }
        yield* deliverAll(false)
        yield* Effect.sync(persistQueue)
      }).pipe(Effect.catchCause((cause) => Effect.logError("Cluenori: shutdown failed", cause)))
      return Effect.runPromise(
        Effect.gen(function* () {
          yield* Effect.promise(() => runtime.runPromise(last))
          yield* Effect.promise(() => runtime.dispose())
        }),
      )
    },
  }
  return cluenori
}

// A deployment's address: https, or http on this computer or its local network, for `./run`.
const isDeploymentUrl = (text: string) => {
  const url = URL.parse(text)
  if (url === null) {
    return false
  }
  if (url.protocol === "https:") {
    return true
  }
  if (url.protocol !== "http:") {
    return false
  }
  const host = url.hostname.toLowerCase()
  return (
    host === "localhost" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    /^(?:127\.\d+|10\.\d+|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d+\.\d+$/.test(host)
  )
}

const deviceOf = (runtime: Runtime) => {
  const device = runtime.device()
  return {
    model: shortText(device.model),
    platform: device.platform,
    osVersion: shortText(device.osVersion),
    locale: shortText(device.locale),
    timeZone: shortText(device.timeZone),
  }
}

const withoutSession = (state: KeptState): KeptState => {
  const { session: _session, ...rest } = state
  return rest
}

const withoutVisit = (state: KeptState): KeptState => {
  const { visit: _visit, ...rest } = state
  return rest
}

// A Cluenori that does nothing, for options that aren't valid: the app carries on.
const inert: Cluenori = {
  identify: () => undefined,
  reset: () => undefined,
  consent: () => undefined,
  begin: () => ({ end: () => undefined }),
  screen: () => undefined,
  screenReady: () => undefined,
  track: () => undefined,
  error: () => undefined,
  timing: () => ({ end: () => undefined }),
  headers: (existing = {}) => ({ ...existing }),
  flush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
}
