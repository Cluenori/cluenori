import { Option } from "effect"

/** What Stryker found of one mutant, as its JSON report writes it, once a run has finished. */
export type MutantStatus =
  | "Killed"
  | "Timeout"
  | "Survived"
  | "NoCoverage"
  | "CompileError"
  | "RuntimeError"
  | "Ignored"

/** How a package's mutants went: caught by a test (killed, or timed out), survived, or never run. */
export interface Tally {
  readonly caught: number
  readonly survived: number
  readonly notCovered: number
}

/** `statuses` counted. Mutants that didn't compile or run, or that Stryker was told to skip, aren't. */
export const tallyOf = (statuses: Iterable<MutantStatus>): Tally => {
  let caught = 0
  let survived = 0
  let notCovered = 0
  for (const status of statuses) {
    if (status === "Killed" || status === "Timeout") {
      caught += 1
    } else if (status === "Survived") {
      survived += 1
    } else if (status === "NoCoverage") {
      notCovered += 1
    }
  }
  return { caught, survived, notCovered }
}

/**
 * The mutation score, in percent: the share of counted mutants a test caught, as Stryker computes
 * it. None when no mutant counts, as there is nothing to score.
 */
export const scoreOf = (tally: Tally): Option.Option<number> => {
  const counted = tally.caught + tally.survived + tally.notCovered
  return counted === 0 ? Option.none() : Option.some((tally.caught / counted) * 100)
}

/**
 * The floor `score` sets, in percent: rounded down to hundredths, so the run that set it clears it,
 * and the same score never asks to raise it again.
 */
export const floorOf = (score: number): number => Math.floor(score * 100) / 100
