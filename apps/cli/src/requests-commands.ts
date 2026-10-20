import type { RequestSeries } from "@cluenori/signals"
import { Console, Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import type { ApiTarget } from "./api-settings.ts"
import { defaultSteps, filters, headline, questionOf } from "./question.ts"
import { columns, count, milliseconds, share, utcMinute } from "./terminal-text.ts"

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
