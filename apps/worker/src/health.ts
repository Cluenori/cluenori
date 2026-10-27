import type { ProjectKey } from "@cluenori/foundation"
import type { ProjectNotFound } from "@cluenori/projects"
import { IngestKey, ingestKeyScope } from "@cluenori/projects"
import { Config, Context, Duration, Effect, Layer, Option, Redacted, Schema } from "effect"

import { Unavailable } from "./cluenori-api.ts"
import { projectCalls } from "./project-calls.ts"
import { ProjectObjects } from "./project-objects.ts"
import { workspaceCalls } from "./workspace-calls.ts"
import { WorkspaceObjects } from "./workspace-objects.ts"

// The most a check waits for each object: an answer later than this is a deployment that is down
// to whoever is watching it.
const patience = Duration.seconds(5)

/** Whether the deployment can serve: its storage answers, not only its code. */
export class Health extends Context.Service<
  Health,
  {
    /**
     * Succeeds when the workspace's Durable Object answers a read, and, when the deployment measures
     * itself, so does its own project's (`CLUENORI_SELF_INGEST_KEY` names which), each within 5
     * seconds; fails with `Unavailable`, its cause logged, when either doesn't. Two object reads, at once.
     */
    readonly check: Effect.Effect<void, Unavailable>
  }
>()("@cluenori/worker/health") {
  static readonly layer = Layer.effect(
    Health,
    Effect.gen(function* () {
      const workspace = yield* WorkspaceObjects
      const projects = yield* ProjectObjects
      const selfKey = yield* Config.option(Config.Redacted("CLUENORI_SELF_INGEST_KEY")).pipe(Effect.orDie)
      // A key that isn't one turns the deployment's telemetry off loudly where it is read
      // (self-telemetry.ts); here it only means there is no own project to check.
      const selfProject: Option.Option<ProjectKey> = Option.flatMap(selfKey, (key) => {
        const value = Redacted.value(key)
        return Schema.is(IngestKey)(value) ? Option.some(ingestKeyScope(value).project) : Option.none()
      })
      // Made for each check: an object's stub belongs to the request that made it.
      const reads = (): ReadonlyArray<Effect.Effect<void, ProjectNotFound>> => [
        Effect.asVoid(workspace.call(workspaceCalls.projects, undefined)),
        ...Option.match(selfProject, {
          onNone: () => [],
          onSome: (project) => [Effect.asVoid(projects.call(project, projectCalls.detail, undefined))],
        }),
      ]
      return Health.of({
        check: Effect.suspend(() =>
          Effect.forEach(reads(), (read) => Effect.timeout(read, patience), {
            concurrency: "unbounded",
            discard: true,
          }),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logError("The health check failed", cause).pipe(Effect.andThen(Effect.fail(new Unavailable()))),
          ),
        ),
      })
    }),
  )
}
