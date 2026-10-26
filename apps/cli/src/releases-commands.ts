import { ComponentKey, EnvironmentKey, Period, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import { CommitSha } from "@cluenori/github"
import type { AppStoreTarget } from "@cluenori/projects"
import type {
  AppStoreSubmission,
  ComparedOperation,
  LifeTotals,
  Promotion,
  PromotionFix,
  NextStep,
  ReleaseSummary,
  Runner,
  StoreBuild,
} from "@cluenori/releases"
import { PromotionId, PromotionReason } from "@cluenori/releases"
import { Console, DateTime, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import type { ApiTarget } from "./api-settings.ts"
import { apiTarget } from "./api-settings.ts"
import { deployTargetLines } from "./deploy-targets.ts"
import { filters, headline, local, optionalKey, parsed, questionOf } from "./question.ts"
import { columns, count, milliseconds, share, utcMinute } from "./terminal-text.ts"

const componentArgument = Argument.String("component").pipe(
  Argument.withDescription("The component's key, such as notes-api."),
)
const releaseArgument = Argument.String("release").pipe(
  Argument.withDescription("The release, as ./cluenori releases lists it, such as 1.4.0+58."),
)

// What a verdict says, with what it counts.
const verdictText = (release: ReleaseSummary) => {
  switch (release.verdict) {
    case "worse": {
      const reasons = [
        ...(release.slower > 0 ? [`${release.slower} slower`] : []),
        ...(release.failingMore > 0 ? [`${release.failingMore} failing more`] : []),
        ...(release.newErrors > 0 ? [`${release.newErrors} new ${release.newErrors === 1 ? "error" : "errors"}`] : []),
      ]
      return `Worse: ${reasons.join(", ")}`
    }
    case "better":
      return "Better"
    case "same":
      return "About the same"
    case "tooEarly":
      return "Too early to tell"
    case "first":
      return "First release counted"
    case "unmeasured":
      return "No telemetry yet"
  }
}

// A count, or nothing when it isn't known.
const knownCount = (value: number | undefined) => (value === undefined ? undefined : count(value))

// The share of a life's requests that failed; unknown without requests.
const failedShare = (each: LifeTotals) =>
  each.requests === undefined || each.failed === undefined ? undefined : share(each.failed, each.requests)

// How long a life was, in hours: at least one.
const ranFor = (each: LifeTotals) =>
  `${count(Math.max(1, Math.round((DateTime.toEpochMillis(each.to) - DateTime.toEpochMillis(each.from)) / 3_600_000)))} hours`

// A release's life in a few lines, each number beside the release before's: "Requests 12,400 (before 11,900)".
const lifeLines = (totals: LifeTotals, previous: string | undefined, before: LifeTotals | undefined) => {
  const beside = (of: (each: LifeTotals) => string | undefined) => {
    const was = before === undefined ? undefined : of(before)
    return was === undefined ? "" : ` (${previous ?? "before"}: ${was})`
  }
  const known = knownCount
  const failed = failedShare
  return [
    `Its life: ${utcMinute(totals.from)} to ${utcMinute(totals.to)}, ${ranFor(totals)}${beside(ranFor)}.`,
    ...(totals.people === undefined
      ? []
      : [`  People   ${count(totals.people)}${beside((each) => known(each.people))}`]),
    ...(totals.requests === undefined
      ? []
      : [
          `  Requests ${count(totals.requests)}${beside((each) => known(each.requests))}`,
          `  Failed   ${failed(totals) ?? ""}${beside(failed)}`,
        ]),
    ...(totals.warnings === undefined || totals.errors === undefined
      ? []
      : [
          `  Warnings ${count(totals.warnings)}${beside((each) => known(each.warnings))}`,
          `  Errors   ${count(totals.errors)}${beside((each) => known(each.errors))}`,
          ...(totals.logsFrom === undefined
            ? []
            : [`  Warnings and errors from ${utcMinute(totals.logsFrom)}: older ones aren't kept.`]),
        ]),
  ]
}

// Where an app's build stands, in words.
const stageText = (store: StoreBuild) => {
  switch (store.stage) {
    case "processing":
      return "Processing"
    case "failed":
      return "Failed processing"
    case "testing":
      return "In TestFlight"
    case "waitingForReview":
      return "Waiting for review"
    case "inReview":
      return "In review"
    case "rejected":
      return "Rejected"
    case "pendingRelease":
      return "Pending release"
    case "releasing":
      return store.phasedRelease?.day === undefined
        ? "Phased release"
        : `Phased release, day ${store.phasedRelease.day} of 7`
    case "live":
      return "On the App Store"
    case "replaced":
      return "Replaced"
    case "expired":
      return "Expired"
    case "other":
      return store.appStoreState ?? "Unknown"
  }
}

// Where a promotion stands, in words; once approved, how to release it.
const promotionText = (project: ProjectKey, promotion: Promotion) => {
  switch (promotion.state) {
    case "starting":
      return "Starting"
    case "queued":
      return "Queued"
    case "waiting":
      return "Waiting for approval on GitHub"
    case "running":
      return "Running"
    case "processing":
      return "Processing in App Store Connect"
    case "inReview":
      return "In App Store review"
    case "approved":
      return `Approved: ./cluenori release-approved ${project} ${promotion.id}`
    case "releasing":
      return "Releasing on the App Store"
    case "succeeded":
      return "Succeeded"
    case "failed":
      return "Failed"
    case "cancelled":
      return "Cancelled"
    case "rejected":
      return "Rejected in review"
    case "lost":
      return promotion.appStore === undefined
        ? "Not followed: see GitHub"
        : "Not followed: see GitHub and App Store Connect"
  }
}

// What to do about a refused promotion, by where it is fixed, for the release it was of; `where`
// has placeholders when the release isn't known.
const fixText = (
  fix: PromotionFix,
  where: {
    readonly target: ApiTarget
    readonly project: ProjectKey
    readonly component: string
    readonly release: string
    readonly environment: string
  },
) => {
  switch (fix) {
    case "github":
      return `Fix it on the web's GitHub page: ${where.target.url}/github`
    case "links":
      return `Link its repository and deploy targets, all of them, as an option left out unlinks: ./cluenori component link ${where.project} ${where.component} --repository <owner/name> --deploy ${where.environment}=<workflow.yml> …`
    case "repository":
      return "Fix the workflow in the repository: on its default branch, started on workflow_dispatch with the inputs release, environment, commit and runner."
    case "notes":
      return `Write its notes for each of the app's languages: ./cluenori notes ${where.project} ${where.component} ${where.release} --draft ${where.environment}`
    case "appStore":
      return "Give the deployment an App Manager key: ./cluenori appstore setup <key.p8> --issuer <issuer ID> --manager"
    case "version":
      return `Set its version, which its builds are numbered in: ./cluenori version ${where.project} ${where.component} 1.0.0`
  }
}

// When it ran, was deployed, or was uploaded, as one line.
const whenText = (release: ReleaseSummary) => {
  if (release.firstSeen !== undefined && release.lastSeen !== undefined) {
    return `${utcMinute(release.firstSeen)} to ${utcMinute(release.lastSeen)}`
  }
  if (release.deployedAt !== undefined) {
    return `deployed ${utcMinute(release.deployedAt)}`
  }
  return release.store === undefined ? "" : `uploaded ${utcMinute(release.store.uploadedAt)}`
}

// Its commit as people know it: its tag, else its short SHA.
const commitText = (release: ReleaseSummary) =>
  release.commit === undefined ? "" : (release.commit.tag ?? release.commit.sha.slice(0, 7))

const runsText = (release: ReleaseSummary) =>
  release.count === undefined || release.errors === undefined
    ? ["", ""]
    : [count(release.count), share(release.errors, release.count)]

/** `cluenori releases <project>`. */
export const releases = Command.make(
  "releases",
  {
    ...filters,
    last: Flag.Literals("last", ["1h", "6h", "24h", "7d", "14d", "30d", "90d"]).pipe(
      Flag.withDefault("30d"),
      Flag.withDescription("How far back to look for releases that ran, were deployed, or were uploaded."),
    ),
  },
  (input) =>
    Effect.gen(function* () {
      const { project, query, target } = yield* questionOf(input)
      const client = yield* apiClient(target)
      const list = yield* client.releases.releases({ params: { project }, query }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
        }),
      )
      yield* Console.log(`${headline(project, target, new Period({ from: query.from, to: query.to }), "")}\n`)
      for (const problem of list.problems) {
        yield* Console.log(`${problem.component}: ${problem.problem}`)
      }
      if (list.releases.length === 0) {
        return yield* Console.log(
          "No releases in this period. A component's releases show once it reports its version in service.version, its CI runs cluenori-release, or its app is linked to App Store Connect.",
        )
      }
      yield* Console.log(
        columns([
          ["Release", "Component", "Environment", "When", "Commit", "Store", "Runs", "Errors", "Verdict"],
          ...list.releases.map((release) => [
            release.release,
            release.component,
            release.environment ?? "",
            whenText(release),
            commitText(release),
            release.store === undefined ? "" : stageText(release.store),
            ...runsText(release),
            verdictText(release),
          ]),
        ]).join("\n"),
      )
      yield* Console.log(
        `\nCompare one with the release before it: ./cluenori release ${project} <component> <release>`,
      )
    }),
).pipe(
  Command.withDescription(
    "Each component's releases, from its telemetry, its deploys, and App Store Connect, each compared with the release before it.",
  ),
)

// What can go to an environment next, in words, with the command that does it.
const nextText = (project: ProjectKey, component: ComponentKey, environment: EnvironmentKey, next: NextStep) =>
  next._tag === "promote"
    ? {
        words: `promote ${next.release} from ${next.from}`,
        command: `./cluenori promote ${project} ${component} ${next.release} --to ${environment}`,
      }
    : {
        words: "build the latest commit",
        command: `./cluenori promote ${project} ${component} latest --to ${environment}`,
      }

// A promotion under way to an environment, else what can go there next.
const stageNote = (promotion: Promotion | undefined, next: string | undefined) => {
  if (promotion !== undefined) {
    return `promoting ${promotion.release}: ${promotion.state}`
  }
  return next === undefined ? "" : `next: ${next}`
}

/** `cluenori delivery <project>`. */
export const delivery = Command.make(
  "delivery",
  {
    project: Argument.String("project").pipe(Argument.withDescription("The project's key.")),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const shown = yield* client.releases.delivery({ params: { project } }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
        }),
      )
      if (shown.components.length === 0) {
        return yield* Console.log(
          `${project} has no components yet. Add one: ./cluenori component add ${project} <key> --name <name>`,
        )
      }
      const commands: Array<string> = []
      // A component that ships with another is shown under it.
      const shipping = shown.components.filter((each) => each.shipsWith === undefined)
      for (const each of shipping) {
        const version =
          each.version === undefined
            ? "no version set"
            : `version ${each.version.version}, next ${each.version.version}+${each.version.lastBuild + 1}`
        yield* Console.log(`${each.component}  ${version}`)
        if (each.environments.length === 0) {
          yield* Console.log("  No environments yet: link its deploy targets with ./cluenori component link.")
        }
        yield* Console.log(
          columns(
            each.environments.map((stage) => {
              const current = stage.current
              const next =
                stage.next === undefined ? undefined : nextText(project, each.component, stage.environment, stage.next)
              if (next !== undefined) {
                commands.push(next.command)
              }
              return [
                `  ${stage.environment}`,
                current?.summary.release ?? "nothing yet",
                current === undefined ? "" : `since ${utcMinute(current.since)}`,
                current === undefined ? "" : verdictText(current.summary),
                stageNote(stage.promotion, next?.words),
              ]
            }),
          ).join("\n"),
        )
        for (const part of shown.components.filter((other) => other.shipsWith === each.component)) {
          const runs = part.environments
            .flatMap((stage) =>
              stage.current === undefined ? [] : [`${stage.environment} ${stage.current.summary.release}`],
            )
            .join(", ")
          yield* Console.log(`  ships with it: ${part.component}${runs === "" ? "" : ` (${runs})`}`)
        }
        yield* Console.log("")
      }
      if (commands.length > 0) {
        yield* Console.log(`Next steps:\n${commands.map((command) => `  ${command}`).join("\n")}`)
      }
    }),
).pipe(
  Command.withDescription(
    "How each component's releases reach its environments: the release in each now, a promotion under way, and the next step, such as promoting dev's newer release to prod.",
  ),
)

// Operations compared, as lines: now and in the release before, p95 and error rate.
const comparedLines = (rows: ReadonlyArray<ComparedOperation>) =>
  columns([
    ["Operation", "p95", "Was", "Errors", "Was", "Runs", "Was"],
    ...rows.map((row) => [
      row.operation,
      milliseconds(row.p95Ms),
      milliseconds(row.previousP95Ms),
      share(row.errors, row.count),
      share(row.previousErrors, row.previousCount),
      count(row.count),
      count(row.previousCount),
    ]),
  ])

/** `cluenori release <project> <component> <release>`. */
export const release = Command.make(
  "release",
  {
    project: filters.project,
    component: componentArgument,
    release: releaseArgument,
    environment: filters.environment,
    life: Flag.Boolean("life").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Also list its life step by step, by 5 minutes under 6 hours, by the hour under 3 days, else by UTC day: requests, failed, p95, warnings, errors and people.",
      ),
    ),
    local: filters.local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const target = yield* apiTarget(input.local)
      const component = yield* parsed(ComponentKey, input.component, "a component key")
      const version = yield* parsed(ReleaseVersion, input.release, "a release")
      const environment = yield* optionalKey(EnvironmentKey, input.environment, "an environment key")
      const client = yield* apiClient(target)
      const detail = yield* client.releases
        .release({
          params: { project, component, release: version },
          query: Option.match(environment, { onNone: () => ({}), onSome: (key) => ({ environment: key }) }),
        })
        .pipe(
          Effect.catchTags({
            ...reachFailures(target),
            ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
            ReleaseNotFound: () =>
              refuse(
                `${project} has no release ${version} of ${component}${Option.match(environment, { onNone: () => "", onSome: (key) => ` in ${key}` })}. ./cluenori releases ${project} lists those it has.`,
              ),
          }),
        )
      const summary = detail.summary
      const where = summary.environment === undefined ? "" : ` in ${summary.environment}`
      const runs =
        summary.count === undefined || summary.errors === undefined
          ? "no telemetry yet"
          : `${count(summary.count)} runs, ${share(summary.errors, summary.count)} failed`
      const when = whenText(summary)
      yield* Console.log(
        `${summary.release} of ${summary.component}${where}${when === "" ? "" : `, ${when}`}: ${runs}.`,
      )
      if (summary.commit !== undefined) {
        const commit = summary.commit
        const tagged = commit.tag === undefined ? "" : `, tagged ${commit.tag}`
        const message = commit.message === undefined ? "" : `: ${commit.message}`
        yield* Console.log(`Commit ${commit.sha.slice(0, 7)}${tagged}${message}`)
      }
      if (detail.gitHubRelease !== undefined) {
        yield* Console.log(`On GitHub: ${detail.gitHubRelease.url}`)
      }
      if (summary.store !== undefined) {
        yield* Console.log(
          `App Store Connect: build ${summary.store.version} (${summary.store.buildNumber}), ${stageText(summary.store)}.`,
        )
      }
      if (summary.verdict === "unmeasured") {
        yield* Console.log(
          "No telemetry from it yet, so nothing to compare: it shows once it reports this version in service.version.",
        )
      } else if (summary.previous === undefined) {
        yield* Console.log(`${verdictText(summary)}: there is no release before it to compare with.`)
      } else {
        yield* Console.log(`Compared with ${summary.previous}. ${verdictText(summary)}.`)
      }
      const sections: ReadonlyArray<readonly [string, ReadonlyArray<ComparedOperation>]> = [
        ["Slower", detail.slower],
        ["Fails more", detail.failingMore],
        ["Faster", detail.faster],
        ["Fails less", detail.failingLess],
      ]
      for (const [title, rows] of sections.slice(0, 2)) {
        if (rows.length > 0) {
          yield* Console.log(`\n${title}:\n${comparedLines(rows).join("\n")}`)
        }
      }
      const life = detail.life
      if (life !== undefined) {
        yield* Console.log(`\n${lifeLines(life.totals, summary.previous, life.previous).join("\n")}`)
        if (input.life) {
          const known = (value: number | undefined) => knownCount(value) ?? "unknown"
          yield* Console.log(
            `\n${columns([
              [life.step === "1d" ? "Day" : "Start", "Requests", "Failed", "p95", "Warnings", "Errors", "People"],
              ...life.points.map((point) => [
                life.step === "1d" ? DateTime.formatIso(point.start).slice(0, 10) : utcMinute(point.start),
                known(point.requests),
                known(point.failed),
                point.p95Ms === undefined ? "" : milliseconds(point.p95Ms),
                known(point.warnings),
                known(point.errors),
                point.people === undefined ? "" : count(point.people),
              ]),
            ]).join("\n")}`,
          )
        }
      }
      if (detail.errors.length > 0) {
        yield* Console.log(
          `\nErrors it logged, the most frequent first:\n${columns([
            ["Error", "Occurrences", "New", "ID"],
            ...detail.errors.map((error) => [
              error.title,
              count(error.occurrences),
              error.firstRelease === version ? "new" : "",
              error.id,
            ]),
          ]).join("\n")}\nOne of them: ./cluenori error ${project} <ID>`,
        )
      }
      if (detail.incidents.length > 0) {
        yield* Console.log(
          `\nIncidents while it ran:\n${columns([
            ["Opened", "Incident"],
            ...detail.incidents.map((incident) => [utcMinute(incident.openedAt), incident.title]),
          ]).join("\n")}`,
        )
      }
      for (const [title, rows] of sections.slice(2)) {
        if (rows.length > 0) {
          yield* Console.log(`\n${title}:\n${comparedLines(rows).join("\n")}`)
        }
      }
      if (detail.newOperations.length > 0) {
        yield* Console.log(`\nNew operations:\n${detail.newOperations.join("\n")}`)
      }
      if (detail.notes.length > 0) {
        const width = Math.max(...detail.notes.map((note) => note.locale.length))
        const firstLines = detail.notes.map(
          (note) => `  ${note.locale.padEnd(width)}  ${note.text.split("\n")[0] ?? ""}`,
        )
        yield* Console.log(
          `\nNotes, each language's first line:\n${firstLines.join("\n")}\nRead them whole: ./cluenori notes ${project} ${component} ${version}`,
        )
      } else if (detail.deployTargets.some((each) => each.appStore !== undefined)) {
        yield* Console.log(
          `\nNo notes yet, which TestFlight and the App Store show: ./cluenori notes ${project} ${component} ${version} --draft <environment>`,
        )
      }
      if (detail.promotions.length > 0) {
        yield* Console.log(
          `\nPromotions:\n${columns([
            ["Started", "To", "State", "Reason", "Run"],
            ...detail.promotions.map((promotion) => [
              utcMinute(promotion.startedAt),
              promotion.environment,
              // The command that releases an approved one is too long for a column: it follows.
              promotion.state === "approved" ? "Approved" : promotionText(project, promotion),
              promotion.reason ?? "",
              promotion.run?.url ?? "",
            ]),
          ]).join("\n")}`,
        )
        for (const approved of detail.promotions.filter((promotion) => promotion.state === "approved")) {
          yield* Console.log(
            `Approved for ${approved.environment}, it waits for you to release it: ./cluenori release-approved ${project} ${approved.id}`,
          )
        }
      }
      if (detail.deployTargets.length > 0) {
        const lines = deployTargetLines(detail.deployTargets).map((line) => `  ${line}`)
        yield* Console.log(
          `\nDeploy targets${detail.repository === undefined ? "" : `, in ${detail.repository}`}:\n${lines.join("\n")}\n`,
        )
        for (const each of detail.deployTargets) {
          yield* Console.log(
            `Promote it to ${each.environment}: ./cluenori promote ${project} ${component} ${version} --to ${each.environment}`,
          )
        }
      }
      const changes = detail.changes
      if (changes !== undefined) {
        const files =
          changes.filesChanged === undefined
            ? ""
            : `, ${count(changes.filesChanged)} files (+${count(changes.additions ?? 0)} -${count(changes.deletions ?? 0)})`
        yield* Console.log(
          `\nChanged since ${summary.previous ?? "the release before"}: ${count(changes.totalCommits)} commits${files}.`,
        )
        for (const pull of changes.pullRequests) {
          yield* Console.log(`  #${pull.number} ${pull.title} (${pull.author})`)
        }
        if (changes.pullRequests.length === 0) {
          for (const commit of changes.commits.slice(0, 20)) {
            yield* Console.log(`  ${commit.sha.slice(0, 7)} ${commit.message} (${commit.author})`)
          }
        }
        if (changes.url !== undefined) {
          yield* Console.log(`  ${changes.url}`)
        }
      }
    }),
).pipe(
  Command.withDescription(
    "One release, its whole life compared with the release before it: its people, requests, failures, warnings and errors, what got slower, the errors it logged, and what changed; its notes, its promotions, and where it can be promoted.",
  ),
)

// Where a promotion's workflow runs, in words.
const runnerText = (runner: Runner) => {
  switch (runner) {
    case "auto":
      return " on the local runner if it is online, else the cloud one"
    case "local":
      return " on the local runner"
    case "cloud":
      return " on the cloud runner"
  }
}

// Where an app's build goes once its workflow ends, and how, in a sentence or two.
const storeText = (project: ProjectKey, promotion: Promotion, app: AppStoreTarget) => {
  const processed = `Cluenori waits for App Store Connect to process its build in ${app.bundleId}`
  switch (app.distribution) {
    case "testFlight":
      return `${processed}, then sets What to Test from its notes.`
    case "appStore": {
      const submission = promotion.submission ?? { releaseType: "afterApproval", phased: true }
      const reach = submission.phased ? "phased over 7 days" : "to everyone at once"
      const released =
        submission.releaseType === "manual"
          ? `it waits for you to release it, ${reach}: ./cluenori release-approved ${project} ${promotion.id}`
          : `it is released, ${reach}.`
      return `${processed}, then submits it for App Store review with its notes as What's New. Once approved, ${released}`
    }
  }
}

/**
 * `cluenori promote <project> <component> <release> --to <environment> [--reason <text>]
 * [--runner auto|local|cloud] [--release-manually] [--all-at-once]`.
 */
export const promote = Command.make(
  "promote",
  {
    project: filters.project,
    component: componentArgument,
    release: Argument.String("release").pipe(
      Argument.withDescription(
        "The release, as ./cluenori releases lists it, such as 1.4.0+58; or latest, for the newest commit on the repository's default branch (or --commit), numbered as the next release first.",
      ),
    ),
    commit: Flag.String("commit").pipe(
      Flag.optional,
      Flag.withDescription("With latest: the commit to number and promote, a full SHA, in place of the newest."),
    ),
    to: Flag.String("to").pipe(Flag.withDescription("The environment to deploy it to, such as production.")),
    reason: Flag.String("reason").pipe(
      Flag.optional,
      Flag.withDescription("Why, in a few words, kept with the promotion: up to 500 characters."),
    ),
    runner: Flag.Literals("runner", ["auto", "local", "cloud"]).pipe(
      Flag.optional,
      Flag.withDescription(
        "Where its workflow runs: local, your own machine's self-hosted runner; cloud, the repository's hosted one; or auto, the default, local while it is online.",
      ),
    ),
    releaseManually: Flag.Boolean("release-manually").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "For the App Store: once review approves it, wait until you release it with ./cluenori release-approved, in place of releasing it at once.",
      ),
    ),
    allAtOnce: Flag.Boolean("all-at-once").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "For the App Store: release it to everyone at once, in place of a phased release over 7 days.",
      ),
    ),
    local: filters.local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const target = yield* apiTarget(input.local)
      const component = yield* parsed(ComponentKey, input.component, "a component key")
      const latest = input.release === "latest"
      const asked = latest ? Option.none() : Option.some(yield* parsed(ReleaseVersion, input.release, "a release"))
      const commit = yield* optionalKey(CommitSha, input.commit, "a commit's full SHA")
      if (!latest && Option.isSome(commit)) {
        return yield* refuse("--commit goes with latest: a release's commit is its own.")
      }
      const environment = yield* parsed(EnvironmentKey, input.to, "an environment key")
      const reason = yield* optionalKey(PromotionReason, input.reason, "a reason of 1 to 500 characters")
      // Sent only when asked, so the API's default holds otherwise; a target without an App Store
      // app has no use for it.
      const submissionAsked = input.releaseManually || input.allAtOnce
      const submission: AppStoreSubmission = {
        releaseType: input.releaseManually ? "manual" : "afterApproval",
        phased: !input.allAtOnce,
      }
      const client = yield* apiClient(target)
      const payload = {
        environment,
        ...Option.match(reason, { onNone: () => ({}), onSome: (text) => ({ reason: text }) }),
        ...Option.match(input.runner, { onNone: () => ({}), onSome: (runner) => ({ runner }) }),
        ...(submissionAsked ? { submission } : {}),
      }
      const named = input.release
      const promotion = yield* Option.match(asked, {
        onNone: () =>
          client.releases.promoteLatest({
            params: { project, component },
            payload: {
              ...payload,
              ...Option.match(commit, { onNone: () => ({}), onSome: (sha) => ({ commit: sha }) }),
            },
          }),
        onSome: (version) => client.releases.promote({ params: { project, component, release: version }, payload }),
      }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
          ReleaseNotFound: () =>
            refuse(
              `${project} has no release ${named} of ${component}. ./cluenori releases ${project} lists those it has.`,
            ),
          PromotionInProgress: ({ promotion: running }) =>
            refuse(
              `${component} is being promoted to ${environment} already: ${running.release}, started ${utcMinute(running.startedAt)}${running.run === undefined ? "" : `, ${running.run.url}`}. ${promotionText(project, running)}.\nPromote again once it ends.`,
            ),
          PromotionRefused: (refused) =>
            refuse(
              `Nothing started: ${refused.reason}\n${fixText(refused.fix, { target, project, component, release: named, environment })}`,
            ),
          PromotionUnavailable: (unavailable) =>
            refuse(`GitHub didn't answer, so nothing started: ${unavailable.reason}. Try again.`),
        }),
      )
      const version = promotion.release
      if (latest) {
        yield* Console.log(`Numbered ${version} of ${component}.`)
      }
      const runner = promotion.runner === undefined ? "" : runnerText(promotion.runner)
      yield* Console.log(
        promotion.workflow === undefined || promotion.repository === undefined
          ? `Promoting ${version} of ${component} to ${environment}: ${promotionText(project, promotion)}.`
          : `Started ${promotion.workflow} in ${promotion.repository}${runner}, to deploy ${version} of ${component} to ${environment}.`,
      )
      if (promotion.run !== undefined) {
        yield* Console.log(`Its run: ${promotion.run.url}`)
      } else if (promotion.workflow !== undefined) {
        yield* Console.log("Its run shows in the repository's Actions on GitHub.")
      }
      if (promotion.appStore !== undefined) {
        yield* Console.log(
          `${promotion.workflow === undefined ? "" : "Once it ends, "}${storeText(project, promotion, promotion.appStore)}`,
        )
      }
      yield* Console.log(`Cluenori follows it each minute: ./cluenori release ${project} ${component} ${version}`)
    }),
).pipe(
  Command.withDescription(
    "Promote a release to an environment by its component's deploy target there: start its workflow on GitHub, and for an app, follow its build into TestFlight, or through App Store review with its notes as What's New. Promoting an older release rolls back; promoting latest numbers the newest commit as the next release first, such as an app's next build.",
  ),
)

/** `cluenori release-approved <project> <promotion>`. */
export const releaseApproved = Command.make(
  "release-approved",
  {
    project: filters.project,
    promotion: Argument.String("promotion").pipe(
      Argument.withDescription("The promotion's ID, as ./cluenori release shows it once approved."),
    ),
    local: filters.local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const id = yield* parsed(PromotionId, input.promotion, "a promotion's ID")
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const promotion = yield* client.releases.releaseApproved({ params: { project, promotion: id } }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
          PromotionNotFound: () =>
            refuse(
              `${project} has no promotion ${id} approved and waiting to be released. A release's promotions: ./cluenori release ${project} <component> <release>`,
            ),
          PromotionRefused: (refused) =>
            refuse(
              `Nothing was released: ${refused.reason}\n${fixText(refused.fix, { target, project, component: "<component>", release: "<release>", environment: "<environment>" })}`,
            ),
          PromotionUnavailable: (unavailable) =>
            refuse(`App Store Connect didn't answer, so nothing was released: ${unavailable.reason}. Try again.`),
        }),
      )
      yield* Console.log(
        `${promotionText(project, promotion)}: ${promotion.release} of ${promotion.component}${promotion.appStore === undefined ? "" : `, as ${promotion.appStore.bundleId}`}. It goes live shortly.`,
      )
      yield* Console.log(
        `Cluenori follows it until it is: ./cluenori release ${project} ${promotion.component} ${promotion.release}`,
      )
    }),
).pipe(
  Command.withDescription(
    "Release an app that App Store review approved, promoted with --release-manually: App Store Connect makes it live, and its promotion ends once it is.",
  ),
)
