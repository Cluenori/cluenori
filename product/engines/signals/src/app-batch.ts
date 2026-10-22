import {
  EnvelopeName,
  EnvironmentKey,
  FeatureKey,
  InstallationId,
  Instant,
  ReleaseVersion,
  SessionId,
  Uuidv7,
} from "@cluenori/foundation"
import { Schema } from "effect"

// What an app sends Cluenori through its SDK: batches of the signals it recorded, with the
// installation and release they came from. This is the wire contract between the SDKs and the
// Worker; shipped app builds send it for years, so it only grows.

/** One signal, made by the SDK when it was recorded: a batch sent again is counted once. */
export const AppSignalId = Uuidv7.pipe(Schema.brand("AppSignalId"))
export type AppSignalId = typeof AppSignalId.Type

/**
 * The app's own ID of the person signed in, as the app knows it: an opaque ID, never an email or a
 * name. Cluenori links it to a person in the component's project.
 */
export const AppUserId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[\x21-\x7e]+$/, { expected: "printable ASCII without spaces, such as a UUID" }),
)
  .pipe(Schema.brand("AppUserId"))
  .annotate({ identifier: "AppUserId" })
export type AppUserId = typeof AppUserId.Type

/** The operating system an app runs on. */
export const AppPlatform = Schema.Literals(["iOS", "iPadOS", "macOS", "visionOS", "watchOS", "tvOS"]).annotate({
  identifier: "AppPlatform",
})
export type AppPlatform = typeof AppPlatform.Type

// Short device and locale texts: printable, at most 64 characters.
const ShortText = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
  Schema.isPattern(/^\P{Cc}+$/u, { expected: "text without control characters" }),
)

/** The device an installation runs on, and its settings, as of the batch. */
export const AppDevice = Schema.Struct({
  /** The hardware identifier: `iPhone17,2`. */
  model: ShortText,
  platform: AppPlatform,
  /** `27.2` */
  osVersion: ShortText,
  /** The language and region the app runs in, as BCP 47: `uk-UA`. */
  locale: ShortText,
  /** An IANA time zone: `Europe/Kyiv`. */
  timeZone: ShortText,
}).annotate({ identifier: "AppDevice" })
export type AppDevice = typeof AppDevice.Type

/** The SDK that sent the batch: `cluenori-swift` 0.1.0. */
export const AppSdk = Schema.Struct({ name: ShortText, version: ShortText }).annotate({ identifier: "AppSdk" })
export type AppSdk = typeof AppSdk.Type

const Milliseconds = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
const Bytes = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

// Fields every signal of a session has: its ID, when it was recorded, its session, the person signed
// in then, if any, and the feature they were in, if the app marked one.
const inSession = {
  id: AppSignalId,
  at: Instant,
  session: SessionId,
  user: Schema.optionalKey(AppUserId),
  /**
   * The feature the person was in when it was recorded (`cards.flip`), as the app marks its screens
   * and actions: so adoption, speed, memory and errors can be told apart by feature.
   */
  feature: Schema.optionalKey(FeatureKey),
}

/** The app came to the foreground: a session starts. */
export const SessionStarted = Schema.TaggedStruct("session.started", inSession).annotate({
  identifier: "SessionStarted",
})

/** The session ended: 30 s after the app went to the background, or when it was terminated. */
export const SessionEnded = Schema.TaggedStruct("session.ended", {
  ...inSession,
  /** How long the app was in the foreground during the session. */
  foregroundMs: Milliseconds,
}).annotate({ identifier: "SessionEnded" })

/** How the process started: `cold` from nothing, `warm` from a process iOS had kept or prewarmed. */
export const LaunchStart = Schema.Literals(["cold", "warm"]).annotate({ identifier: "LaunchStart" })

/** One launch of the app, timed from when its process started. */
export const AppLaunched = Schema.TaggedStruct("app.launched", {
  ...inSession,
  start: LaunchStart,
  /** Whether iOS prewarmed the process before the person opened the app; its time isn't comparable. */
  prewarmed: Schema.Boolean,
  /** From the process's start to the first frame drawn. */
  firstFrameMs: Milliseconds,
  /** From the process's start to the app's first useful screen (`appReady()`); absent if not called. */
  readyMs: Schema.optionalKey(Milliseconds),
}).annotate({ identifier: "AppLaunched" })

/** Why memory was measured. */
export const MemoryReason = Schema.Literals(["interval", "warning", "session_end"]).annotate({
  identifier: "MemoryReason",
})

/** The app's memory: its footprint now, as iOS counts it against its limit, and its peak so far. */
export const AppMemory = Schema.TaggedStruct("app.memory", {
  ...inSession,
  reason: MemoryReason,
  footprintBytes: Bytes,
  peakBytes: Bytes,
}).annotate({ identifier: "AppMemory" })

/** A screen was shown, by the name the app gives it: `card`, `profile.edit`. */
export const ScreenShown = Schema.TaggedStruct("screen", { ...inSession, screen: EnvelopeName }).annotate({
  identifier: "ScreenShown",
})

// An event property's key: a short snake_case word, possibly dotted.
const propertyKey = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/

/**
 * What an event says about itself: at most 32 properties, keyed by snake_case words, each a string of
 * at most 256 characters, a finite number, or a boolean. IDs and amounts, never typed text.
 */
export const EventProperties = Schema.Record(Schema.String, Schema.Unknown).check(
  Schema.makeFilter(
    (properties: Readonly<Record<string, unknown>>) => {
      const entries = Object.entries(properties)
      return (
        entries.length <= 32 &&
        entries.every(
          ([key, value]) =>
            key.length <= 64 &&
            propertyKey.test(key) &&
            ((typeof value === "string" && value.length <= 256) ||
              (typeof value === "number" && Number.isFinite(value)) ||
              typeof value === "boolean"),
        )
      )
    },
    {
      expected:
        "at most 32 properties, each a snake_case key to a string of at most 256 characters, a finite number, or a boolean",
    },
  ),
)
export type EventProperties = typeof EventProperties.Type

/** Something the person did, in the app's own words: `autograph.requested`, with its properties. */
export const EventTracked = Schema.TaggedStruct("event", {
  ...inSession,
  name: EnvelopeName,
  properties: Schema.optionalKey(EventProperties),
}).annotate({ identifier: "EventTracked" })

/** Which kind of MetricKit report: daily `metrics`, or `diagnostics` of crashes, hangs and resources. */
export const MetricKitKind = Schema.Literals(["metrics", "diagnostics"]).annotate({ identifier: "MetricKitKind" })

/**
 * A MetricKit report iOS delivered, about once a day for the day before, as its JSON representation:
 * launch times, hangs, memory, CPU, disk writes and battery (`metrics`), or crash, hang and resource
 * diagnostics (`diagnostics`). Not tied to a session: iOS delivers it whenever it likes.
 */
export const MetricKitReport = Schema.TaggedStruct("metrickit", {
  id: AppSignalId,
  at: Instant,
  report: MetricKitKind,
  payload: Schema.Unknown,
}).annotate({ identifier: "MetricKitReport" })

/** One signal an app recorded. New kinds are added, never changed; a Worker refuses a kind it doesn't know. */
export const AppSignal = Schema.Union([
  SessionStarted,
  SessionEnded,
  AppLaunched,
  AppMemory,
  ScreenShown,
  EventTracked,
  MetricKitReport,
]).annotate({ identifier: "AppSignal" })
export type AppSignal = typeof AppSignal.Type

/** At most this many signals in one batch. */
export const signalsPerBatch = 500

/**
 * What an app's SDK sends: the signals it recorded, from one installation of one release, at most
 * 500, in the order they were recorded. The body is at most 1 MB.
 */
export const AppBatch = Schema.Struct({
  /** Made by the SDK on the app's first launch and kept in its container: a new install, a new ID. */
  installation: InstallationId,
  environment: EnvironmentKey,
  /** The app's version and build, as `<version>+<build>`: `0.3.0+20`. */
  release: ReleaseVersion,
  device: AppDevice,
  sdk: AppSdk,
  sentAt: Instant,
  signals: Schema.Array(AppSignal).check(Schema.isMinLength(1), Schema.isMaxLength(signalsPerBatch)),
}).annotate({ identifier: "AppBatch" })
export type AppBatch = typeof AppBatch.Type

/** What Cluenori kept of a batch: new signals, and those it had already from an earlier send. */
export const AppBatchAccepted = Schema.Struct({
  accepted: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  duplicates: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "AppBatchAccepted" })
export type AppBatchAccepted = typeof AppBatchAccepted.Type

/** The SDK key isn't one of the deployment's, or was revoked: the SDK stops sending until the app is updated. */
export class SdkKeyRejected extends Schema.TaggedError<SdkKeyRejected>()("SdkKeyRejected", {
  message: Schema.String,
}) {}

/** The key or the installation sent too much lately: the SDK keeps the batch and sends it after `retryAfterSeconds`. */
export class TooManySignals extends Schema.TaggedError<TooManySignals>()("TooManySignals", {
  retryAfterSeconds: Schema.Int.check(Schema.isGreaterThan(0)),
}) {}
