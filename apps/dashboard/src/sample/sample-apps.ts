// Sample answers about a project's apps, for the design kit: notes-ios, an iPhone app, as the public
// API answers Analytics' questions and its SDK keys and version policies. Made up and deterministic,
// so screenshots compare. Only the design kit reads it; the pages read the API.

import type { ReleaseHealth } from "@cluenori/analytics"
import {
  CalendarDay,
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  FeatureKey,
  InstallationId,
  Period,
  PersonId,
  ReleaseVersion,
  SessionId,
} from "@cluenori/foundation"
import { StoreVersion } from "@cluenori/manifest"
import type { IssuedSdkKey } from "@cluenori/projects"
import { SdkKey } from "@cluenori/projects"
import type { ComponentVersionPolicy } from "@cluenori/releases"
import { NoteLocale } from "@cluenori/releases"
import type { AppInstallation, AppUsage, FeatureUse, RetentionCohort, TimelineEntry, UsageDay } from "@cluenori/signals"
import { AppSignalId, AppUserId, CountryCode } from "@cluenori/signals"
import { DateTime } from "effect"

import { sampleNow } from "@/sample/sample-project"

const minute = 60_000
const hour = 60 * minute
const day = 24 * hour

const at = (millis: number) => DateTime.makeUnsafe(millis)
const ios = ComponentKey.make("notes-ios")
const production = EnvironmentKey.make("production")

/** The period the samples answer for: the 30 days to the sample's now. */
export const samplePeriod = { from: at(sampleNow - 30 * day), to: at(sampleNow) }

const dayNumber = Math.floor(sampleNow / day)
const dayOf = (index: number) => CalendarDay.make(DateTime.formatIso(at((dayNumber - 29 + index) * day)).slice(0, 10))

// People a day over 30 days, a little more each week and less at weekends.
const peopleOn = (index: number) => {
  const weekday = (dayNumber - 29 + index + 4) % 7
  const weekend = weekday === 0 || weekday === 6
  return Math.round((620 + index * 7) * (weekend ? 0.7 : 1))
}

const usageDay = (index: number, firstSent: number): UsageDay => ({
  day: dayOf(index),
  people: peopleOn(index),
  installations: peopleOn(index) + 12,
  // A week or month that reaches before the app first sent isn't counted.
  ...(index - firstSent >= 6 ? { weekPeople: 2_100 + index * 18 } : {}),
  ...(index - firstSent >= 29 ? { monthPeople: 5_105 } : {}),
  sessions: Math.round(peopleOn(index) * 2.7),
  foregroundMs: peopleOn(index) * 9 * minute,
})

const usageFrom = (firstSent: number): AppUsage => {
  const days = Array.from({ length: 30 - firstSent }, (_, offset) => usageDay(firstSent + offset, firstSent))
  return {
    covered: new Period({ from: at((dayNumber - 29 + firstSent) * day), to: at(sampleNow) }),
    days,
    people: 5_105,
    installations: 5_380,
    sessions: 48_210,
    sessionsPerPerson: 9.4,
    sessionsPerPersonDay: 2.7,
    releases: [
      {
        component: ios,
        environment: production,
        release: ReleaseVersion.make("0.3.0+20"),
        people: 4_980,
        installations: 5_100,
        sessions: 41_300,
      },
      {
        component: ios,
        environment: production,
        release: ReleaseVersion.make("0.2.0+10"),
        people: 610,
        installations: 640,
        sessions: 6_420,
      },
      {
        component: ios,
        environment: production,
        release: ReleaseVersion.make("0.3.1+21"),
        people: 42,
        installations: 42,
        sessions: 490,
      },
    ],
  }
}

/** Usage over all of the period, every week and month counted. */
export const sampleUsage = usageFrom(0)

/** Usage of an app that first sent 12 days ago: the days before, and the weeks and months reaching them, are unknown. */
export const sampleUsageSinceRecently = usageFrom(18)

/** Weekly cohorts: of the people first seen each week, those active in each week since. */
export const sampleCohorts: ReadonlyArray<RetentionCohort> = [
  { week: dayOf(1), people: 1_420, active: [1_420, 610, 480, 402, 120] },
  { week: dayOf(8), people: 1_180, active: [1_180, 540, 410, 96] },
  { week: dayOf(15), people: 1_302, active: [1_302, 590, 140] },
  { week: dayOf(22), people: 960, active: [960, 210] },
  { week: dayOf(29), people: 140, active: [140] },
]

const launches = (count: number, p50: number, p95: number) => ({
  launches: count,
  firstFrameP50Ms: p50,
  firstFrameP95Ms: p95,
  ready: { launches: Math.round(count * 0.7), p50Ms: p50 + 380, p95Ms: p95 + 520 },
})

const release = (version: string, previous: string | undefined, firstSeenAgo: number) => ({
  component: ios,
  environment: production,
  release: ReleaseVersion.make(version),
  firstSeen: at(sampleNow - firstSeenAgo),
  lastSeen: at(sampleNow - 2 * minute),
  ...(previous === undefined ? {} : { previous: ReleaseVersion.make(previous) }),
})

const steady = {
  sessions: 6_420,
  people: 610,
  cold: launches(1_840, 540, 780),
  warm: launches(4_100, 210, 300),
  prewarmed: 420,
  memory: { samples: 6_400, peakP95Bytes: 182_000_000, footprintP95Bytes: 150_000_000 },
  diagnostics: { reports: 30, crashes: 11, hangs: 26, cpuExceptions: 0, diskWriteExceptions: 1 },
}

// A release that sent no memory measurements: unknown, so not compared.
const { memory: _, ...withoutMemory } = steady

/** Releases' app health, one of each verdict, the latest first seen first. */
export const sampleHealth: ReadonlyArray<ReleaseHealth> = [
  {
    release: release("0.3.1+21", "0.3.0+20", 40 * minute),
    health: { sessions: 490, people: 42, cold: launches(31, 610, 690), prewarmed: 4 },
    previousHealth: { ...steady, sessions: 41_300, people: 4_980, cold: launches(9_800, 1_210, 1_640) },
    previousCrashesPerThousand: 22.7,
    previousHangsPerThousand: 4.1,
    verdict: "tooEarly",
    worse: [],
    better: [],
  },
  {
    release: release("0.3.0+20", "0.2.0+10", 12 * day),
    health: {
      ...steady,
      sessions: 41_300,
      people: 4_980,
      cold: launches(9_800, 1_210, 1_640),
      diagnostics: { reports: 120, crashes: 937, hangs: 170, cpuExceptions: 2, diskWriteExceptions: 0 },
    },
    previousHealth: steady,
    crashesPerThousand: 22.7,
    hangsPerThousand: 4.1,
    previousCrashesPerThousand: 1.7,
    previousHangsPerThousand: 4,
    verdict: "worse",
    worse: ["coldLaunch", "crashes"],
    better: [],
  },
  {
    release: release("0.2.0+10", "0.1.2+8", 45 * day),
    health: steady,
    previousHealth: { ...withoutMemory, warm: launches(3_900, 260, 420) },
    crashesPerThousand: 1.7,
    hangsPerThousand: 4,
    previousCrashesPerThousand: 1.9,
    previousHangsPerThousand: 4.6,
    verdict: "better",
    worse: [],
    better: ["warmLaunch"],
  },
  {
    release: release("0.1.2+8", "0.1.1+7", 60 * day),
    health: steady,
    previousHealth: steady,
    crashesPerThousand: 1.9,
    hangsPerThousand: 4.6,
    previousCrashesPerThousand: 1.8,
    previousHangsPerThousand: 4.4,
    verdict: "same",
    worse: [],
    better: [],
  },
  {
    release: { ...release("0.4.0+25", undefined, 2 * day), environment: EnvironmentKey.make("beta") },
    health: { sessions: 15, people: 5, cold: launches(5, 600, 720), prewarmed: 0 },
    verdict: "first",
    worse: [],
    better: [],
  },
]

/** Features by use; sync's memory was never measured, and "(no feature)" is what the app marked with none. */
export const sampleFeatures: ReadonlyArray<FeatureUse> = [
  {
    people: 5_105,
    events: 0,
    screens: 31_200,
    memory: { samples: 9_000, peakP95Bytes: 186_000_000, footprintP95Bytes: 150_000_000 },
  },
  {
    feature: FeatureKey.make("notes.edit"),
    people: 4_310,
    events: 22_104,
    screens: 18_420,
    memory: { samples: 6_100, peakP95Bytes: 214_000_000, footprintP95Bytes: 171_000_000 },
  },
  {
    feature: FeatureKey.make("notes.search"),
    people: 2_980,
    events: 9_810,
    screens: 7_002,
    memory: { samples: 3_100, peakP95Bytes: 223_000_000, footprintP95Bytes: 182_000_000 },
  },
  { feature: FeatureKey.make("notes.share"), people: 812, events: 1_240, screens: 990 },
  { feature: FeatureKey.make("sync"), people: 5_020, events: 40_210, screens: 0 },
]

const installation = InstallationId.make("019a0fd1-2c3e-7a10-8b2d-4e5f60718293")

/** One person's installations: an iPhone, and the iPad they stopped using. */
export const sampleInstallations: ReadonlyArray<AppInstallation> = [
  {
    installation,
    component: ios,
    environment: production,
    release: ReleaseVersion.make("0.3.0+20"),
    device: { model: "iPhone17,2", platform: "iOS", osVersion: "27.1", locale: "en-US", timeZone: "America/New_York" },
    sdk: { name: "cluenori-swift", version: "0.1.0" },
    country: CountryCode.make("US"),
    firstSeen: at(sampleNow - 40 * day),
    lastSeen: at(sampleNow - 20 * minute),
  },
  {
    installation: InstallationId.make("019a0fd1-2c3e-7a10-8b2d-4e5f60718294"),
    component: ios,
    environment: production,
    release: ReleaseVersion.make("0.2.0+10"),
    device: { model: "iPad16,3", platform: "iPadOS", osVersion: "26.4", locale: "en-US", timeZone: "America/New_York" },
    sdk: { name: "cluenori-swift", version: "0.1.0" },
    firstSeen: at(sampleNow - 38 * day),
    lastSeen: at(sampleNow - 9 * day),
  },
]

/** Their sessions on the days they were active. */
export const samplePersonDays = [0, 1, 2, 4, 7, 8, 11, 15, 16, 22, 29, 30, 33, 36, 38].map((ago, index) => ({
  day: CalendarDay.make(DateTime.formatIso(at(sampleNow - ago * day)).slice(0, 10)),
  sessions: 1 + (index % 3),
  foregroundMs: (4 + index) * minute,
}))

const session = SessionId.make("019a1001-0000-7000-8000-000000000001")
const signalId = (index: number) => AppSignalId.make(`019a1001-0000-7000-8000-${String(index).padStart(12, "0")}`)
const entry = (signal: TimelineEntry["signal"]): TimelineEntry => ({
  component: ios,
  environment: production,
  release: ReleaseVersion.make("0.3.0+20"),
  installation,
  signal,
})
const user = AppUserId.make("user-1842")

/** What they did in their latest session, newest first, and a MetricKit report the day before. */
export const sampleTimeline: ReadonlyArray<TimelineEntry> = [
  entry({
    _tag: "session.ended",
    id: signalId(7),
    at: at(sampleNow - 20 * minute),
    session,
    user,
    foregroundMs: 252_000,
  }),
  entry({
    _tag: "event",
    id: signalId(6),
    at: at(sampleNow - 23 * minute),
    session,
    user,
    feature: FeatureKey.make("notes.share"),
    name: EnvelopeName.make("note.shared"),
    properties: { channel: "messages", attachments: 2 },
  }),
  entry({
    _tag: "screen",
    id: signalId(5),
    at: at(sampleNow - 24 * minute),
    session,
    user,
    feature: FeatureKey.make("notes.share"),
    screen: EnvelopeName.make("share"),
  }),
  entry({
    _tag: "event",
    id: signalId(4),
    at: at(sampleNow - 26 * minute),
    session,
    user,
    feature: FeatureKey.make("notes.edit"),
    name: EnvelopeName.make("note.edited"),
  }),
  entry({
    _tag: "screen",
    id: signalId(3),
    at: at(sampleNow - 27 * minute),
    session,
    user,
    feature: FeatureKey.make("notes.edit"),
    screen: EnvelopeName.make("note"),
  }),
  entry({
    _tag: "app.launched",
    id: signalId(2),
    at: at(sampleNow - 25 * minute - 4 * minute),
    session,
    user,
    start: "cold",
    prewarmed: false,
    firstFrameMs: 1_480,
    readyMs: 2_110,
  }),
  entry({ _tag: "session.started", id: signalId(1), at: at(sampleNow - 29 * minute), session, user }),
  entry({
    _tag: "metrickit",
    id: signalId(0),
    at: at(sampleNow - 18 * hour),
    report: "diagnostics",
    crashes: 1,
    hangs: 0,
  }),
]

/** A person's ID, as Cluenori gave it. */
export const samplePerson = PersonId.make("019a0fd1-2c3e-7a10-8b2d-4e5f60718200")

/** notes-ios's SDK keys: the one its builds carry now, and the one older builds carried, revoked. */
export const sampleKeys: ReadonlyArray<IssuedSdkKey> = [
  {
    key: SdkKey.make("cluenori-sdk.notesapp.notes-ios.Q2x1ZW5vcmlTYW1wbGUwMQ"),
    component: ios,
    issuedAt: at(sampleNow - 3 * day),
  },
  {
    key: SdkKey.make("cluenori-sdk.notesapp.notes-ios.T2xkZXJLZXlTYW1wbGUwMg"),
    component: ios,
    issuedAt: at(sampleNow - 90 * day),
    revokedAt: at(sampleNow - 2 * day),
  },
]

/** notes-ios's version policy: 0.2.0 must update, 0.3.1 is offered, in the project's English words. */
export const samplePolicy: ComponentVersionPolicy = {
  component: ios,
  minimum: StoreVersion.make("0.2.0"),
  recommended: StoreVersion.make("0.3.1"),
  storeUrl: "https://apps.apple.com/app/id0000000000",
  minimumOsVersion: StoreVersion.make("26.0"),
  words: [
    {
      locale: NoteLocale.make("en-US"),
      decision: "require",
      text: {
        title: "Update Notes",
        message: "This version of Notes no longer syncs. Update to keep your notes in step.",
      },
    },
  ],
  setAt: at(sampleNow - 2 * day),
}
