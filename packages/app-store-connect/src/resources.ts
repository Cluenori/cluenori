import type { DateTime } from "effect"
import { Array as Arr, Effect, Option, Schema } from "effect"

/** An app in App Store Connect: its Apple ID, its name on the App Store, and its bundle ID. */
export interface App {
  readonly id: string
  readonly name: string
  readonly bundleId: string
}

/** A build uploaded to App Store Connect, and where it is in TestFlight. */
export interface Build {
  readonly id: string
  /** Its marketing version, `CFBundleShortVersionString`, such as `2.4.0`. */
  readonly version: string
  /** Its build number, `CFBundleVersion`, such as `412`. */
  readonly buildNumber: string
  readonly uploadedAt: DateTime.Utc
  /** `PROCESSING`, `FAILED`, `INVALID`, or `VALID`, as Apple says it. */
  readonly processingState: string
  /** An expired build can no longer be tested. */
  readonly expired: boolean
  /** Its state for internal testers, such as `IN_BETA_TESTING`; absent when Apple gives none. */
  readonly internalTesting?: string
  /** Its state for external testers, such as `BETA_APPROVED`; absent when Apple gives none. */
  readonly externalTesting?: string
}

/** A version of an app on the App Store, from being prepared to being released. */
export interface AppStoreVersion {
  readonly id: string
  /** Its version, such as `2.4.0`. */
  readonly version: string
  /** Where it is, such as `WAITING_FOR_REVIEW` or `READY_FOR_DISTRIBUTION`, as Apple says it. */
  readonly state: string
  /** `MANUAL`, `AFTER_APPROVAL`, or `SCHEDULED`; absent when Apple gives none. */
  readonly releaseType?: string
  /** When it was made in App Store Connect, not when it was released. */
  readonly createdAt: DateTime.Utc
  /** The earliest it may be released, for a scheduled release. */
  readonly earliestReleaseAt?: DateTime.Utc
  /** The build number of the build it ships; absent until one is chosen. */
  readonly buildNumber?: string
  /** Its release to users over 7 days; absent when it has none. */
  readonly phasedRelease?: {
    /** `INACTIVE`, `ACTIVE`, `PAUSED`, or `COMPLETE`, as Apple says it. */
    readonly state: string
    readonly startedAt?: DateTime.Utc
    /** Which day of the 7 it is on, from 1. */
    readonly currentDay?: number
  }
}

// Apple's API is JSON:API: each resource has a type and an ID, its attributes, and relationships
// that name related resources, which `include` adds to the document's `included`. Attributes Apple
// leaves out or sends as null are both absent here; what this client needs is required, so an
// answer without it fails loudly. Every other field is ignored.

const Text = Schema.optionalKey(Schema.NullOr(Schema.String))
const Instant = Schema.optionalKey(Schema.NullOr(Schema.DateTimeUtcFromString))

// The type and ID of a related resource, as a relationship names it.
const Linkage = Schema.Struct({ type: Schema.String, id: Schema.String })
type Linkage = typeof Linkage.Type

// A relationship that `include` asked for, which may have no resource: an app version without a build.
const MaybeRelated = Schema.Struct({ data: Schema.optionalKey(Schema.NullOr(Linkage)) })

const AppResource = Schema.Struct({
  type: Schema.Literal("apps"),
  id: Schema.String,
  attributes: Schema.Struct({ name: Schema.String, bundleId: Schema.String }),
})

/** Apple's answer to `GET /v1/apps`. */
export const AppsDocument = Schema.Struct({ data: Schema.Array(AppResource) })

const BuildResource = Schema.Struct({
  type: Schema.Literal("builds"),
  id: Schema.String,
  attributes: Schema.Struct({
    version: Schema.String,
    uploadedDate: Schema.DateTimeUtcFromString,
    processingState: Schema.String,
    expired: Schema.Boolean,
  }),
  relationships: Schema.Struct({
    // Every build belongs to a prerelease version, which holds its marketing version.
    preReleaseVersion: Schema.Struct({ data: Linkage }),
    buildBetaDetail: MaybeRelated,
  }),
})

const PreReleaseVersionResource = Schema.Struct({
  type: Schema.Literal("preReleaseVersions"),
  id: Schema.String,
  attributes: Schema.Struct({ version: Schema.String }),
})

const BuildBetaDetailResource = Schema.Struct({
  type: Schema.Literal("buildBetaDetails"),
  id: Schema.String,
  attributes: Schema.Struct({ internalBuildState: Text, externalBuildState: Text }),
})

/** Apple's answer to `GET /v1/builds?include=preReleaseVersion,buildBetaDetail`. */
export const BuildsDocument = Schema.Struct({
  data: Schema.Array(BuildResource),
  included: Schema.optionalKey(Schema.Array(Schema.Union([PreReleaseVersionResource, BuildBetaDetailResource]))),
})
type BuildsDocument = typeof BuildsDocument.Type

const AppStoreVersionResource = Schema.Struct({
  type: Schema.Literal("appStoreVersions"),
  id: Schema.String,
  attributes: Schema.Struct({
    versionString: Schema.String,
    appVersionState: Text,
    // Deprecated by Apple for `appVersionState`, which older answers may lack.
    appStoreState: Text,
    releaseType: Text,
    createdDate: Schema.DateTimeUtcFromString,
    earliestReleaseDate: Instant,
  }),
  relationships: Schema.Struct({ build: MaybeRelated, appStoreVersionPhasedRelease: MaybeRelated }),
})

const ShippedBuildResource = Schema.Struct({
  type: Schema.Literal("builds"),
  id: Schema.String,
  attributes: Schema.Struct({ version: Schema.String }),
})

const PhasedReleaseResource = Schema.Struct({
  type: Schema.Literal("appStoreVersionPhasedReleases"),
  id: Schema.String,
  attributes: Schema.Struct({
    phasedReleaseState: Schema.String,
    startDate: Instant,
    currentDayNumber: Schema.optionalKey(Schema.NullOr(Schema.Int)),
  }),
})

/** One page of Apple's answer to `GET /v1/apps/{id}/appStoreVersions?include=build,appStoreVersionPhasedRelease`. */
export const AppStoreVersionsDocument = Schema.Struct({
  data: Schema.Array(AppStoreVersionResource),
  included: Schema.optionalKey(Schema.Array(Schema.Union([ShippedBuildResource, PhasedReleaseResource]))),
  links: Schema.Struct({ next: Schema.optionalKey(Schema.String) }),
})
type AppStoreVersionsDocument = typeof AppStoreVersionsDocument.Type

/** The answer's app with exactly this bundle ID, if any: Apple's filter isn't documented as exact. */
export const appOf = (document: typeof AppsDocument.Type, bundleId: string): Option.Option<App> =>
  Option.map(
    Arr.findFirst(document.data, (app) => app.attributes.bundleId === bundleId),
    (app) => ({ id: app.id, name: app.attributes.name, bundleId: app.attributes.bundleId }),
  )

/** The answer's builds, in its order, each with its marketing version and testing states. */
export const buildsOf = (document: BuildsDocument) =>
  Effect.forEach(document.data, (build) => buildOf(build, document.included ?? []))

/** The answer's versions, in its order, each with the build number it ships and its phased release. */
export const appStoreVersionsOf = (document: AppStoreVersionsDocument) =>
  Effect.forEach(document.data, (version) => appStoreVersionOf(version, document.included ?? []))

const buildOf = Effect.fnUntraced(function* (
  build: typeof BuildResource.Type,
  included: ReadonlyArray<typeof PreReleaseVersionResource.Type | typeof BuildBetaDetailResource.Type>,
) {
  const preReleaseVersion = yield* related(included, "preReleaseVersions", build.relationships.preReleaseVersion.data)
  const betaDetail = yield* maybeRelated(included, "buildBetaDetails", build.relationships.buildBetaDetail.data)
  const internalTesting = Option.getOrUndefined(betaDetail)?.attributes.internalBuildState ?? undefined
  const externalTesting = Option.getOrUndefined(betaDetail)?.attributes.externalBuildState ?? undefined
  const result: Build = {
    id: build.id,
    version: preReleaseVersion.attributes.version,
    buildNumber: build.attributes.version,
    uploadedAt: build.attributes.uploadedDate,
    processingState: build.attributes.processingState,
    expired: build.attributes.expired,
    ...(internalTesting === undefined ? {} : { internalTesting }),
    ...(externalTesting === undefined ? {} : { externalTesting }),
  }
  return result
})

const appStoreVersionOf = Effect.fnUntraced(function* (
  version: typeof AppStoreVersionResource.Type,
  included: ReadonlyArray<typeof ShippedBuildResource.Type | typeof PhasedReleaseResource.Type>,
) {
  const attributes = version.attributes
  const state = attributes.appVersionState ?? attributes.appStoreState ?? undefined
  if (state === undefined) {
    return yield* Effect.die(`App Store Connect gave App Store version ${version.id} no state`)
  }
  const build = yield* maybeRelated(included, "builds", version.relationships.build.data)
  const phased = yield* maybeRelated(
    included,
    "appStoreVersionPhasedReleases",
    version.relationships.appStoreVersionPhasedRelease.data,
  )
  const releaseType = attributes.releaseType ?? undefined
  const earliestReleaseAt = attributes.earliestReleaseDate ?? undefined
  const result: AppStoreVersion = {
    id: version.id,
    version: attributes.versionString,
    state,
    createdAt: attributes.createdDate,
    ...(releaseType === undefined ? {} : { releaseType }),
    ...(earliestReleaseAt === undefined ? {} : { earliestReleaseAt }),
    ...(Option.isSome(build) ? { buildNumber: build.value.attributes.version } : {}),
    ...(Option.isSome(phased) ? { phasedRelease: phasedReleaseOf(phased.value) } : {}),
  }
  return result
})

const phasedReleaseOf = (phased: typeof PhasedReleaseResource.Type): NonNullable<AppStoreVersion["phasedRelease"]> => {
  const startedAt = phased.attributes.startDate ?? undefined
  const currentDay = phased.attributes.currentDayNumber ?? undefined
  return {
    state: phased.attributes.phasedReleaseState,
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(currentDay === undefined ? {} : { currentDay }),
  }
}

// The included resource a relationship names. A document that names one without including it, though
// `include` asked for it, isn't one this client can read.
const related = <R extends Linkage, T extends R["type"]>(
  included: ReadonlyArray<R>,
  type: T,
  linkage: Linkage,
): Effect.Effect<Extract<R, { readonly type: T }>> => {
  const found = Arr.findFirst(
    included,
    (resource): resource is Extract<R, { readonly type: T }> => resource.type === type && resource.id === linkage.id,
  )
  if (Option.isNone(found)) {
    return Effect.die(
      `App Store Connect's answer relates ${linkage.type} ${linkage.id}, which it doesn't include among its ${type}`,
    )
  }
  return Effect.succeed(found.value)
}

// The included resource a relationship names, or none when it names none.
const maybeRelated = <R extends Linkage, T extends R["type"]>(
  included: ReadonlyArray<R>,
  type: T,
  linkage: Linkage | null | undefined,
): Effect.Effect<Option.Option<Extract<R, { readonly type: T }>>> => {
  if (linkage === null || linkage === undefined) {
    return Effect.succeedNone
  }
  return Effect.asSome(related(included, type, linkage))
}
