import { Context, Crypto, DateTime, Effect, Layer, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

import type { ActivityEntry } from "./activity.ts"
import { ActivityName } from "./activity.ts"
import type { Actor } from "./actor.ts"
import type { Source } from "./envelope.ts"
import { Envelope, EnvelopeName } from "./envelope.ts"
import { migrateFoundation } from "./foundation-migrations.ts"
import { EnvelopeId } from "./ids.ts"
import type { ProjectKey, WorkspaceKey } from "./scope-keys.ts"

/** Whose database the log is in: a project's, or the workspace's own when `project` is absent. */
export interface ActivityLogSettings {
  readonly workspace: WorkspaceKey
  readonly project?: ProjectKey
}

/** A write to records, and the activity it emits. */
export interface Change<A, E> {
  /** The package that owns the records: `module:releases`. */
  readonly source: Source
  readonly actor: Actor
  /**
   * The write: SQL on this database's `SqlClient`, and nothing else. It runs inside the transaction,
   * which blocks every other request to the object until it ends, so it never waits for the network.
   * Failing with `E` stores nothing.
   */
  readonly write: Effect.Effect<A, E>
  /** What the write did, from its result: at least one entry. */
  readonly activity: (result: A) => readonly [ActivityEntry, ...Array<ActivityEntry>]
}

const latestCount = 100

/**
 * The activity of one database, and the only way to change its records: every write commits
 * together with the activity it emits. Runs inside the Durable Object that holds the database.
 */
export class ActivityLog extends Context.Service<
  ActivityLog,
  {
    /**
     * Runs `change.write` and records its activity in one transaction: both are stored, or neither
     * is. Each entry gets a new ID, the commit's time, its actor and source, and this database's
     * workspace and project. Returns the write's result.
     *
     * Fails with the write's own error, having stored nothing. A database failure, or an entry whose
     * name isn't an `ActivityName`, is a defect, and also stores nothing.
     */
    readonly commit: <A, E>(change: Change<A, E>) => Effect.Effect<A, E>
    /** The 100 most recent activity entries, newest first; entries of one commit in reverse order. */
    readonly latest: Effect.Effect<ReadonlyArray<Envelope>>
  }
>()("@cluenori/foundation/activity-log/ActivityLog") {
  /**
   * Builds the log on the object's `SqlClient`, first creating or updating Foundation's tables. Build
   * it once per object, before the object serves a request.
   */
  static readonly layer = (settings: ActivityLogSettings) =>
    Layer.effect(
      ActivityLog,
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const crypto = yield* Crypto.Crypto
        yield* migrateFoundation.pipe(Effect.orDie)

        const encodeEnvelope = Schema.encodeEffect(Schema.fromJsonString(Envelope))
        const projectField = settings.project === undefined ? {} : { project: settings.project }

        const record = Effect.fn("ActivityLog.record")(function* (
          source: Source,
          actor: Actor,
          entries: ReadonlyArray<ActivityEntry>,
        ) {
          const ts = yield* DateTime.now
          for (const { payload, ...scope } of entries) {
            const { _tag, ...attrs } = payload
            const name = yield* Schema.decodeEffect(ActivityName)(_tag).pipe(Effect.orDie)
            const uuid = yield* crypto.randomUUIDv7().pipe(Effect.orDie)
            const envelope = new Envelope({
              id: EnvelopeId.make(uuid),
              ts,
              kind: "activity",
              name: EnvelopeName.make(name),
              workspace: settings.workspace,
              ...projectField,
              ...scope,
              actor,
              source,
              attrs,
            })
            const json = yield* encodeEnvelope(envelope).pipe(Effect.orDie)
            yield* sql`INSERT INTO activity ${sql.insert({ id: envelope.id, name, ts: DateTime.formatIso(ts), envelope: json })}`
          }
        })

        const commit = Effect.fn("ActivityLog.commit")(function* <A, E>(change: Change<A, E>): Effect.fn.Return<A, E> {
          return yield* sql
            .withTransaction(
              change.write.pipe(Effect.tap((result) => record(change.source, change.actor, change.activity(result)))),
            )
            .pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))
        })

        const findLatest = SqlSchema.findAll({
          Request: Schema.Void,
          Result: Schema.Struct({ envelope: Schema.fromJsonString(Envelope) }),
          execute: () => sql`SELECT envelope FROM activity ORDER BY seq DESC LIMIT ${latestCount}`,
        })

        const latest = findLatest(undefined).pipe(
          Effect.orDie,
          Effect.map((rows) => rows.map((row) => row.envelope)),
          Effect.withSpan("ActivityLog.latest"),
        )

        return ActivityLog.of({ commit, latest })
      }),
    )
}
