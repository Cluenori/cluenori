import {
  CalendarDay,
  ComponentKey,
  EnvironmentKey,
  FeatureKey,
  InstallationId,
  Instant,
  Period,
  PersonId,
  ReleaseVersion,
} from "@cluenori/foundation"
import { Schema } from "effect"

import {
  AppDevice,
  AppLaunched,
  AppSdk,
  AppSignalId,
  AppUserId,
  EventTracked,
  MetricKitKind,
  ScreenShown,
  SessionEnded,
  SessionStarted,
} from "./app-batch.ts"

// What Signals answers about a project's apps, from the batches their SDKs send: usage by day,
// retention by week, each release's health, features, and one person. Days are UTC days.

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const Milliseconds = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const Bytes = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/** A country, as ISO 3166-1 two capital letters: `UA`. Where an installation last sent from. */
export const CountryCode = Schema.String.check(
  Schema.isPattern(/^[A-Z]{2}$/, { expected: "a country as two capital letters, such as UA" }),
)
  .pipe(Schema.brand("CountryCode"))
  .annotate({ identifier: "CountryCode" })
export type CountryCode = typeof CountryCode.Type

/** What to count of a project's apps: what happened in `period`, optionally of one component, environment, or release. */
export const AppQuery = Schema.Struct({
  period: Period,
  component: Schema.optionalKey(ComponentKey),
  environment: Schema.optionalKey(EnvironmentKey),
  release: Schema.optionalKey(ReleaseVersion),
}).annotate({ identifier: "AppQuery" })
export type AppQuery = typeof AppQuery.Type

/**
 * One day of usage. People and installations count those that sent anything that day; a session is
 * the app coming to the foreground.
 */
export const UsageDay = Schema.Struct({
  day: CalendarDay,
  /** People active that day: the daily active people. */
  people: Count,
  installations: Count,
  /** People active in the 7 days ending that day; absent when some of those days aren't counted. */
  weekPeople: Schema.optionalKey(Count),
  /** People active in the 30 days ending that day; absent when some of those days aren't counted. */
  monthPeople: Schema.optionalKey(Count),
  /** Sessions started that day. */
  sessions: Count,
  /** The foreground time of the sessions that ended that day. */
  foregroundMs: Milliseconds,
}).annotate({ identifier: "UsageDay" })
export type UsageDay = typeof UsageDay.Type

/** One release's share of a period's usage. */
export const ReleaseUsage = Schema.Struct({
  component: ComponentKey,
  environment: EnvironmentKey,
  release: ReleaseVersion,
  people: Count,
  installations: Count,
  sessions: Count,
}).annotate({ identifier: "ReleaseUsage" })
export type ReleaseUsage = typeof ReleaseUsage.Type

/**
 * Usage over a period: each day counted, oldest first, and the whole period's people, installations
 * and sessions, overall and by release, the most people first.
 */
export const AppUsage = Schema.Struct({
  /**
   * The part of the period counted: from the first day the apps asked about sent anything, within
   * the 15 months days are kept, up to now. Absent when nothing was sent in the period; days outside
   * it are unknown, not zero, and aren't listed.
   */
  covered: Schema.optionalKey(Period),
  days: Schema.Array(UsageDay),
  people: Count,
  installations: Count,
  sessions: Count,
  /** Sessions per person over the period; absent without people. */
  sessionsPerPerson: Schema.optionalKey(Schema.Finite),
  /** Sessions per day per person, over the days each was active; absent without any. */
  sessionsPerPersonDay: Schema.optionalKey(Schema.Finite),
  releases: Schema.Array(ReleaseUsage),
}).annotate({ identifier: "AppUsage" })
export type AppUsage = typeof AppUsage.Type

/** Which cohorts: the people first seen in `period`, optionally in one component and environment. */
export const RetentionQuery = Schema.Struct({
  period: Period,
  component: Schema.optionalKey(ComponentKey),
  environment: Schema.optionalKey(EnvironmentKey),
}).annotate({ identifier: "RetentionQuery" })
export type RetentionQuery = typeof RetentionQuery.Type

/** The people first seen in one week, Monday to Sunday in UTC, and how many came back each week after. */
export const RetentionCohort = Schema.Struct({
  /** The Monday the week starts. */
  week: CalendarDay,
  people: Count,
  /**
   * Of them, how many were active in each week from their first: the first is all of them, the last
   * the week now is in, so far.
   */
  active: Schema.Array(Count),
}).annotate({ identifier: "RetentionCohort" })
export type RetentionCohort = typeof RetentionCohort.Type

/** Weekly cohorts by the week each person was first seen, the oldest first. */
export const AppRetention = Schema.Struct({
  cohorts: Schema.Array(RetentionCohort),
  /** The Monday of the week now is in, which each cohort's last count is so far of. */
  currentWeek: CalendarDay,
}).annotate({ identifier: "AppRetention" })
export type AppRetention = typeof AppRetention.Type

/** Which releases: those that sent anything in `period`, optionally of one component and environment. */
export const AppReleaseQuery = Schema.Struct({
  period: Period,
  component: Schema.optionalKey(ComponentKey),
  environment: Schema.optionalKey(EnvironmentKey),
}).annotate({ identifier: "AppReleaseQuery" })
export type AppReleaseQuery = typeof AppReleaseQuery.Type

/** One release of an app in one environment. */
export const AppReleaseKey = Schema.Struct({
  component: ComponentKey,
  environment: EnvironmentKey,
  release: ReleaseVersion,
}).annotate({ identifier: "AppReleaseKey" })
export type AppReleaseKey = typeof AppReleaseKey.Type

/**
 * One release of an app in one environment, from the first signal it sent to the last, over all that
 * is kept; and the release before it: of the same component and environment, the one first seen
 * latest before it.
 */
export const AppRelease = Schema.Struct({
  ...AppReleaseKey.fields,
  firstSeen: Instant,
  lastSeen: Instant,
  previous: Schema.optionalKey(ReleaseVersion),
}).annotate({ identifier: "AppRelease" })
export type AppRelease = typeof AppRelease.Type

/** The releases that sent anything in a period, the latest first seen first. */
export const AppReleaseList = Schema.Struct({ releases: Schema.Array(AppRelease) }).annotate({
  identifier: "AppReleaseList",
})
export type AppReleaseList = typeof AppReleaseList.Type

/** How long launches took to their app's first useful screen, of those that said (`appReady()`). */
export const ReadyTimes = Schema.Struct({
  launches: Count,
  p50Ms: Milliseconds,
  p95Ms: Milliseconds,
}).annotate({ identifier: "ReadyTimes" })
export type ReadyTimes = typeof ReadyTimes.Type

/**
 * Launches of one kind, cold or warm, prewarmed ones left out: how many, and their time to the first
 * frame, and to the first useful screen where the app said. Percentiles are within 2%.
 */
export const LaunchTimes = Schema.Struct({
  launches: Count,
  firstFrameP50Ms: Milliseconds,
  firstFrameP95Ms: Milliseconds,
  ready: Schema.optionalKey(ReadyTimes),
}).annotate({ identifier: "LaunchTimes" })
export type LaunchTimes = typeof LaunchTimes.Type

/** The app's memory as measured: how many measurements, and the p95 of its peak and of its footprint. */
export const MemoryUse = Schema.Struct({
  samples: Count,
  peakP95Bytes: Bytes,
  footprintP95Bytes: Bytes,
}).annotate({ identifier: "MemoryUse" })
export type MemoryUse = typeof MemoryUse.Type

/**
 * What MetricKit reported of a release: how many reports arrived, and the diagnostics in them, by
 * kind. iOS sends a diagnostics report only when there is something in it.
 */
export const AppDiagnostics = Schema.Struct({
  reports: Count,
  crashes: Count,
  hangs: Count,
  cpuExceptions: Count,
  diskWriteExceptions: Count,
}).annotate({ identifier: "AppDiagnostics" })
export type AppDiagnostics = typeof AppDiagnostics.Type

/**
 * One release's health over everything kept of it: its sessions and people, its launches by kind,
 * prewarmed ones only counted, its memory, and MetricKit's diagnostics. A part is absent when the
 * release sent none of it: unknown, not zero.
 */
export const AppHealth = Schema.Struct({
  sessions: Count,
  people: Count,
  cold: Schema.optionalKey(LaunchTimes),
  warm: Schema.optionalKey(LaunchTimes),
  /** Launches iOS prewarmed, whose times aren't comparable, so they aren't in the percentiles. */
  prewarmed: Count,
  memory: Schema.optionalKey(MemoryUse),
  /** Absent until MetricKit sent a report of the release. */
  diagnostics: Schema.optionalKey(AppDiagnostics),
}).annotate({ identifier: "AppHealth" })
export type AppHealth = typeof AppHealth.Type

/** How one feature was used in a period; without a feature, the signals the app marked with none. */
export const FeatureUse = Schema.Struct({
  feature: Schema.optionalKey(FeatureKey),
  /** People who sent anything in the feature. */
  people: Count,
  events: Count,
  screens: Count,
  /** The app's memory while in the feature; absent when it was never measured there. */
  memory: Schema.optionalKey(MemoryUse),
}).annotate({ identifier: "FeatureUse" })
export type FeatureUse = typeof FeatureUse.Type

/** Each feature's use in a period, the most people first, with "(no feature)" as one without a key. */
export const FeatureUseTable = Schema.Struct({ features: Schema.Array(FeatureUse) }).annotate({
  identifier: "FeatureUseTable",
})
export type FeatureUseTable = typeof FeatureUseTable.Type

/** Which person: by Cluenori's ID for them, or by the app's own user ID. */
export const PersonLookup = Schema.Union([
  Schema.TaggedStruct("ByPerson", { person: PersonId }),
  Schema.TaggedStruct("ByUser", { user: AppUserId }),
]).annotate({ identifier: "PersonLookup" })
export type PersonLookup = typeof PersonLookup.Type

/** One app on one device, as its last batch said. */
export const AppInstallation = Schema.Struct({
  installation: InstallationId,
  component: ComponentKey,
  environment: EnvironmentKey,
  release: ReleaseVersion,
  device: AppDevice,
  sdk: AppSdk,
  /** Where it last sent from; absent when Cloudflare couldn't say. */
  country: Schema.optionalKey(CountryCode),
  firstSeen: Instant,
  lastSeen: Instant,
}).annotate({ identifier: "AppInstallation" })
export type AppInstallation = typeof AppInstallation.Type

/** One day a person was active: their sessions, and the foreground time of those that ended. */
export const PersonDay = Schema.Struct({
  day: CalendarDay,
  sessions: Count,
  foregroundMs: Milliseconds,
}).annotate({ identifier: "PersonDay" })
export type PersonDay = typeof PersonDay.Type

/** A MetricKit report, in a timeline: which kind, and the crashes and hangs in it. */
export const MetricKitSummary = Schema.TaggedStruct("metrickit", {
  id: AppSignalId,
  at: Instant,
  report: MetricKitKind,
  crashes: Count,
  hangs: Count,
}).annotate({ identifier: "MetricKitSummary" })
export type MetricKitSummary = typeof MetricKitSummary.Type

/** What a timeline shows of a signal: sessions, launches, screens, events and MetricKit's reports; memory isn't shown. */
export const TimelineSignal = Schema.Union([
  SessionStarted,
  SessionEnded,
  AppLaunched,
  ScreenShown,
  EventTracked,
  MetricKitSummary,
]).annotate({ identifier: "TimelineSignal" })
export type TimelineSignal = typeof TimelineSignal.Type

/** One signal in a person's timeline, with where it came from. */
export const TimelineEntry = Schema.Struct({
  component: ComponentKey,
  environment: EnvironmentKey,
  release: ReleaseVersion,
  installation: InstallationId,
  signal: TimelineSignal,
}).annotate({ identifier: "TimelineEntry" })
export type TimelineEntry = typeof TimelineEntry.Type

/**
 * One person: the app's user IDs linked to them, when they were first and last seen, their
 * installations, the days they were active (the latest 90, newest first), and their timeline (the
 * latest 1,000 signals kept, newest first).
 */
export const AppPerson = Schema.Struct({
  person: PersonId,
  users: Schema.Array(AppUserId),
  firstSeen: Instant,
  lastSeen: Instant,
  installations: Schema.Array(AppInstallation),
  days: Schema.Array(PersonDay),
  timeline: Schema.Array(TimelineEntry),
}).annotate({ identifier: "AppPerson" })
export type AppPerson = typeof AppPerson.Type

/** No person of the project has this ID or user ID. */
export class PersonNotFound extends Schema.TaggedError<PersonNotFound>()("PersonNotFound", {}) {}
