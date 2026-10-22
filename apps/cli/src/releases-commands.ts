import { ComponentKey, EnvironmentKey, Period, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import type { ComparedOperation, ReleaseSummary, StoreBuild } from "@cluenori/releases"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import { apiTarget } from "./api-settings.ts"
import { filters, headline, optionalKey, parsed, questionOf } from "./question.ts"
import { columns, count, milliseconds, share, utcMinute } from "./terminal-text.ts"

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
    component: Argument.String("component").pipe(Argument.withDescription("The component's key, such as notes-api.")),
    release: Argument.String("release").pipe(
      Argument.withDescription("The release, as ./cluenori releases lists it, such as 2026.10.21-e91f09c."),
    ),
    environment: filters.environment,
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
      yield* Console.log(`${summary.release} of ${summary.component}${where}, ${whenText(summary)}: ${runs}.`)
      if (summary.commit !== undefined) {
        const commit = summary.commit
        const tagged = commit.tag === undefined ? "" : `, tagged ${commit.tag}`
        const message = commit.message === undefined ? "" : `: ${commit.message}`
        yield* Console.log(`Commit ${commit.sha.slice(0, 7)}${tagged}${message}`)
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
      if (detail.newErrors.length > 0) {
        yield* Console.log(
          `\nNew errors:\n${columns([
            ["Error", "Occurrences", "ID"],
            ...detail.newErrors.map((error) => [error.title, count(error.occurrences), error.id]),
          ]).join("\n")}`,
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
).pipe(Command.withDescription("One release compared with the release before it: what got slower, and what changed."))
