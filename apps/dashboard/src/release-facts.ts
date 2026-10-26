// What the releases pages say about promotions, deploy targets and versions, worked out once from
// the API's answers. Only those pages say these, so they load with them, not with the first load
// (`src/project-facts.ts` has the rules every page says). Every rule is pure.

import type { ComponentKey, EnvironmentKey, MemberId, ReleaseVersion } from "@cluenori/foundation"
import type { Member } from "@cluenori/members"
import type { DeployTarget } from "@cluenori/projects"
import type {
  ComponentDelivery,
  ComponentVersion,
  Delivery,
  EnvironmentDelivery,
  LifeTotals,
  NextStep,
  Promotion,
  PromotionState,
  ReleaseDetail,
} from "@cluenori/releases"
import { hasEnded } from "@cluenori/releases"
import { DateTime } from "effect"

import { clockTime, dayOf, moment } from "@/lib/format"

// ---- Promotions ------------------------------------------------------------------------------------

/**
 * How a promotion's state reads: moving on GitHub or in App Store Connect (starting, queued,
 * running, processing, in review), waiting for someone (to approve its environment on GitHub, or to
 * release it once App Store review approved it), succeeded, failed or rejected, cancelled, or no
 * longer followed.
 */
export type PromotionTone = "moving" | "waiting" | "succeeded" | "failed" | "cancelled" | "lost"

/** Each state of a promotion in words, and its tone. */
export const promotionStates: Readonly<
  Record<PromotionState, { readonly words: string; readonly tone: PromotionTone }>
> = {
  starting: { words: "Starting", tone: "moving" },
  queued: { words: "Queued", tone: "moving" },
  waiting: { words: "Waiting for approval on GitHub", tone: "waiting" },
  running: { words: "Running", tone: "moving" },
  processing: { words: "Processing in App Store Connect", tone: "moving" },
  inReview: { words: "In App Store review", tone: "moving" },
  approved: { words: "Approved", tone: "waiting" },
  releasing: { words: "Releasing on the App Store", tone: "moving" },
  succeeded: { words: "Succeeded", tone: "succeeded" },
  failed: { words: "Failed", tone: "failed" },
  cancelled: { words: "Cancelled", tone: "cancelled" },
  rejected: { words: "Rejected in review", tone: "failed" },
  lost: { words: "Not followed — see GitHub", tone: "lost" },
}

/**
 * How a promotion that didn't get its release where it went ended, as the end of "Promoting 1.0.0+1
 * to prod …": "failed", "was cancelled", "was rejected in App Store review", or, when Cluenori
 * stopped following it, "wasn't followed to its end". The others say how far it got.
 */
export const failedEndingOf = (state: PromotionState) => {
  switch (state) {
    case "failed":
      return "failed"
    case "cancelled":
      return "was cancelled"
    case "rejected":
      return "was rejected in App Store review"
    case "lost":
      return "wasn't followed to its end"
    case "starting":
    case "queued":
    case "waiting":
    case "running":
    case "processing":
    case "inReview":
    case "approved":
    case "releasing":
    case "succeeded":
      return promotionStates[state].words.toLowerCase()
  }
}

/** How often a release's page asks again while a promotion of it runs: Cluenori asks GitHub each minute. */
export const promotionsAskedEveryMs = 15_000

/** Whether any of `promotions` hasn't ended, so its page asks for them again until each has. */
export const isFollowing = (promotions: ReadonlyArray<Promotion>) =>
  promotions.some((promotion) => !hasEnded(promotion.state))

/**
 * A release's promotions as its page shows them, the latest first: the API's, with one `started`
 * just now in front until the API's answer has it.
 */
export const promotionsShown = (
  promotions: ReadonlyArray<Promotion>,
  started: Promotion | undefined,
): ReadonlyArray<Promotion> =>
  started === undefined || promotions.some((promotion) => promotion.id === started.id)
    ? promotions
    : [started, ...promotions]

/**
 * Who started a promotion, in words: "you", a member by their email when the members are known,
 * "a member" when not, "an owner" for the first owner, who has none, and "an agent or process"
 * for one no member started.
 */
export const starterOf = (
  startedBy: MemberId | undefined,
  me: MemberId | undefined,
  members: ReadonlyArray<Member> | undefined,
) => {
  if (startedBy === undefined) {
    return "an agent or process"
  }
  if (startedBy === me) {
    return "you"
  }
  const member = members?.find((each) => each.id === startedBy)
  if (member === undefined) {
    return "a member"
  }
  return member.email ?? (member.role === "owner" ? "an owner" : "a member")
}

// ---- Deploy targets --------------------------------------------------------------------------------

/** Where an App Store Connect app's builds go, in words. */
export const distributionWords: Readonly<Record<"testFlight" | "appStore", string>> = {
  testFlight: "TestFlight",
  appStore: "App Store",
}

/** Whether a deploy target's builds go to App Store review, which needs the release's notes. */
export const goesToReview = (target: DeployTarget) => target.appStore?.distribution === "appStore"

/**
 * The environment a draft of a release's notes is for, by default: the target that goes to App
 * Store review, else the first that goes to an App Store Connect app, else the first.
 */
export const draftEnvironmentOf = (targets: ReadonlyArray<DeployTarget>): EnvironmentKey | undefined =>
  (targets.find(goesToReview) ?? targets.find((target) => target.appStore !== undefined) ?? targets[0])?.environment

/**
 * The components `component` may ship with: the project's others, but none that ships with it,
 * directly or through another, so no two ship with each other.
 */
export const shipsWithOptionsOf = (
  components: ReadonlyArray<{ readonly key: ComponentKey; readonly shipsWith?: ComponentKey }>,
  component: ComponentKey,
): ReadonlyArray<ComponentKey> => {
  const byKey = new Map(components.map((each) => [each.key, each] as const))
  const shipsWithIt = (each: { readonly shipsWith?: ComponentKey }, seen: ReadonlySet<ComponentKey>): boolean => {
    const parent = each.shipsWith
    if (parent === undefined || seen.has(parent)) {
      return false
    }
    const next = byKey.get(parent)
    return parent === component || (next !== undefined && shipsWithIt(next, new Set([...seen, parent])))
  }
  return components
    .filter((each) => each.key !== component && !shipsWithIt(each, new Set([each.key])))
    .map((each) => each.key)
}

// ---- Versions --------------------------------------------------------------------------------------

/** Which part of a version a bump raises. */
export type VersionPart = "patch" | "minor" | "major"

/** A version bumped: `1.4.2` is `1.4.3`, `1.5.0` or `2.0.0`, the parts after the one raised reset. */
export const bumpedVersion = (version: string, part: VersionPart) => {
  const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number)
  switch (part) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`
    case "minor":
      return `${major}.${minor + 1}.0`
    case "major":
      return `${major + 1}.0.0`
  }
}

/** The release a component's next build will be: `1.4.0+58` after build 57. */
export const nextReleaseOf = (line: ComponentVersion) => `${line.version}+${line.lastBuild + 1}`

// ---- Delivery -------------------------------------------------------------------------------------

/** A component's delivery, with those of the components that ship with it, which have nothing to do. */
export type DeliveryGroup = {
  readonly delivery: ComponentDelivery
  readonly shipping: ReadonlyArray<ComponentDelivery>
}

/**
 * Each component's delivery as the Releases page groups it, in the project's order: one that ships
 * with another inside the group of the component that has the deploys, following each `shipsWith`;
 * one that ships with a component the answer lacks, or with one that ships with it, stands alone.
 */
export const deliveryGroupsOf = (components: ReadonlyArray<ComponentDelivery>): ReadonlyArray<DeliveryGroup> => {
  const byKey = new Map(components.map((each) => [each.component, each] as const))
  // The component whose deploys deploy `each`, up its `shipsWith`; none in a loop of them.
  const upFrom = (each: ComponentDelivery, seen: ReadonlySet<ComponentKey>): ComponentKey | undefined => {
    const parent = each.shipsWith === undefined ? undefined : byKey.get(each.shipsWith)
    if (parent === undefined) {
      return each.component
    }
    return seen.has(parent.component) ? undefined : upFrom(parent, new Set([...seen, parent.component]))
  }
  const rootOf = (each: ComponentDelivery) => upFrom(each, new Set([each.component])) ?? each.component
  return components
    .filter((each) => rootOf(each) === each.component)
    .map((delivery) => ({
      delivery,
      shipping: components.filter(
        (each) => each.component !== delivery.component && rootOf(each) === delivery.component,
      ),
    }))
}

/**
 * What a next step does, in words, saying what goes where: "Build the latest commit for dev",
 * "Promote 1.0.0+1 from dev to prod".
 */
export const nextStepWords = (step: NextStep, environment: EnvironmentKey) => {
  switch (step._tag) {
    case "buildLatest":
      return `Build the latest commit for ${environment}`
    case "promote":
      return `Promote ${step.release} from ${step.from} to ${environment}`
  }
}

/**
 * What an environment says when nothing can go there next, beside the release there: that it has
 * the release of the environment before it, or that the one before has none to promote yet.
 * Nothing for the first, for one without a deploy target, or while a promotion to it runs.
 */
export const stageNoteOf = (stage: EnvironmentDelivery, before: EnvironmentDelivery | undefined) => {
  if (before === undefined || stage.target === undefined || stage.promotion !== undefined || stage.next !== undefined) {
    return undefined
  }
  if (before.current === undefined) {
    return `Nothing in ${before.environment} to promote yet`
  }
  return before.current.summary.release === stage.current?.summary.release
    ? `The same release as ${before.environment}`
    : undefined
}

/** When something reached an environment: the time alone on the day the answer is of, else the day too. */
export const sinceWords = (since: DateTime.Utc, asOf: DateTime.Utc) => {
  const at = DateTime.toEpochMillis(since)
  return dayOf(at) === dayOf(DateTime.toEpochMillis(asOf)) ? clockTime(at) : moment(at)
}

/**
 * One part of where a release runs now: in an environment since when; nowhere; going to one by a
 * promotion; not there yet, where the next step is it; another release there; or nothing there yet.
 */
export type WherePart =
  | { readonly _tag: "runs"; readonly environment: EnvironmentKey; readonly since: DateTime.Utc }
  | { readonly _tag: "nowhere" }
  | { readonly _tag: "going"; readonly environment: EnvironmentKey; readonly state: PromotionState }
  | { readonly _tag: "notYet"; readonly environment: EnvironmentKey }
  | { readonly _tag: "other"; readonly environment: EnvironmentKey; readonly release: ReleaseVersion }
  | { readonly _tag: "nothing"; readonly environment: EnvironmentKey }

/**
 * Where a release runs now, by its component's delivery: first each environment it runs in, or
 * that it runs nowhere; then each other environment in order: a promotion of it going there, that
 * it isn't there yet when that environment's next step is it, else the release there or that
 * nothing is there yet. "In dev since 13:57 · not in prod yet".
 */
export const whereItRunsOf = (delivery: ComponentDelivery, release: ReleaseVersion): ReadonlyArray<WherePart> => {
  const runs = delivery.environments.flatMap((stage): ReadonlyArray<WherePart> =>
    stage.current !== undefined && stage.current.summary.release === release
      ? [{ _tag: "runs", environment: stage.environment, since: stage.current.since }]
      : [],
  )
  const elsewhere = delivery.environments.flatMap((stage): ReadonlyArray<WherePart> => {
    const { environment } = stage
    const here = stage.current?.summary.release
    if (here === release) {
      return []
    }
    if (stage.promotion !== undefined && stage.promotion.release === release) {
      return [{ _tag: "going", environment, state: stage.promotion.state }]
    }
    if (stage.next?._tag === "promote" && stage.next.release === release) {
      return [{ _tag: "notYet", environment }]
    }
    return [here === undefined ? { _tag: "nothing", environment } : { _tag: "other", environment, release: here }]
  })
  return [...(runs.length === 0 ? [{ _tag: "nowhere" as const }] : runs), ...elsewhere]
}

/**
 * The environment whose next step promotes `release`, with the one it comes from: a release page's
 * one primary action. None when no environment's next step is it.
 */
export const promotionNextOf = (delivery: ComponentDelivery, release: ReleaseVersion) => {
  for (const stage of delivery.environments) {
    if (stage.target !== undefined && stage.next?._tag === "promote" && stage.next.release === release) {
      return { target: stage.target, from: stage.next.from }
    }
  }
  return undefined
}

/** What runs in an environment now, as a promotion's confirmation says what it replaces. */
export type ThereNow =
  | { readonly _tag: "release"; readonly release: ReleaseVersion; readonly since: DateTime.Utc }
  | { readonly _tag: "nothing" }

/** What runs in `environment` of a component's delivery now; absent for an environment it doesn't list. */
export const thereNowOf = (delivery: ComponentDelivery, environment: EnvironmentKey): ThereNow | undefined => {
  const stage = delivery.environments.find((each) => each.environment === environment)
  if (stage === undefined) {
    return undefined
  }
  return stage.current === undefined
    ? { _tag: "nothing" }
    : { _tag: "release", release: stage.current.summary.release, since: stage.current.since }
}

/** Whether a promotion to any environment hasn't ended, so the delivery is asked for again until each has. */
export const isDelivering = (delivery: Delivery) =>
  delivery.components.some((component) =>
    component.environments.some((stage) => stage.promotion !== undefined && !hasEnded(stage.promotion.state)),
  )

// ---- A release's life ------------------------------------------------------------------------------

const hourMs = 3_600_000
const dayMs = 24 * hourMs

/** The steps of a release's life a chart shows: all of them, or a run of them it zoomed to. */
export type LifeWindow = { readonly first: number; readonly last: number }

/** The whole life of a release whose life has `steps` steps. */
export const wholeLife = (steps: number): LifeWindow => ({ first: 0, last: Math.max(0, steps - 1) })

/**
 * A window kept within a life of `steps` steps and at least `narrowest` steps wide (or the whole
 * life, when it is shorter), whichever way it was dragged.
 */
export const windowWithin = (from: number, to: number, steps: number, narrowest = 3): LifeWindow => {
  const last = Math.max(0, steps - 1)
  const low = Math.min(Math.max(0, Math.min(from, to)), last)
  const high = Math.min(Math.max(0, Math.max(from, to)), last)
  const width = Math.min(steps, narrowest)
  if (high - low + 1 >= width) {
    return { first: low, last: high }
  }
  const first = Math.max(0, Math.min(low, steps - width))
  return { first, last: first + width - 1 }
}

/** Whether a window shows a release's whole life. */
export const isWhole = (window: LifeWindow, steps: number) => window.first === 0 && window.last >= steps - 1

/**
 * How a release's life is measured beside the one before's: by the hour under a day, else by the
 * day, so lives of different lengths compare. "an hour", "a day".
 */
export const rateUnitOf = (totals: LifeTotals) =>
  DateTime.toEpochMillis(totals.to) - DateTime.toEpochMillis(totals.from) < dayMs
    ? { words: "an hour", ms: hourMs }
    : { words: "a day", ms: dayMs }

/** How much of a count a life had in each `unitMs`, over how long it lived: at least an hour. */
export const rateOf = (value: number, totals: LifeTotals, unitMs: number) =>
  (value * unitMs) / Math.max(hourMs, DateTime.toEpochMillis(totals.to) - DateTime.toEpochMillis(totals.from))

/** How long a release lived, from its first operation or signal to its last: "3 h", "6 days". */
export const livedWords = (totals: LifeTotals) => {
  const ms = DateTime.toEpochMillis(totals.to) - DateTime.toEpochMillis(totals.from)
  if (ms < dayMs) {
    return `${Math.max(1, Math.round(ms / hourMs))} h`
  }
  const days = Math.round(ms / dayMs)
  return `${days} ${days === 1 ? "day" : "days"}`
}

/**
 * What an agent needs to dig into a release: which one, its life against the one before, and how to
 * read everything behind the page, through the CLI and the API.
 */
export const releaseBriefOf = (project: string, detail: ReleaseDetail) => {
  const { summary, life } = detail
  const where = summary.environment === undefined ? "" : ` (${summary.environment})`
  const scope = [
    `component=${encodeURIComponent(summary.component)}`,
    ...(summary.environment === undefined ? [] : [`environment=${encodeURIComponent(summary.environment)}`]),
    `release=${encodeURIComponent(summary.release)}`,
    ...(life === undefined
      ? []
      : [
          `from=${encodeURIComponent(DateTime.formatIso(life.totals.from))}`,
          `to=${encodeURIComponent(DateTime.formatIso(life.totals.to))}`,
        ]),
  ].join("&")
  const environment = summary.environment === undefined ? "" : ` --environment ${summary.environment}`
  return [
    `Find out whether release ${summary.release} of ${summary.component}${where} works, in Cluenori project ${project}.`,
    summary.previous === undefined
      ? "There is no release before it to compare with."
      : `Compare it with the release before it, ${summary.previous}: Cluenori says "${summary.verdict}".`,
    life === undefined
      ? "It hasn't run or sent anything yet."
      : `It ran from ${DateTime.formatIso(life.totals.from)} to ${DateTime.formatIso(life.totals.to)}.`,
    `Read it whole, step by step: ./cluenori release ${project} ${summary.component} ${summary.release}${environment} --life`,
    ...(life === undefined
      ? []
      : [
          `Its operations: GET /api/projects/${project}/operations?${scope}`,
          `Its errors: GET /api/projects/${project}/errors?${scope}`,
          `Its warnings and errors: GET /api/projects/${project}/logs?${scope}`,
        ]),
  ].join("\n")
}
