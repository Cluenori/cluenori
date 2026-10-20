import { assert } from "@effect/vitest"
import axe from "axe-core"
import { Effect } from "effect"

/**
 * Fails when the page, as it is now, breaks an accessibility rule that axe checks: names each rule
 * and where, so the failure says what to fix.
 */
export const expectAccessible = Effect.fn("expectAccessible")(function* () {
  const results = yield* Effect.promise(() => axe.run(document.body, { resultTypes: ["violations"] }))
  const found = results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(" ")).join("; ")})`,
  )
  assert.deepStrictEqual(found, [])
})
