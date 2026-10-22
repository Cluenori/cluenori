import { assert } from "@effect/vitest"
import axe from "axe-core"
import { Effect } from "effect"

/**
 * Fails when the page, once what is fading or moving in has settled, breaks an accessibility rule
 * that axe checks: names each rule and where, so the failure says what to fix.
 */
export const expectAccessible = Effect.fn("expectAccessible")(function* () {
  // A dialog halfway through fading in has less contrast than the one people read. A spinner's
  // animation never ends, so only those that do are waited for.
  const ending = document
    .getAnimations()
    .filter((animation) => animation.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY)
  yield* Effect.promise(() => Promise.allSettled(ending.map((animation) => animation.finished)))
  const results = yield* Effect.promise(() => axe.run(document.body, { resultTypes: ["violations"] }))
  const found = results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes.map((node) => `${node.target.join(" ")}: ${node.failureSummary ?? ""}`).join("; ")})`,
  )
  assert.deepStrictEqual(found, [])
})
