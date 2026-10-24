/** A source file mutation testing changes: its path in its package's folder, and its length. */
export interface SourceFile {
  readonly path: string
  readonly lines: number
  /** Whether the package's tests load it (`testedPaths`). */
  readonly tested: boolean
}

/**
 * About how many lines of source one CI job mutates. A job gets 6 hours on GitHub's runners and is
 * stopped after them. Phones' engine and Analytics measured 0.46 and 0.76 mutants a line, at about
 * 3 s of a worker's time each; with three workers, the first full run's shards took 1 to 83 minutes.
 */
export const linesPerShard = 1_200

// Machine text, so sorted by code point, the same on every machine.
const byCodePoint = (left: string, right: string) => {
  if (left === right) {
    return 0
  }
  return left < right ? -1 : 1
}

// `specifier` from the file at `from`, both relative to the package's folder, with `.` and `..`
// resolved. A path above the folder keeps its leading `..`, so it matches none of the package's files.
const resolved = (from: string, specifier: string) => {
  const parts: Array<string> = from.split("/").slice(0, -1)
  for (const part of specifier.split("/")) {
    if (part === "..") {
      if (parts.length > 0 && parts.at(-1) !== "..") {
        parts.pop()
      } else {
        parts.push(part)
      }
    } else if (part !== ".") {
      parts.push(part)
    }
  }
  return parts.join("/")
}

// What loads another module when it runs: `import … from`, `export … from`, `import "…"` and
// `import("…")`, double-quoted, as the formatter writes them. Group 1 is a static statement's `type`,
// group 2 its clause, and group 3 or 4 the specifier.
const imports = /\b(?:import|export)\s+(type\s+)?([^;"']*?)\s*from\s*"([^"]+)"|\bimport\s*\(?\s*"([^"]+)"/g

// `{ type A, type B }`: names only types, so the compiler removes the import.
const onlyTypes = (clause: string) => {
  const names = /^\{([^}]*)\}$/.exec(clause.trim())
  if (names === null) {
    return false
  }
  const specifiers = (names[1] ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "")
  return specifiers.length > 0 && specifiers.every((name) => name.startsWith("type "))
}

/**
 * The files `tests` load when they run: what they import by a relative path, and what those import,
 * through re-exports, side-effect and dynamic imports. Type-only imports are left out, as the
 * compiler removes them. `texts` is each file's text by its path in the package's folder; an import
 * of a file it doesn't have, or of another package, is followed no further. Recognized are imports
 * as the formatter writes them, in double quotes; one written in a string or a comment counts too.
 */
export const testedPaths = (texts: ReadonlyMap<string, string>, tests: ReadonlyArray<string>): ReadonlySet<string> => {
  const loaded = new Set<string>()
  const pending = [...tests]
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    const text = texts.get(path)
    if (loaded.has(path) || text === undefined) {
      continue
    }
    loaded.add(path)
    for (const [, type, clause, statement, dynamic] of text.matchAll(imports)) {
      const specifier = statement ?? dynamic ?? ""
      if (type === undefined && !onlyTypes(clause ?? "") && specifier.startsWith(".")) {
        pending.push(resolved(path, specifier))
      }
    }
  }
  for (const test of tests) {
    loaded.delete(test)
  }
  return loaded
}

/**
 * `files` split into the fewest shards of about `budget` lines each: the longest file first, each
 * into the shard with the fewest lines so far, the first of them on a tie. A shard can be over by up
 * to its longest file, as a file isn't split. Each shard starts with a file the tests load: Stryker
 * runs only the tests that load a shard's files, and with none, it can't tell the shard's mutants
 * aren't covered and stops. So there are no more shards than such files, and a package whose tests
 * load none of its files is one shard, which Stryker refuses. The same files always make the same
 * shards, in the same order, each with its paths sorted. No files make no shards.
 */
export const shardsOf = (
  files: ReadonlyArray<SourceFile>,
  budget: number = linesPerShard,
): ReadonlyArray<ReadonlyArray<string>> => {
  if (files.length === 0) {
    return []
  }
  const longestFirst = (left: SourceFile, right: SourceFile) =>
    right.lines - left.lines || byCodePoint(left.path, right.path)
  const tested = files.filter((file) => file.tested).toSorted(longestFirst)
  const untested = files.filter((file) => !file.tested).toSorted(longestFirst)
  const total = files.reduce((sum, file) => sum + file.lines, 0)
  const count = Math.max(1, Math.min(tested.length, Math.ceil(total / budget)))
  const shards = tested.slice(0, count).map((file) => ({ lines: file.lines, paths: [file.path] }))
  if (shards.length === 0) {
    shards.push({ lines: 0, paths: [] })
  }
  for (const file of [...tested.slice(count), ...untested].toSorted(longestFirst)) {
    const emptiest = shards.reduce((best, shard) => (shard.lines < best.lines ? shard : best))
    emptiest.lines += file.lines
    emptiest.paths.push(file.path)
  }
  return shards.map((shard) => shard.paths.toSorted(byCodePoint))
}
