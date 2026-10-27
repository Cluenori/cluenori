import type { ComponentKey } from "@cluenori/foundation"
import { ComponentKey as ComponentKeySchema, EnvelopeName, Period } from "@cluenori/foundation"
import { DateTime, Duration, Effect, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import type { OriginOperationCounts, OriginQuery, OriginTable } from "./operation-queries.ts"
import { otherOperations } from "./operation-queries.ts"
import { hourlyRetention } from "./operation-store.ts"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const hourMillis = 3_600_000

const Row = Schema.Struct({
  component: ComponentKeySchema,
  operation: EnvelopeName,
  origin: ComponentKeySchema,
  count: Count,
  errors: Count,
  totalMs: Schema.Finite,
})

/**
 * Operations counted by the client that asked for them, by the hour, kept 15 months as hourly
 * counts are. Part of Signals, which owns the transaction each write runs in.
 */
export const originCounts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const findOperations = SqlSchema.findAll({
    Request: ComponentKeySchema,
    Result: Schema.Struct({ name: EnvelopeName }),
    execute: (component) => sql`SELECT name FROM signals_operations WHERE component = ${component}`,
  })

  // The components that reported to the project themselves, as a service or an app, each with a
  // key of its own: the only origins counted.
  const findReporting = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({ component: ComponentKeySchema }),
    execute: () => sql`
      SELECT component FROM signals_operations
      UNION SELECT component FROM signals_app_releases`,
  })

  // Adds an export's counts to those of `component`, after the operation counts of the same export,
  // in the same transaction: an operation counted as one of `(other operations)` there, past each
  // component's limit, is that here too. Baggage is the caller's word, so an origin counts only when
  // it is a component that reported to the project itself, which takes a key; any other, invented
  // or not reported yet, is left with the requests that named none. So the origins kept are few,
  // whatever callers send.
  const add = Effect.fn("OriginCounts.add")(function* (
    component: ComponentKey,
    counts: ReadonlyArray<OriginOperationCounts>,
  ) {
    if (counts.length === 0) {
      return
    }
    const known = new Set((yield* findOperations(component)).map((row) => row.name))
    const reporting = new Set((yield* findReporting(undefined)).map((row) => row.component))
    for (const each of counts.filter((counted) => reporting.has(counted.origin))) {
      yield* sql`
        INSERT INTO signals_origin_hours ${sql.insert({
          hour: DateTime.toEpochMillis(each.hour),
          component,
          operation: known.has(each.operation) ? each.operation : otherOperations,
          environment: each.environment ?? "",
          origin: each.origin,
          count: each.count,
          errors: each.errors,
          total_ms: each.totalMs,
        })}
        ON CONFLICT (hour, component, operation, environment, origin) DO UPDATE SET
          count = count + excluded.count, errors = errors + excluded.errors, total_ms = total_ms + excluded.total_ms`
    }
  })

  const cleanUp = Effect.fn("OriginCounts.cleanUp")(function* (now: number) {
    yield* sql`DELETE FROM signals_origin_hours WHERE hour < ${now - Duration.toMillis(hourlyRetention)}`
  })

  /** The query's operations by origin, over the whole hours its period touches, cut to what is kept. */
  const split = Effect.fn("OriginCounts.split")(function* (query: OriginQuery, now: number) {
    const keptFrom = now - Duration.toMillis(hourlyRetention)
    const fromMillis = Math.max(DateTime.toEpochMillis(query.period.from), keptFrom)
    const toMillis = Math.min(DateTime.toEpochMillis(query.period.to), now)
    if (fromMillis >= toMillis) {
      const none: OriginTable = { rows: [] }
      return none
    }
    const from = fromMillis - (fromMillis % hourMillis)
    const to = toMillis - (toMillis % hourMillis) + (toMillis % hourMillis === 0 ? 0 : hourMillis)
    const rows = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: Row,
      execute: () => sql`
        SELECT component, operation, origin, sum(count) AS count, sum(errors) AS errors, sum(total_ms) AS "totalMs"
        FROM signals_origin_hours
        WHERE ${sql.and([
          sql`hour >= ${from}`,
          sql`hour < ${to}`,
          ...(query.environment === undefined ? [] : [sql`environment = ${query.environment}`]),
          ...(query.component === undefined ? [] : [sql`component = ${query.component}`]),
          ...(query.operation === undefined ? [] : [sql`operation = ${query.operation}`]),
        ])}
        GROUP BY component, operation, origin
        ORDER BY count DESC, component, operation, origin`,
    })(undefined).pipe(Effect.orDie)
    const table: OriginTable = {
      covered: new Period({ from: DateTime.makeUnsafe(from), to: DateTime.makeUnsafe(to) }),
      rows: rows.map((row) => ({
        component: row.component,
        operation: row.operation,
        origin: row.origin,
        count: row.count,
        errors: row.errors,
        // Every row counted at least one run.
        averageMs: row.totalMs / row.count,
      })),
    }
    return table
  })

  return { add, cleanUp, split }
})
