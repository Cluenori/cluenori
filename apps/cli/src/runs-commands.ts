import { EnvelopeName } from "@cluenori/foundation"
import type { KeptRunRow, RunSeries } from "@cluenori/signals"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import type { ApiTarget } from "./api-settings.ts"
import { defaultSteps, filters, headline, parsed, questionOf } from "./question.ts"
import { columns, count, milliseconds, share, utcMinute, utcSecond } from "./terminal-text.ts"

const nothingYet = (project: string, target: ApiTarget) =>
  `No runs from ${project} in this period. Components send them to ${target.url}/otlp/v1/traces with their ingest key; ./cluenori component add makes one.`

/** `cluenori operations <project>`. */
export const operations = Command.make("operations", filters, (input) =>
  Effect.gen(function* () {
    const { project, query, target } = yield* questionOf(input)
    const client = yield* apiClient(target)
    const table = yield* client.signals.operations({ params: { project }, query }).pipe(
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
        "Operation",
        ...(components.size > 1 ? ["Component"] : []),
        "Environment",
        "Runs",
        "Errors",
        "Avg",
        "p50",
        "p80",
        "p95",
        "p99",
      ],
      ...table.rows.map((row) => [
        row.operation,
        ...(components.size > 1 ? [row.component] : []),
        row.environment ?? "unknown",
        count(row.runs),
        share(row.errors, row.runs),
        milliseconds(row.averageMs),
        milliseconds(row.p50Ms),
        milliseconds(row.p80Ms),
        milliseconds(row.p95Ms),
        milliseconds(row.p99Ms),
      ]),
    ])
    yield* Console.log(lines.join("\n"))
    const until = table.dataUntil === undefined ? "" : `, data until ${utcMinute(table.dataUntil)}`
    yield* Console.log(
      `\n${count(table.runs)} ${table.runs === 1 ? "run" : "runs"}, ${share(table.errors, table.runs)} failed${until}.`,
    )
    yield* Console.log("Percentiles are within 2% of the true value.")
  }),
).pipe(Command.withDescription("Every operation's runs: how many, how many failed, and how long they took."))

// A run's status as people read it: its HTTP status, or, without one, whether it failed.
const statusOf = (row: KeptRunRow) => {
  if (row.status !== undefined) {
    return `${row.status}`
  }
  return row.failed ? "failed" : ""
}

// Kept runs as lines: when each started, how long it took, its status, and its trace.
const keptLines = (rows: ReadonlyArray<KeptRunRow>) =>
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

/** `cluenori operation <project> <operation>`. */
export const operation = Command.make(
  "operation",
  {
    ...filters,
    operation: Argument.String("operation").pipe(
      Argument.withDescription('The operation\'s name, from ./cluenori operations, quoted: "GET /api/notes/{id}".'),
    ),
  },
  (input) =>
    Effect.gen(function* () {
      const { project, query, target } = yield* questionOf(input)
      const name = yield* parsed(EnvelopeName, input.operation, "an operation's name")
      const client = yield* apiClient(target)
      const failures = {
        ...reachFailures(target),
        ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
      }
      const asked = { params: { project }, query: { ...query, operation: name } }
      const table = yield* client.signals.operations(asked).pipe(Effect.catchTags(failures))
      const kept = yield* client.signals.keptRuns(asked).pipe(Effect.catchTags(failures))
      yield* Console.log(`${headline(project, target, table.covered, "counts are kept 15 months")}\n`)
      if (table.rows.length === 0) {
        return yield* Console.log(
          `No runs of ${name} in this period. Its name must match exactly, as ./cluenori operations ${project} lists it.`,
        )
      }
      for (const row of table.rows) {
        yield* Console.log(`${row.operation}  ${row.component}  ${row.environment ?? "unknown environment"}`)
        yield* Console.log(
          `  ${count(row.runs)} ${row.runs === 1 ? "run" : "runs"}, ${share(row.errors, row.runs)} failed; avg ${milliseconds(row.averageMs)}, p50 ${milliseconds(row.p50Ms)}, p95 ${milliseconds(row.p95Ms)}, p99 ${milliseconds(row.p99Ms)}`,
        )
      }
      const since = kept.covered === undefined ? "" : ` since ${utcMinute(kept.covered.from)}`
      yield* Console.log(`\nSlowest runs${since}, slowest first: of each hour, the five slowest are kept 14 days.`)
      yield* Console.log(kept.slowest.length === 0 ? "None is kept." : keptLines(kept.slowest).join("\n"))
      yield* Console.log(`\nFailed runs${since}, newest first:`)
      yield* Console.log(kept.failed.length === 0 ? "None failed." : keptLines(kept.failed).join("\n"))
      const [first] = [...kept.failed, ...kept.slowest]
      if (first !== undefined) {
        yield* Console.log(`\nOpen one, with its spans and logs: ./cluenori trace ${project} ${first.trace}`)
      }
    }),
).pipe(Command.withDescription("One operation: its runs, and its slowest and failed ones, each with its trace."))

const seriesLines = (series: RunSeries) =>
  columns([
    ["Start", "Runs", "Errors"],
    ...series.points.map((point) => [utcMinute(point.start), count(point.runs), share(point.errors, point.runs)]),
  ])

/** `cluenori runs <project>`. */
export const runs = Command.make(
  "runs",
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
      const series = yield* client.signals.runs({ params: { project }, query: { ...query, step } }).pipe(
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
        yield* Console.log(`Past two days runs are counted by the hour, so each line is ${series.step}.\n`)
      }
      yield* Console.log(seriesLines(series).join("\n"))
      yield* Console.log("\nA step that isn't listed had no runs reported.")
    }),
).pipe(Command.withDescription("Runs and errors over time: the load on a project's services."))
