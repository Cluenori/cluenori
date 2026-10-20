import { ComponentKey, EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import type { EndpointTable, RequestSeries } from "@cluenori/signals"
import { Console, DateTime, Duration, Effect, Option, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import type { ApiTarget } from "./api-settings.ts"
import { apiTarget } from "./api-settings.ts"
import { columns, count, milliseconds, share, utcMinute } from "./terminal-text.ts"

const periods = {
  "1h": Duration.hours(1),
  "6h": Duration.hours(6),
  "24h": Duration.days(1),
  "7d": Duration.days(7),
  "14d": Duration.days(14),
  "30d": Duration.days(30),
  "90d": Duration.days(90),
}
type Last = keyof typeof periods

const defaultSteps: Readonly<Record<Last, "1m" | "5m" | "1h" | "1d">> = {
  "1h": "5m",
  "6h": "1h",
  "24h": "1h",
  "7d": "1d",
  "14d": "1d",
  "30d": "1d",
  "90d": "1d",
}

const filters = {
  project: Argument.String("project").pipe(Argument.withDescription("The project's key.")),
  last: Flag.Literals("last", ["1h", "6h", "24h", "7d", "14d", "30d", "90d"]).pipe(
    Flag.withDefault("24h"),
    Flag.withDescription("How far back to look: counted by the minute up to two days, by the hour beyond."),
  ),
  environment: Flag.String("environment").pipe(
    Flag.optional,
    Flag.withDescription("Only this environment, such as prod."),
  ),
  component: Flag.String("component").pipe(
    Flag.optional,
    Flag.withDescription("Only this component, such as notes-api."),
  ),
  local: Flag.Boolean("local").pipe(
    Flag.withDescription("Ask the Cluenori ./run serves on this computer, not the deployment ./setup made."),
  ),
}

const optionalKey = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  value: Option.Option<string>,
  what: string,
) =>
  Option.match(value, {
    onNone: () => Effect.succeed(Option.none<S["Type"]>()),
    onSome: (text) =>
      Schema.decodeEffect(schema)(text).pipe(
        Effect.asSome,
        Effect.catchTag("SchemaError", (error) => refuse(`"${text}" isn't ${what}: ${error.message}`)),
      ),
  })

// The project, period and filters a command asks about, typed, and where it asks.
const questionOf = Effect.fn("questionOf")(function* (input: {
  readonly project: string
  readonly last: Last
  readonly environment: Option.Option<string>
  readonly component: Option.Option<string>
  readonly local: boolean
}) {
  const project = yield* Schema.decodeEffect(ProjectKey)(input.project).pipe(
    Effect.catchTag("SchemaError", (error) => refuse(`"${input.project}" isn't a project key: ${error.message}`)),
  )
  const environment = yield* optionalKey(EnvironmentKey, input.environment, "an environment key")
  const component = yield* optionalKey(ComponentKey, input.component, "a component key")
  const now = yield* DateTime.now
  const target = yield* apiTarget(input.local)
  const query = {
    from: DateTime.subtract(now, { milliseconds: Duration.toMillis(periods[input.last]) }),
    to: now,
    ...Option.match(environment, { onNone: () => ({}), onSome: (key) => ({ environment: key }) }),
    ...Option.match(component, { onNone: () => ({}), onSome: (key) => ({ component: key }) }),
  }
  return { project, query, target }
})

const headline = (project: string, target: ApiTarget, covered: EndpointTable["covered"]) =>
  covered === undefined
    ? `${project} on ${target.url}: no part of the period is kept (counts are kept 15 months).`
    : `${project} on ${target.url}, ${utcMinute(covered.from)} to ${utcMinute(covered.to)}`

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
    yield* Console.log(`${headline(project, target, table.covered)}\n`)
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
      yield* Console.log(`${headline(project, target, series.covered)}\n`)
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
