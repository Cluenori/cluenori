import { DateTime } from "effect"

import type { ErrorGroup } from "./error-groups.ts"
import type { OperationRow, OperationTable } from "./operation-queries.ts"

// What the counts say about an operation or an error compared with its own usual: the one place
// these rules live, for every page, Today, and every client.

/**
 * An operation got slower when its p95 over the last day is at least `times` its usual p95, over
 * the 7 days before, and at least `byMs` more. The second keeps a fast operation going from 2 ms to
 * 4 ms from counting.
 */
export const slowerRule = { times: 1.5, byMs: 100 } as const

/** An operation that got slower: its p95 over the last day, and its usual. */
export interface Slower {
  readonly p95Ms: number
  readonly usualP95Ms: number
}

/** Whether something timed got slower; absent when it didn't, or is too new to have a usual p95. */
export const slowerOf = (row: { readonly lastDayP95Ms: number; readonly usualP95Ms?: number }): Slower | undefined => {
  const usual = row.usualP95Ms
  if (
    usual === undefined ||
    row.lastDayP95Ms < usual * slowerRule.times ||
    row.lastDayP95Ms - usual < slowerRule.byMs
  ) {
    return undefined
  }
  return { p95Ms: row.lastDayP95Ms, usualP95Ms: usual }
}

/** An operation row's identity: its component, environment, and name. */
export const operationKeyOf = (row: Pick<OperationRow, "component" | "environment" | "operation">) =>
  [row.component, row.environment ?? "", row.operation].join("\u0000")

/** The operations over the last day and over the 7 days before: what "slower" compares. */
export interface Compared {
  readonly lastDay: OperationTable
  readonly usual: OperationTable
}

/** An operation's p95 over the last day, and its usual p95 when it ran in the 7 days before. */
export const usualOf = (compared: Compared, key: string) => {
  const lastDay = compared.lastDay.rows.find((row) => operationKeyOf(row) === key)
  const usual = compared.usual.rows.find((row) => operationKeyOf(row) === key)
  return lastDay === undefined
    ? undefined
    : { lastDayP95Ms: lastDay.p95Ms, ...(usual === undefined ? {} : { usualP95Ms: usual.p95Ms }) }
}

/** Which operations got slower, by `operationKeyOf`. An operation new this week has no verdict. */
export const slowerOperations = (compared: Compared): ReadonlyMap<string, Slower> => {
  const usual = new Map(compared.usual.rows.map((row) => [operationKeyOf(row), row.p95Ms] as const))
  return new Map(
    compared.lastDay.rows.flatMap((row) => {
      const key = operationKeyOf(row)
      const usualP95Ms = usual.get(key)
      const slower = slowerOf({ lastDayP95Ms: row.p95Ms, ...(usualP95Ms === undefined ? {} : { usualP95Ms }) })
      return slower === undefined ? [] : [[key, slower] as const]
    }),
  )
}

/** An error group is new for a day after it was first seen, and ongoing for 15 minutes after it was last. */
export const errorRule = { newForMs: 86_400_000, ongoingForMs: 15 * 60_000 } as const

/** Whether an error group is new, and whether it is happening now, at `now` (Unix ms). */
export const errorStatusOf = (group: Pick<ErrorGroup, "firstSeen" | "lastSeen">, now: number) => ({
  isNew: now - DateTime.toEpochMillis(group.firstSeen) < errorRule.newForMs,
  ongoing: now - DateTime.toEpochMillis(group.lastSeen) < errorRule.ongoingForMs,
})
