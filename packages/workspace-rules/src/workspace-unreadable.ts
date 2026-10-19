import { Schema } from "effect"

/** A `package.json` is missing or malformed, or the workspace uses a pattern this package can't read. */
export class WorkspaceUnreadable extends Schema.TaggedError<WorkspaceUnreadable>()("WorkspaceUnreadable", {
  /** The file or pattern, relative to the workspace root. */
  path: Schema.String,
  /** What is wrong with it. */
  reason: Schema.String,
}) {}
