import { Effect, FileSystem, Path, Schema } from "effect"

import { parseFolderPattern } from "./folder-pattern.ts"
import { PackageJsonFromString } from "./package-json.ts"
import type { PackageJson } from "./package-json.ts"
import { WorkspaceUnreadable } from "./workspace-unreadable.ts"

/** A workspace as the rules see it. Folders are relative to the root and written with `/`. */
export interface Workspace {
  /** The root `package.json`'s catalog: one version for each npm package. */
  readonly catalog: Readonly<Record<string, string>>
  /** Every workspace package, sorted by folder. */
  readonly members: ReadonlyArray<Member>
}

export interface Member {
  readonly folder: string
  readonly manifest: PackageJson
  /** Whether `src/index.ts` exists. */
  readonly hasEntry: boolean
}

const unreadable = (file: string) =>
  Effect.mapError(
    (error: { readonly message: string }) => new WorkspaceUnreadable({ path: file, reason: error.message }),
  )

// Enough parallel reads to hide disk latency, few enough to stay far below open-file limits.
const concurrency = 16

/** Reads the root `package.json` and every member's `package.json`. */
export const readWorkspace = Effect.fn("readWorkspace")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const exists = (file: string) => fs.exists(path.join(root, file)).pipe(unreadable(file))
  const list = (folder: string) => fs.readDirectory(path.join(root, folder)).pipe(unreadable(folder))
  const readText = (file: string) => fs.readFileString(path.join(root, file)).pipe(unreadable(file))
  const readManifest = (file: string) =>
    readText(file).pipe(Effect.flatMap(Schema.decodeEffect(PackageJsonFromString)), unreadable(file))

  const expand = Effect.fn("readWorkspace.expand")(function* (pattern: string) {
    const parsed = parseFolderPattern(pattern)
    if (parsed._tag === "None") {
      return yield* new WorkspaceUnreadable({
        path: "package.json",
        reason: `the workspace pattern "${pattern}" isn't a folder or a "parent/*" pattern`,
      })
    }
    const parent = parsed.value.parent
    const parentExists = yield* exists(parent)
    if (!parentExists) {
      return []
    }
    const names = yield* list(parent)
    const folders = names.filter(parsed.value.matchesName).map((name) => (parent === "" ? name : `${parent}/${name}`))
    return yield* Effect.filter(folders, (folder) => exists(`${folder}/package.json`), { concurrency })
  })

  const readMember = Effect.fn("readWorkspace.readMember")(function* (folder: string) {
    const manifest = yield* readManifest(`${folder}/package.json`)
    const hasEntry = yield* exists(`${folder}/src/index.ts`)
    return { folder, manifest, hasEntry } satisfies Member
  })

  const rootManifest = yield* readManifest("package.json")
  const workspaces = rootManifest.workspaces
  if (workspaces === undefined) {
    return yield* new WorkspaceUnreadable({ path: "package.json", reason: "it has no workspaces" })
  }
  // Bun reads `workspaces` as a list of patterns, or as an object with the list and a catalog.
  const patterns = "packages" in workspaces ? workspaces.packages : workspaces
  const catalog = "packages" in workspaces ? (workspaces.catalog ?? {}) : {}

  const expanded = yield* Effect.forEach(patterns, expand)
  const folders = [...new Set(expanded.flat())].toSorted()
  const members = yield* Effect.forEach(folders, readMember, { concurrency })
  return { catalog, members } satisfies Workspace
})
