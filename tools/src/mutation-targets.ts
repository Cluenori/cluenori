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
 * The packages `.github/workflows/mutation.yml` measures, every night main has moved. Not here yet:
 * the Worker, whose tests are the journeys, in another folder, and the dashboard, whose tests run in
 * Chromium. Nor `packages/`: they are the first versions of what bagatka/kit owns, and kit measures
 * its own.
 */
export const mutationTargets: ReadonlyArray<MutationTarget> = [
  { folder: "product/foundation", floor: 72.77 },
  { folder: "product/engines/feeds", floor: 65.93 },
  { folder: "product/engines/github-app", floor: 53.67 },
  { folder: "product/engines/incidents", floor: 67.62 },
  { folder: "product/engines/members", floor: 58 },
  { folder: "product/engines/notifications", floor: 76.47 },
  { folder: "product/engines/phones", floor: 61.46 },
  { folder: "product/engines/projects", floor: 62.67 },
  { folder: "product/engines/signals", floor: 63.31 },
  { folder: "product/engines/today", floor: 45.11 },
  { folder: "product/modules/analytics", floor: 55.65 },
  { folder: "product/modules/releases", floor: 70.91 },
  { folder: "apps/cli", floor: 10.58 },
  { folder: "tools", floor: 39.97 },
  { folder: "sdks/web", floor: 46.16 },
]
