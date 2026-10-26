import type { ComponentKey } from "@cluenori/foundation"
import {
  calendarDayOfNumber,
  ComponentKey as ComponentKeySchema,
  dayNumberOf,
  EnvelopeName,
} from "@cluenori/foundation"
import { Duration, Effect, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import type { FeatureOperationCounts, FeatureOperationDay, FeatureQuery } from "./feature-queries.ts"
import { otherOperations } from "./operation-queries.ts"
import { hourlyRetention } from "./operation-store.ts"

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

const DayRow = Schema.Struct({
  day: Schema.Int,
  component: ComponentKeySchema,
  operation: EnvelopeName,
  count: Count,
  errors: Count,
})

/**
 * Operations counted by the feature they ran for, by UTC day, kept 15 months as hourly counts are.
 * Part of Signals, which owns the transaction each write runs in.
 */
export const featureCounts = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const findOperations = SqlSchema.findAll({
    Request: ComponentKeySchema,
    Result: Schema.Struct({ name: EnvelopeName }),
    execute: (component) => sql`SELECT name FROM signals_operations WHERE component = ${component}`,
  })

  // Adds an export's counts to those of `component`, after the operation counts of the same export,
  // in the same transaction: an operation they counted as one of `(other operations)`, past each
  // component's limit, is counted as that here too, so names stay as bounded as there.
  // Not handled: a service that names thousands of features; each is a few rows a day. Bounding
  // them takes a limit on features per component, as operations have.
  const add = Effect.fn("FeatureCounts.add")(function* (
    component: ComponentKey,
    counts: ReadonlyArray<FeatureOperationCounts>,
  ) {
    if (counts.length === 0) {
      return
    }
    const known = new Set((yield* findOperations(component)).map((row) => row.name))
    for (const each of counts) {
      yield* sql`
        INSERT INTO signals_feature_days ${sql.insert({
          day: each.day,
          feature: each.feature,
          component,
          operation: known.has(each.operation) ? each.operation : otherOperations,
          environment: each.environment ?? "",
          count: each.count,
          errors: each.errors,
        })}
        ON CONFLICT (feature, day, component, operation, environment) DO UPDATE SET
          count = count + excluded.count, errors = errors + excluded.errors`
    }
  })

  const cleanUp = Effect.fn("FeatureCounts.cleanUp")(function* (now: number) {
    yield* sql`DELETE FROM signals_feature_days WHERE day < ${dayNumberOf(now - Duration.toMillis(hourlyRetention))}`
  })

  // Every day kept of the feature, by component and operation, the oldest first; environments added up.
  const days = Effect.fn("FeatureCounts.days")(function* (query: FeatureQuery, now: number) {
    const rows = yield* SqlSchema.findAll({
      Request: Schema.Void,
      Result: DayRow,
      execute: () => sql`
        SELECT day, component, operation, sum(count) AS count, sum(errors) AS errors
        FROM signals_feature_days
        WHERE ${sql.and([
          sql`feature = ${query.feature}`,
          sql`day >= ${dayNumberOf(now - Duration.toMillis(hourlyRetention))}`,
          ...(query.environment === undefined ? [] : [sql`environment = ${query.environment}`]),
        ])}
        GROUP BY day, component, operation
        ORDER BY day, component, operation`,
    })(undefined).pipe(Effect.orDie)
    return rows.map((row): FeatureOperationDay => ({
      day: calendarDayOfNumber(row.day),
      component: row.component,
      operation: row.operation,
      count: row.count,
      errors: row.errors,
    }))
  })

  return { add, cleanUp, days }
})
