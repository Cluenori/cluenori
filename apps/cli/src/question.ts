import { ComponentKey, EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import type { Period } from "@cluenori/foundation"
import { DateTime, Duration, Effect, Option, Schema } from "effect"
import { Argument, Flag } from "effect/cli"

import { refuse } from "./api-client.ts"
import type { ApiTarget } from "./api-settings.ts"
import { apiTarget } from "./api-settings.ts"
import { utcMinute } from "./terminal-text.ts"

/** `--local`: ask the Cluenori `./run` serves instead of the deployment. */
export const local = Flag.Boolean("local").pipe(
  Flag.withDescription("Ask the Cluenori ./run serves on this computer, not the deployment ./setup made."),
)

/** A value from the command line, typed once here; a refusal says the rule. */
export const parsed = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  value: string,
  what: string,
) =>
  Schema.decodeEffect(schema)(value).pipe(
    Effect.catchTag("SchemaError", (error) => refuse(`"${value}" isn't ${what}: ${error.message}`)),
  )

export const periods = {
  "1h": Duration.hours(1),
  "6h": Duration.hours(6),
  "24h": Duration.days(1),
  "7d": Duration.days(7),
  "14d": Duration.days(14),
  "30d": Duration.days(30),
  "90d": Duration.days(90),
}
export type Last = keyof typeof periods

export const defaultSteps: Readonly<Record<Last, "1m" | "5m" | "1h" | "1d">> = {
  "1h": "5m",
  "6h": "1h",
  "24h": "1h",
  "7d": "1d",
  "14d": "1d",
  "30d": "1d",
  "90d": "1d",
}

/** The project and period a question is about, and its filters. */
export const filters = {
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
  local,
}

export const optionalKey = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  value: Option.Option<string>,
  what: string,
) =>
  Option.match(value, {
    onNone: () => Effect.succeed(Option.none<S["Type"]>()),
    onSome: (text) => parsed(schema, text, what).pipe(Effect.asSome),
  })

// The project, period and filters a command asks about, typed, and where it asks.
export const questionOf = Effect.fn("questionOf")(function* (input: {
  readonly project: string
  readonly last: Last
  readonly environment: Option.Option<string>
  readonly component: Option.Option<string>
  readonly local: boolean
}) {
  const project = yield* parsed(ProjectKey, input.project, "a project key")
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

/** What a command's answer covers, for its first line. */
export const headline = (project: string, target: ApiTarget, covered: Period | undefined, kept: string) =>
  covered === undefined
    ? `${project} on ${target.url}: no part of the period is kept (${kept}).`
    : `${project} on ${target.url}, ${utcMinute(covered.from)} to ${utcMinute(covered.to)}`
