import { EnvelopeName } from "@cluenori/foundation"
import type { KeptTraceRow, LoadSeries } from "@cluenori/signals"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import type { ApiTarget } from "./api-settings.ts"
import { defaultSteps, filters, headline, parsed, questionOf } from "./question.ts"
import { columns, count, milliseconds, share, utcMinute, utcSecond } from "./terminal-text.ts"

const nothingYet = (project: string, target: ApiTarget) =>
  `Nothing from ${project} in this period. Components send their traces to ${target.url}/otlp/v1/traces with their ingest key; ./cluenori component add makes one.`

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
        "Count",
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
        count(row.count),
        share(row.errors, row.count),
        milliseconds(row.averageMs),
        milliseconds(row.p50Ms),
        milliseconds(row.p80Ms),
        milliseconds(row.p95Ms),
        milliseconds(row.p99Ms),
      ]),
    ])
    yield* Console.log(lines.join("\n"))
    const until = table.dataUntil === undefined ? "" : `, data until ${utcMinute(table.dataUntil)}`
    yield* Console.log(`\n${count(table.count)} counted, ${share(table.errors, table.count)} failed${until}.`)
    yield* Console.log("Percentiles are within 2% of the true value.")
  }),
).pipe(Command.withDescription("Every operation: how many times it ran, how many failed, and how long it took."))

// A kept trace's status as people read it: its HTTP status, or, without one, whether it failed.
const statusOf = (row: KeptTraceRow) => {
  if (row.status !== undefined) {
    return `${row.status}`
  }
  return row.failed ? "failed" : ""
}

// Kept traces as lines: when each started, how long its operation took, its status, and its ID.
const keptLines = (rows: ReadonlyArray<KeptTraceRow>) =>
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
      const kept = yield* client.signals.keptTraces(asked).pipe(Effect.catchTags(failures))
      yield* Console.log(`${headline(project, target, table.covered, "counts are kept 15 months")}\n`)
      if (table.rows.length === 0) {
        return yield* Console.log(
          table.lastSeen === undefined
            ? `${name} didn't run in this period. Its name must match exactly, as ./cluenori operations ${project} lists it.`
            : `${name} didn't run in this period. It last ran until ${utcMinute(table.lastSeen)}, in any environment; a longer --last holds it while its counts are kept.`,
        )
      }
      for (const row of table.rows) {
        yield* Console.log(`${row.operation}  ${row.component}  ${row.environment ?? "unknown environment"}`)
        yield* Console.log(
          `  ${row.count === 1 ? "Ran once" : `Ran ${count(row.count)} times`}, ${share(row.errors, row.count)} failed; avg ${milliseconds(row.averageMs)}, p50 ${milliseconds(row.p50Ms)}, p95 ${milliseconds(row.p95Ms)}, p99 ${milliseconds(row.p99Ms)}`,
        )
      }
      const since = kept.covered === undefined ? "" : ` since ${utcMinute(kept.covered.from)}`
      yield* Console.log(`\nSlowest traces${since}, slowest first: of each hour, the five slowest are kept 14 days.`)
      yield* Console.log(kept.slowest.length === 0 ? "None is kept." : keptLines(kept.slowest).join("\n"))
      yield* Console.log(`\nFailed traces${since}, newest first:`)
      yield* Console.log(kept.failed.length === 0 ? "None failed." : keptLines(kept.failed).join("\n"))
      const [first] = [...kept.failed, ...kept.slowest]
      if (first !== undefined) {
        yield* Console.log(`\nOpen one, with its spans and logs: ./cluenori trace ${project} ${first.trace}`)
      }
    }),
).pipe(Command.withDescription("One operation: how many times it ran, and its slowest and failed traces."))

const seriesLines = (series: LoadSeries) =>
  columns([
    ["Start", "Count", "Errors"],
    ...series.points.map((point) => [utcMinute(point.start), count(point.count), share(point.errors, point.count)]),
  ])

/** `cluenori load <project>`. */
export const load = Command.make(
  "load",
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
      const series = yield* client.signals.load({ params: { project }, query: { ...query, step } }).pipe(
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
        yield* Console.log(`Past two days the load is counted by the hour, so each line is ${series.step}.\n`)
      }
      yield* Console.log(seriesLines(series).join("\n"))
      yield* Console.log("\nA step that isn't listed had nothing reported.")
    }),
).pipe(Command.withDescription("The load over time: how many operations ran and failed, on a project's services."))
