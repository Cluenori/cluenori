/** A package mutation testing measures, and the lowest score its tests may have. */
export interface MutationTarget {
  /** The package's folder: Stryker runs in it, with its `vitest.config.ts`, and mutates its `src`. */
  readonly folder: string
  /**
   * The lowest mutation score, in percent, the package's tests may have: the score a run measured,
   * so it can only rise. Undefined until the first run has measured one.
   */
  readonly floor: number | undefined
}

/**
 * The packages `.github/workflows/mutation.yml` measures, every week. Not here yet: the Worker, whose
 * tests are the journeys, in another folder, and the dashboard, whose tests run in Chromium. Nor
 * `packages/`: they are the first versions of what bagatka/kit owns, and kit measures its own.
 */
export const mutationTargets: ReadonlyArray<MutationTarget> = [
  { folder: "product/foundation", floor: undefined },
  { folder: "product/engines/github-app", floor: undefined },
  { folder: "product/engines/incidents", floor: undefined },
  { folder: "product/engines/members", floor: undefined },
  { folder: "product/engines/notifications", floor: undefined },
  { folder: "product/engines/phones", floor: undefined },
  { folder: "product/engines/projects", floor: undefined },
  { folder: "product/engines/signals", floor: undefined },
  { folder: "product/engines/today", floor: undefined },
  { folder: "product/modules/analytics", floor: undefined },
  { folder: "product/modules/releases", floor: undefined },
  { folder: "apps/cli", floor: undefined },
  { folder: "tools", floor: undefined },
]
