import { AppHealthList } from "@cluenori/analytics"
import type { ReleaseHealth } from "@cluenori/analytics"
import {
  calendarDayOf,
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
import { IssuedSdkKey, SdkKey, SdkKeyList, SdkKeyNotFound } from "@cluenori/projects"
import {
  ComponentVersionPolicy,
  compareStoreVersions,
  VersionPolicies,
  VersionPolicyRefused,
  VersionPolicyTo,
} from "@cluenori/releases"
import type { UsageDay } from "@cluenori/signals"
import {
  AppPerson,
  AppRetention,
  AppSignalId,
  AppUsage,
  AppUserId,
  FeatureUseTable,
  PersonNotFound,
} from "@cluenori/signals"
import { Clock, DateTime, Effect, Schema } from "effect"

import type { AnswerApi, ApiCall } from "./fake-api.ts"
import { reply } from "./fake-api.ts"

// Notes's iPhone app, notes-ios, as the public API answers Analytics' questions about it, its SDK keys
// and its version policy; made up. Landing's apps sent nothing. Every answer is made for the period
// asked about, so pages read it as they would a deployment's, whenever the tests run.

const minute = 60_000
const hour = 60 * minute
const day = 24 * hour

const ios = ComponentKey.make("notes-ios")
const production = EnvironmentKey.make("production")
const beta = EnvironmentKey.make("beta")

/** The user ID of the one person the apps sent, and their person. */
export const knownUser = AppUserId.make("user-1842")
const person = PersonId.make("019a0fd1-2c3e-7a10-8b2d-4e5f60718200")
const installation = InstallationId.make("019a0fd1-2c3e-7a10-8b2d-4e5f60718293")
const session = SessionId.make("019a1001-0000-7000-8000-000000000001")

/** The SDK key notes-ios's builds carry at first. */
export const firstKey = SdkKey.make("cluenori-sdk.notes.notes-ios.Rmlyc3RLZXlPZk5vdGVzMA")
/** The SDK key the fake API issues next. */
export const issuedKey = SdkKey.make("cluenori-sdk.notes.notes-ios.TmV3S2V5T2ZOb3RlczAwMg")

const at = (millis: number) => DateTime.makeUnsafe(millis)

// The asked period, decoded from the call's query.
const AppQuery = Schema.Struct({
  from: Schema.DateTimeUtcFromString,
  to: Schema.DateTimeUtcFromString,
  component: Schema.optionalKey(Schema.String),
  environment: Schema.optionalKey(Schema.String),
  release: Schema.optionalKey(Schema.String),
})

const PolicyBody = Schema.fromJsonString(VersionPolicyTo)

// The app first sent 20 days ago: the days before aren't counted, nor the weeks and months reaching them.
const firstSentAgo = 20 * day

const usageOf = (from: number, to: number, release: string | undefined): AppUsage => {
  const firstSent = to - firstSentAgo
  const start = Math.max(from, firstSent)
  if (start >= to) {
    return { days: [], people: 0, installations: 0, sessions: 0, releases: [] }
  }
  const firstDay = Math.floor(start / day)
  const lastDay = Math.floor(to / day)
  const sentDay = Math.floor(firstSent / day)
  const scale = release === undefined ? 1 : 0.8
  const days: ReadonlyArray<UsageDay> = Array.from({ length: lastDay - firstDay + 1 }, (_, index) => {
    const number = firstDay + index
    const people = Math.round((40 + (index % 7) * 3) * scale)
    return {
      day: calendarDayOf(at(number * day)),
      people,
      installations: people,
      ...(number - sentDay >= 6 ? { weekPeople: Math.round(180 * scale) } : {}),
      sessions: people * 2,
      foregroundMs: people * 6 * minute,
    }
  })
  return {
    covered: new Period({ from: at(start), to: at(to) }),
    days,
    people: Math.round(320 * scale),
    installations: Math.round(330 * scale),
    sessions: Math.round(910 * scale),
    sessionsPerPerson: 2.8,
    releases: [
      {
        component: ios,
        environment: production,
        release: ReleaseVersion.make("0.3.0+20"),
        people: 256,
        installations: 260,
        sessions: 700,
      },
      {
        component: ios,
        environment: production,
        release: ReleaseVersion.make("0.2.0+10"),
        people: 64,
        installations: 70,
        sessions: 210,
      },
    ],
  }
}

const launches = (count: number, p50: number, p95: number) => ({
  launches: count,
  firstFrameP50Ms: p50,
  firstFrameP95Ms: p95,
})

const healthOf = (to: number): ReadonlyArray<ReleaseHealth> => {
  const steady = {
    sessions: 900,
    people: 120,
    cold: launches(300, 520, 780),
    warm: launches(600, 200, 290),
    prewarmed: 40,
    memory: { samples: 900, peakP95Bytes: 182_000_000, footprintP95Bytes: 150_000_000 },
    diagnostics: { reports: 9, crashes: 2, hangs: 4, cpuExceptions: 0, diskWriteExceptions: 0 },
  }
  // Before MetricKit reported of a release, its crashes are unknown.
  const { diagnostics: _, ...unreported } = steady
  const release = (version: string, environment: EnvironmentKey, firstSeenAgo: number, previous?: string) => ({
    component: ios,
    environment,
    release: ReleaseVersion.make(version),
    firstSeen: at(to - firstSeenAgo),
    lastSeen: at(to - 3 * minute),
    ...(previous === undefined ? {} : { previous: ReleaseVersion.make(previous) }),
  })
  const list: ReadonlyArray<ReleaseHealth> = [
    {
      release: release("0.4.0+25", beta, 2 * day),
      health: { sessions: 15, people: 5, cold: launches(5, 600, 720), prewarmed: 0 },
      verdict: "first",
      worse: [],
      better: [],
    },
    {
      release: release("0.3.0+20", production, 12 * day, "0.2.0+10"),
      health: {
        ...steady,
        sessions: 700,
        people: 256,
        cold: launches(240, 1_210, 1_640),
        diagnostics: { ...steady.diagnostics, crashes: 16 },
      },
      previousHealth: steady,
      crashesPerThousand: 22.9,
      hangsPerThousand: 5.7,
      previousCrashesPerThousand: 2.2,
      previousHangsPerThousand: 4.4,
      verdict: "worse",
      worse: ["coldLaunch", "crashes"],
      better: [],
    },
    {
      release: release("0.2.0+10", production, 19 * day),
      health: unreported,
      verdict: "first",
      worse: [],
      better: [],
    },
  ]
  return list
}

const personOf = (to: number): AppPerson => ({
  person,
  users: [knownUser],
  firstSeen: at(to - 15 * day),
  lastSeen: at(to - 20 * minute),
  installations: [
    {
      installation,
      component: ios,
      environment: production,
      release: ReleaseVersion.make("0.3.0+20"),
      device: {
        model: "iPhone17,2",
        platform: "iOS",
        osVersion: "27.1",
        locale: "en-US",
        timeZone: "America/New_York",
      },
      sdk: { name: "cluenori-swift", version: "0.1.0" },
      firstSeen: at(to - 15 * day),
      lastSeen: at(to - 20 * minute),
    },
  ],
  days: [0, 2, 5, 9, 15].map((ago) => ({
    day: calendarDayOf(at(to - ago * day)),
    sessions: 2,
    foregroundMs: 9 * minute,
  })),
  timeline: [
    {
      component: ios,
      environment: production,
      release: ReleaseVersion.make("0.3.0+20"),
      installation,
      signal: {
        _tag: "event",
        id: AppSignalId.make("019a1001-0000-7000-8000-000000000002"),
        at: at(to - 22 * minute),
        session,
        user: knownUser,
        feature: FeatureKey.make("notes.share"),
        name: EnvelopeName.make("note.shared"),
      },
    },
    {
      component: ios,
      environment: production,
      release: ReleaseVersion.make("0.3.0+20"),
      installation,
      signal: {
        _tag: "app.launched",
        id: AppSignalId.make("019a1001-0000-7000-8000-000000000001"),
        at: at(to - 25 * minute),
        session,
        user: knownUser,
        start: "cold",
        prewarmed: false,
        firstFrameMs: 1_480,
      },
    },
  ],
})

/**
 * The public API of `api`, with Notes's app answering Analytics' questions, its SDK keys and its
 * version policy, which the dashboard changes as it would a deployment's; Landing's apps sent
 * nothing. Any other call goes to `api`.
 */
export const withApps = (api: AnswerApi): AnswerApi => {
  let keys: ReadonlyArray<IssuedSdkKey> = [new IssuedSdkKey({ key: firstKey, component: ios, issuedAt: at(0) })]
  let policies: ReadonlyArray<ComponentVersionPolicy> = []
  let issued = false
  return (call: ApiCall) =>
    Effect.gen(function* () {
      const [first, project, area, id, more, action] = call.path
      const now = yield* Clock.currentTimeMillis
      if (first !== "projects" || project === undefined || area === undefined) {
        return yield* api(call)
      }
      const notes = project === "notes"
      if (
        call.method === "GET" &&
        (area === "usage" || area === "retention" || area === "app-health" || area === "feature-use")
      ) {
        const query = yield* Schema.decodeUnknownEffect(AppQuery)(Object.fromEntries(call.query)).pipe(Effect.orDie)
        const from = DateTime.toEpochMillis(query.from)
        const to = DateTime.toEpochMillis(query.to)
        const environments = (each: { readonly release: { readonly environment: string } }) =>
          query.environment === undefined || each.release.environment === query.environment
        if (area === "usage") {
          const usage = notes ? usageOf(from, to, query.release) : usageOf(to, to, undefined)
          return yield* reply(AppUsage, usage)
        }
        if (area === "retention") {
          return yield* reply(AppRetention, {
            cohorts: notes
              ? [
                  { week: calendarDayOf(at(to - 14 * day)), people: 120, active: [120, 54, 31] },
                  { week: calendarDayOf(at(to - 7 * day)), people: 90, active: [90, 30] },
                  { week: calendarDayOf(at(to)), people: 40, active: [40] },
                ]
              : [],
            currentWeek: calendarDayOf(at(to)),
          })
        }
        if (area === "app-health") {
          return yield* reply(AppHealthList, { releases: notes ? healthOf(to).filter(environments) : [] })
        }
        return yield* reply(FeatureUseTable, {
          features: notes
            ? [
                { people: 320, events: 0, screens: 1_200 },
                {
                  feature: FeatureKey.make("notes.edit"),
                  people: 280,
                  events: 900,
                  screens: 800,
                  memory: { samples: 400, peakP95Bytes: 214_000_000, footprintP95Bytes: 171_000_000 },
                },
                { feature: FeatureKey.make("notes.share"), people: 61, events: 120, screens: 90 },
              ]
            : [],
        })
      }
      if (call.method === "GET" && area === "people" && id === undefined) {
        const user = call.query.get("user")
        return notes && user === knownUser
          ? yield* reply(AppPerson, personOf(now))
          : yield* reply(PersonNotFound, new PersonNotFound(), 404)
      }
      if (area === "version-policies") {
        if (call.method === "GET" && id === undefined) {
          return yield* reply(VersionPolicies, { policies })
        }
        if (call.method === "DELETE" && id !== undefined) {
          policies = policies.filter((each) => each.component !== id)
          return { status: 204 }
        }
        if (call.method === "PUT" && id !== undefined) {
          const payload = yield* Schema.decodeEffect(PolicyBody)(call.body ?? "").pipe(Effect.orDie)
          // notes-ios has no App Store deploy target, so its store page must be given.
          if (payload.storeUrl === undefined) {
            return yield* reply(
              VersionPolicyRefused,
              new VersionPolicyRefused({
                reason: `${id} has no store URL, and none was found from an App Store deploy target`,
              }),
              422,
            )
          }
          if (
            payload.minimum !== undefined &&
            payload.recommended !== undefined &&
            compareStoreVersions(payload.recommended, payload.minimum) < 0
          ) {
            return yield* Effect.die("The dashboard sent a recommended version lower than the minimum.")
          }
          const policy: ComponentVersionPolicy = {
            component: ComponentKey.make(id),
            ...payload,
            storeUrl: payload.storeUrl,
            words: payload.words ?? [],
            setAt: at(now),
          }
          policies = [...policies.filter((each) => each.component !== id), policy]
          return yield* reply(ComponentVersionPolicy, policy)
        }
      }
      if (area === "components" && more === "sdk-keys" && id === "notes-ios") {
        if (call.method === "GET" && action === undefined) {
          return yield* reply(SdkKeyList, { keys })
        }
        if (call.method === "POST" && action === undefined) {
          const key = new IssuedSdkKey({ key: issued ? firstKey : issuedKey, component: ios, issuedAt: at(now) })
          issued = true
          keys = [key, ...keys]
          return yield* reply(IssuedSdkKey, key, 201)
        }
        if (call.method === "POST" && call.path[6] === "revoke" && action !== undefined) {
          const found = keys.find((each) => each.key === action)
          if (found === undefined) {
            return yield* reply(SdkKeyNotFound, new SdkKeyNotFound({ key: SdkKey.make(action) }), 404)
          }
          const revoked = new IssuedSdkKey({
            key: found.key,
            component: found.component,
            issuedAt: found.issuedAt,
            revokedAt: found.revokedAt ?? at(now),
          })
          keys = keys.map((each) => (each.key === action ? revoked : each))
          return yield* reply(IssuedSdkKey, revoked)
        }
      }
      if (call.method === "GET" && area === "components" && more === "sdk-keys") {
        return yield* reply(SdkKeyList, { keys: [] })
      }
      return yield* api(call)
    })
}
