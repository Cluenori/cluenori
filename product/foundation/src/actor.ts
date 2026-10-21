import { Schema } from "effect"

import { AgentRunId, MemberId, PersonId } from "./ids.ts"
import { dottedKeyPattern, dottedKeyRule } from "./patterns.ts"

/** A system process that acts on its own, named `<package>.<job>`: `releases.store-sync`. Up to 100 characters. */
export const ProcessName = Schema.String.check(
  Schema.isMaxLength(100),
  Schema.isPattern(dottedKeyPattern, { expected: dottedKeyRule }),
).pipe(Schema.brand("ProcessName"))
export type ProcessName = typeof ProcessName.Type

/**
 * Who performs a change:
 * - `Member`: a member of the workspace, from the dashboard, the CLI, or the API.
 * - `Person`: an end user, from an app, such as when they send feedback.
 * - `AgentRun`: one run of an agent; the run knows who started it.
 * - `System`: a reaction, job, or workflow, by its process name.
 */
export const Actor = Schema.Union([
  Schema.TaggedStruct("Member", { id: MemberId }),
  Schema.TaggedStruct("Person", { id: PersonId }),
  Schema.TaggedStruct("AgentRun", { id: AgentRunId }),
  Schema.TaggedStruct("System", { process: ProcessName }),
])
export type Actor = typeof Actor.Type

/**
 * The actor may not do this: only an owner invites, removes, or changes who sees what, or creates a
 * project.
 */
export class NotAllowed extends Schema.TaggedError<NotAllowed>()("NotAllowed", {}) {}
