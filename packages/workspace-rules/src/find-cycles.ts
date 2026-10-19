/**
 * Cycles in a dependency graph, each as a path that starts and ends at its smallest node:
 * `["a", "b", "a"]`. Finds at least one cycle wherever any exists, each at most once; it doesn't
 * list every elementary cycle of a tangle.
 */
export const findCycles = (edges: ReadonlyMap<string, ReadonlyArray<string>>): ReadonlyArray<ReadonlyArray<string>> => {
  const state = new Map<string, "visiting" | "done">()
  const path: Array<string> = []
  const cycles = new Map<string, ReadonlyArray<string>>()

  const visit = (node: string): void => {
    state.set(node, "visiting")
    path.push(node)
    for (const next of edges.get(node) ?? []) {
      const seen = state.get(next)
      if (seen === "visiting") {
        const cycle = startAtSmallest(path.slice(path.indexOf(next)))
        cycles.set(cycle.join("\n"), cycle)
      } else if (seen === undefined) {
        visit(next)
      }
    }
    path.pop()
    state.set(node, "done")
  }

  for (const node of [...edges.keys()].toSorted()) {
    if (!state.has(node)) {
      visit(node)
    }
  }
  return [...cycles.values()]
}

const startAtSmallest = (nodes: ReadonlyArray<string>): ReadonlyArray<string> => {
  const smallest = [...nodes].toSorted()[0] ?? ""
  const start = nodes.indexOf(smallest)
  const rotated = [...nodes.slice(start), ...nodes.slice(0, start)]
  return [...rotated, smallest]
}
