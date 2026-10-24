/** A source file mutation testing changes: its path in its package's folder, and its length. */
export interface SourceFile {
  readonly path: string
  readonly lines: number
}

/**
 * About how many lines of source one CI job mutates. A job gets 6 hours on GitHub's runners and is
 * stopped after them. Phones' engine and Analytics measured 0.46 and 0.76 mutants a line, at about
 * 3 s of a worker's time each, so a shard of this size takes well under an hour with three workers.
 */
export const linesPerShard = 1_200

// Machine text, so sorted by code point, the same on every machine.
const byCodePoint = (left: string, right: string) => {
  if (left === right) {
    return 0
  }
  return left < right ? -1 : 1
}

/**
 * `files` split into the fewest shards of about `budget` lines each: the longest file first, each
 * into the shard with the fewest lines so far, the first of them on a tie. A shard can be over by up
 * to its longest file, as a file isn't split. The same files always make the same shards, in the
 * same order, each with its paths sorted. No files make no shards.
 */
export const shardsOf = (
  files: ReadonlyArray<SourceFile>,
  budget: number = linesPerShard,
): ReadonlyArray<ReadonlyArray<string>> => {
  if (files.length === 0) {
    return []
  }
  const total = files.reduce((sum, file) => sum + file.lines, 0)
  // No more shards than files, so none is empty: the longest files each start one.
  const shards = Array.from({ length: Math.min(files.length, Math.max(1, Math.ceil(total / budget))) }, () => ({
    lines: 0,
    paths: new Array<string>(),
  }))
  const longestFirst = files.toSorted((left, right) => right.lines - left.lines || byCodePoint(left.path, right.path))
  for (const file of longestFirst) {
    const emptiest = shards.reduce((best, shard) => (shard.lines < best.lines ? shard : best))
    emptiest.lines += file.lines
    emptiest.paths.push(file.path)
  }
  return shards.map((shard) => shard.paths.toSorted(byCodePoint))
}
