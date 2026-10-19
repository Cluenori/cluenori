import { Effect } from "effect"

import { findViolations } from "./find-violations.ts"
import { parseFolderPattern } from "./folder-pattern.ts"
import type { PackageRule } from "./package-rule.ts"
import { readWorkspace } from "./read-workspace.ts"

/**
 * Reads the workspace at `root` and returns every way its packages break `rules`, sorted by folder.
 * An empty array means the workspace follows them.
 *
 * Reads the root `package.json` and each member's `package.json`; it changes nothing. Whether a
 * package imports only what it declares is enforced by the package manager's isolated installs,
 * not here.
 *
 * Fails with `WorkspaceUnreadable` when a `package.json` is missing or malformed, or the workspace
 * uses a pattern other than a folder or `parent/*`. A rule with such a pattern is a bug in the
 * caller, and dies.
 */
export const checkWorkspace = Effect.fn("checkWorkspace")(function* (root: string, rules: ReadonlyArray<PackageRule>) {
  const patterns = rules.flatMap((rule) => [rule.folders, ...rule.mayUse])
  const invalid = patterns.filter((pattern) => parseFolderPattern(pattern)._tag === "None")
  if (invalid.length > 0) {
    return yield* Effect.die(`A PackageRule pattern must be a folder or "parent/*": ${invalid.join(", ")}`)
  }
  const workspace = yield* readWorkspace(root)
  return findViolations(workspace, rules)
})
