import { Schema } from "effect"

/** Where a build runs: on the founder's own machine, or on the repository's cloud runner. */
export const ResolvedRunner = Schema.Literals(["local", "cloud"]).annotate({ identifier: "ResolvedRunner" })
export type ResolvedRunner = typeof ResolvedRunner.Type

/** Ask where a component's next build runs, for a CI that was told `auto`. */
export const RunnerQuery = Schema.Struct({}).annotate({ identifier: "RunnerQuery" })
export type RunnerQuery = typeof RunnerQuery.Type

/** Where it runs, and why, for the CI's log. */
export const RunnerAnswer = Schema.Struct({ runner: ResolvedRunner, reason: Schema.String }).annotate({
  identifier: "RunnerAnswer",
})
export type RunnerAnswer = typeof RunnerAnswer.Type

/** The label a self-hosted runner on the founder's own machine carries. */
export const localLabel = "local"
