import { EnvelopeName } from "@cluenori/foundation"
import type { KeptRequestRow, RequestSeries } from "@cluenori/signals"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import type { ApiTarget } from "./api-settings.ts"
import { defaultSteps, filters, headline, parsed, questionOf } from "./question.ts"
import { columns, count, milliseconds, share, utcMinute, utcSecond } from "./terminal-text.ts"

const nothingYet = (project: string, target: ApiTarget) =>
  `No requests from ${project} in this period. Components send them to ${target.url}/otlp/v1/traces with their ingest key; ./cluenori component add makes one.`

/** `cluenori endpoints <project>`. */
export const endpoints = Command.make("endpoints", filters, (input) =>
  Effect.gen(function* () {
    const { project, query, target } = yield* questionOf(input)
    const client = yield* apiClient(target)
    const table = yield* client.signals.endpoints({ params: { project }, query }).pipe(
      Effect.catchTags({
        ...reachFailures(target),
        ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
      }),
    )
    yield* Console.log(`${headline(project, target, table.covered, "counts are kept 15 months")}\n`)
    if (table.rows.length === 0) {
      return yield* Console.log(nothingYet(project, target))
    }
    const components = new Set(table.rows.map((row) => row.component))
    const lines = columns([
      [
        "Endpoint",
        ...(components.size > 1 ? ["Component"] : []),
        "Environment",
        "Requests",
        "Errors",
        "Avg",
        "p50",
        "p80",
        "p95",
        "p99",
      ],
      ...table.rows.map((row) => [
        row.endpoint,
        ...(components.size > 1 ? [row.component] : []),
        row.environment ?? "unknown",
        count(row.requests),
        share(row.errors, row.requests),
        milliseconds(row.averageMs),
        milliseconds(row.p50Ms),
        milliseconds(row.p80Ms),
        milliseconds(row.p95Ms),
        milliseconds(row.p99Ms),
      ]),
    ])
    yield* Console.log(lines.join("\n"))
    const until = table.dataUntil === undefined ? "" : `, data until ${utcMinute(table.dataUntil)}`
    yield* Console.log(`\n${count(table.requests)} requests, ${share(table.errors, table.requests)} failed${until}.`)
    yield* Console.log("Percentiles are within 2% of the true value.")
  }),
).pipe(Command.withDescription("Every endpoint's requests: how many, how many failed, and how long they took."))

// A request's status as people read it: its HTTP status, or, without one, whether it failed.
const statusOf = (row: KeptRequestRow) => {
  if (row.status !== undefined) {
    return `${row.status}`
  }
  return row.failed ? "failed" : ""
}

// Kept requests as lines: when each started, how long it took, its status, and its trace.
const keptLines = (rows: ReadonlyArray<KeptRequestRow>) =>
  columns([
    ["Start", "Took", "Status", "Environment", "Trace"],
    ...rows.map((row) => [
      utcSecond(row.start),
      milliseconds(row.durationMs),
      statusOf(row),
      row.environment ?? "unknown",
      row.trace,
    ]),
  ])

/** `cluenori endpoint <project> <endpoint>`. */
export const endpoint = Command.make(
  "endpoint",
  {
    ...filters,
    endpoint: Argument.String("endpoint").pipe(
      Argument.withDescription('The endpoint\'s name, from ./cluenori endpoints, quoted: "GET /api/notes/{id}".'),
    ),
  },
  (input) =>
    Effect.gen(function* () {
      const { project, query, target } = yield* questionOf(input)
      const name = yield* parsed(EnvelopeName, input.endpoint, "an endpoint's name")
      const client = yield* apiClient(target)
      const failures = {
        ...reachFailures(target),
        ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
      }
      const asked = { params: { project }, query: { ...query, endpoint: name } }
      const table = yield* client.signals.endpoints(asked).pipe(Effect.catchTags(failures))
      const kept = yield* client.signals.keptRequests(asked).pipe(Effect.catchTags(failures))
      yield* Console.log(`${headline(project, target, table.covered, "counts are kept 15 months")}\n`)
      if (table.rows.length === 0) {
        return yield* Console.log(
          `No requests to ${name} in this period. Its name must match exactly, as ./cluenori endpoints ${project} lists it.`,
        )
      }
      for (const row of table.rows) {
        yield* Console.log(`${row.endpoint}  ${row.component}  ${row.environment ?? "unknown environment"}`)
        yield* Console.log(
          `  ${count(row.requests)} requests, ${share(row.errors, row.requests)} failed; avg ${milliseconds(row.averageMs)}, p50 ${milliseconds(row.p50Ms)}, p95 ${milliseconds(row.p95Ms)}, p99 ${milliseconds(row.p99Ms)}`,
        )
      }
      const since = kept.covered === undefined ? "" : ` since ${utcMinute(kept.covered.from)}`
      yield* Console.log(`\nSlowest requests${since}, slowest first: of each hour, the five slowest are kept 14 days.`)
      yield* Console.log(kept.slowest.length === 0 ? "None is kept." : keptLines(kept.slowest).join("\n"))
      yield* Console.log(`\nFailed requests${since}, newest first:`)
      yield* Console.log(kept.failed.length === 0 ? "None failed." : keptLines(kept.failed).join("\n"))
      const [first] = [...kept.failed, ...kept.slowest]
      if (first !== undefined) {
        yield* Console.log(`\nOpen one, with its spans and logs: ./cluenori trace ${project} ${first.trace}`)
      }
    }),
).pipe(Command.withDescription("One endpoint: its requests, and its slowest and failed ones, each with its trace."))

const seriesLines = (series: RequestSeries) =>
  columns([
    ["Start", "Requests", "Errors"],
    ...series.points.map((point) => [
      utcMinute(point.start),
      count(point.requests),
      share(point.errors, point.requests),
    ]),
  ])

/** `cluenori requests <project>`. */
export const requests = Command.make(
  "requests",
  {
    ...filters,
    step: Flag.Literals("step", ["1m", "5m", "1h", "1d"]).pipe(
      Flag.optional,
      Flag.withDescription("How wide each line is. By default it follows --last; past two days, at least an hour."),
    ),
  },
  (input) =>
    Effect.gen(function* () {
      const { project, query, target } = yield* questionOf(input)
      const step = Option.getOrElse(input.step, () => defaultSteps[input.last])
      const client = yield* apiClient(target)
      const series = yield* client.signals.requests({ params: { project }, query: { ...query, step } }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
        }),
      )
      yield* Console.log(`${headline(project, target, series.covered, "counts are kept 15 months")}\n`)
      if (series.points.length === 0) {
        return yield* Console.log(nothingYet(project, target))
      }
      if (series.step !== step) {
        yield* Console.log(`Past two days requests are counted by the hour, so each line is ${series.step}.\n`)
      }
      yield* Console.log(seriesLines(series).join("\n"))
      yield* Console.log("\nA step that isn't listed had no requests reported.")
    }),
).pipe(Command.withDescription("Requests and errors over time: the load on a project's services."))
