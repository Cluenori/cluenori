import { assert, describe, it } from "@effect/vitest"
import { Cause, DateTime, Effect, Exit, Schema } from "effect"
import { SqlClient, SqlError } from "effect/sql"

import type { Actor } from "../src/index.ts"
import {
  ActivityLog,
  ComponentKey,
  Envelope,
  FeatureKey,
  MemberId,
  ProjectKey,
  Source,
  WorkspaceKey,
} from "../src/index.ts"
import { inObject } from "./in-object.ts"

const workspace = WorkspaceKey.make("main")
const inNotes = { workspace, project: ProjectKey.make("notes") }
const member: Actor = { _tag: "Member", id: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53") }
const source = Source.make("module:notes")
const editorExport = FeatureKey.make("editor.export")

// A module of the tests' own: notes, with one table and one activity.
const NoteAdded = Schema.TaggedStruct("note.added", { note: Schema.String, title: Schema.String })

class NoteTitleEmpty extends Schema.TaggedError<NoteTitleEmpty>()("NoteTitleEmpty", { note: Schema.String }) {}

const createNotes = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, title TEXT NOT NULL)`.pipe(Effect.orDie)
})

const countNotes = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ readonly count: number }>`SELECT count(*) AS count FROM notes`.pipe(Effect.orDie)
  return rows[0]?.count
})

// Writes the note before it checks the title, so a failure has a write to undo.
const writeNote = Effect.fn("writeNote")(function* (sql: SqlClient.SqlClient, note: string, title: string) {
  yield* sql`INSERT INTO notes ${sql.insert({ id: note, title })}`.pipe(Effect.orDie)
  if (title === "") {
    return yield* new NoteTitleEmpty({ note })
  }
  return note
})

const addNote = Effect.fn("addNote")(function* (note: string, title: string) {
  const sql = yield* SqlClient.SqlClient
  const log = yield* ActivityLog
  return yield* log.commit({
    source,
    actor: member,
    write: writeNote(sql, note, title),
    activity: (added) => [{ payload: NoteAdded.make({ note: added, title }), feature: editorExport }],
  })
})

describe("ActivityLog", () => {
  it.effect("commits a write together with its activity", () =>
    inObject(
      "commits-together",
      inNotes,
      Effect.gen(function* () {
        yield* createNotes
        const before = yield* DateTime.now
        const added = yield* addNote("n1", "Groceries")
        const log = yield* ActivityLog
        const [entry, ...rest] = yield* log.latest
        const notes = yield* countNotes

        assert.strictEqual(added, "n1")
        assert.strictEqual(notes, 1)
        assert.isDefined(entry)
        assert.isEmpty(rest)
        const stored = yield* Schema.encodeEffect(Envelope)(entry)
        assert.deepInclude(stored, {
          kind: "activity",
          name: "note.added",
          workspace: "main",
          project: "notes",
          feature: "editor.export",
          actor: member,
          source: "module:notes",
          attrs: { note: "n1", title: "Groceries" },
        })
        assert.isTrue(DateTime.isGreaterThanOrEqualTo(entry.ts, before))
      }),
    ),
  )

  it.effect("stores nothing when the write fails after writing, and returns the write's error", () =>
    inObject(
      "write-fails",
      inNotes,
      Effect.gen(function* () {
        yield* createNotes
        const failure = yield* addNote("n1", "").pipe(Effect.flip)
        const log = yield* ActivityLog
        const activity = yield* log.latest
        const notes = yield* countNotes

        assert.deepStrictEqual(failure, new NoteTitleEmpty({ note: "n1" }))
        assert.strictEqual(notes, 0)
        assert.isEmpty(activity)
      }),
    ),
  )

  it.effect("stores nothing when an entry's name isn't an activity name, and dies", () =>
    inObject(
      "invalid-name",
      inNotes,
      Effect.gen(function* () {
        yield* createNotes
        const sql = yield* SqlClient.SqlClient
        const log = yield* ActivityLog
        const NoteAddedWrongly = Schema.TaggedStruct("Note.Added", { note: Schema.String })
        const exit = yield* log
          .commit({
            source,
            actor: member,
            write: writeNote(sql, "n1", "Groceries"),
            activity: (note) => [{ payload: NoteAddedWrongly.make({ note }) }],
          })
          .pipe(Effect.exit)
        const activity = yield* log.latest
        const notes = yield* countNotes

        assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause))
        assert.strictEqual(notes, 0)
        assert.isEmpty(activity)
      }),
    ),
  )

  it.effect("rolls back a database failure as a defect, not a recoverable write error", () =>
    inObject(
      "sql-fails",
      inNotes,
      Effect.gen(function* () {
        yield* createNotes
        const sql = yield* SqlClient.SqlClient
        const log = yield* ActivityLog
        const exit = yield* log
          .commit({
            source,
            actor: member,
            write: sql`INSERT INTO notes (id, title) VALUES ('n1', 'First')`.pipe(
              Effect.andThen(sql`INSERT INTO notes (id, title) VALUES ('n1', 'Duplicate')`),
            ),
            activity: () => [{ payload: NoteAdded.make({ note: "n1", title: "First" }) }],
          })
          .pipe(Effect.exit)
        const notes = yield* countNotes
        const activity = yield* log.latest
        assert.isTrue(
          Exit.isFailure(exit) && Cause.hasDies(exit.cause) && SqlError.isSqlError(Cause.squash(exit.cause)),
        )
        assert.strictEqual(notes, 0)
        assert.isEmpty(activity)
      }),
    ),
  )

  it.effect("records a commit's entries in order with one time, and lists the newest first", () =>
    inObject(
      "order",
      inNotes,
      Effect.gen(function* () {
        yield* createNotes
        const sql = yield* SqlClient.SqlClient
        const log = yield* ActivityLog
        const ios = ComponentKey.make("notes-ios")
        yield* log.commit({
          source,
          actor: member,
          write: writeNote(sql, "n1", "First"),
          activity: (note) => [
            { payload: NoteAdded.make({ note, title: "First" }) },
            { payload: NoteAdded.make({ note, title: "First, again" }), component: ios },
          ],
        })
        yield* addNote("n2", "Second")
        const [second, firstAgain, first] = yield* log.latest

        assert.deepStrictEqual(
          [second?.attrs, firstAgain?.attrs, first?.attrs],
          [
            { note: "n2", title: "Second" },
            { note: "n1", title: "First, again" },
            { note: "n1", title: "First" },
          ],
        )
        assert.strictEqual(firstAgain?.component, ios)
        assert.isTrue(first !== undefined && firstAgain !== undefined && DateTime.Equivalence(first.ts, firstAgain.ts))
        assert.notStrictEqual(first?.id, firstAgain?.id)
      }),
    ),
  )

  it.effect("leaves the project out of the workspace's own activity", () =>
    inObject(
      "workspace",
      { workspace },
      Effect.gen(function* () {
        yield* createNotes
        yield* addNote("n1", "Portfolio review")
        const log = yield* ActivityLog
        const [entry] = yield* log.latest

        assert.strictEqual(entry?.workspace, "main")
        assert.notProperty(entry, "project")
      }),
    ),
  )

  it.effect("keeps its activity when the object starts again", () =>
    Effect.gen(function* () {
      yield* inObject(
        "restarts",
        inNotes,
        Effect.gen(function* () {
          yield* createNotes
          yield* addNote("n1", "Before the restart")
        }),
      )
      const activity = yield* inObject(
        "restarts",
        inNotes,
        Effect.gen(function* () {
          const log = yield* ActivityLog
          return yield* log.latest
        }),
      )

      assert.deepStrictEqual(
        activity.map((entry) => entry.attrs),
        [{ note: "n1", title: "Before the restart" }],
      )
    }),
  )
})

describe("ActivityLog.deliver", () => {
  it.effect("leaves activity committed while sending a partial batch for the next delivery", () =>
    inObject(
      "delivery-during-write",
      inNotes,
      Effect.gen(function* () {
        yield* createNotes
        const log = yield* ActivityLog
        const sql = yield* SqlClient.SqlClient
        yield* addNote("first", "Before delivery")
        const sent: Array<unknown> = []
        const delivered = yield* log.deliver((batch) =>
          Effect.gen(function* () {
            sent.push(...batch.map((entry) => entry.attrs["note"]))
            yield* log.commit({
              source,
              actor: member,
              write: writeNote(sql, "later", "During delivery"),
              activity: (note) => [{ payload: NoteAdded.make({ note, title: "During delivery" }) }],
            })
          }),
        )
        assert.strictEqual(delivered, 1)
        assert.deepStrictEqual(sent, ["first"])
        const next = yield* log.deliver((batch) =>
          Effect.sync(() => {
            sent.push(...batch.map((entry) => entry.attrs["note"]))
          }),
        )
        assert.strictEqual(next, 1)
        assert.deepStrictEqual(sent, ["first", "later"])
      }),
    ),
  )

  it.effect("delivers at most ten batches of 100, preserving the remainder for the next call", () =>
    inObject(
      "delivery-limits",
      inNotes,
      Effect.gen(function* () {
        const log = yield* ActivityLog
        yield* log.commit({
          source,
          actor: member,
          write: Effect.void,
          activity: () => [
            { payload: NoteAdded.make({ note: "0", title: "First" }) },
            ...Array.from({ length: 1100 }, (_, index) => ({
              payload: NoteAdded.make({ note: String(index + 1), title: "Another" }),
            })),
          ],
        })
        const batches: Array<ReadonlyArray<unknown>> = []
        const send = (batch: ReadonlyArray<Envelope>) =>
          Effect.sync(() => {
            batches.push(batch.map((envelope) => envelope.attrs["note"]))
          })
        const first = yield* log.deliver(send)
        assert.strictEqual(first, 1000)
        assert.deepStrictEqual(
          batches.map((batch) => batch.length),
          Array.from({ length: 10 }, () => 100),
        )
        const next = yield* log.deliver(send)
        assert.strictEqual(next, 101)
        assert.deepStrictEqual(
          batches.map((batch) => batch.length),
          [...Array.from({ length: 11 }, () => 100), 1],
        )
        assert.deepStrictEqual(
          batches.flat(),
          Array.from({ length: 1101 }, (_, index) => String(index)),
        )
        const empty = yield* log.deliver(send)
        assert.strictEqual(empty, 0)
        assert.strictEqual(batches.length, 12)
        const latest = yield* log.latest
        assert.deepStrictEqual(
          latest.map((entry) => entry.attrs["note"]),
          Array.from({ length: 100 }, (_, index) => String(1100 - index)),
        )
      }),
    ),
  )

  it.effect("sends what was committed since, oldest first, once, and only what came after delivery began", () =>
    inObject(
      "delivers",
      inNotes,
      Effect.gen(function* () {
        yield* createNotes
        const log = yield* ActivityLog
        const batches: Array<ReadonlyArray<unknown>> = []
        const send = (batch: ReadonlyArray<Envelope>) =>
          Effect.sync(() => {
            batches.push(batch.map((envelope) => envelope.attrs["note"]))
          })

        yield* addNote("delivered-1", "First")
        yield* addNote("delivered-2", "Second")
        assert.strictEqual(yield* log.deliver(send), 2)
        assert.strictEqual(yield* log.deliver(send), 0)
        yield* addNote("delivered-3", "Third")
        assert.strictEqual(yield* log.deliver(send), 1)
        assert.deepStrictEqual(batches, [["delivered-1", "delivered-2"], ["delivered-3"]])
      }),
    ),
  )

  it.effect("sends a batch again when sending it failed, and marks nothing it didn't send", () =>
    inObject(
      "redelivers",
      inNotes,
      Effect.gen(function* () {
        yield* createNotes
        const log = yield* ActivityLog
        yield* log.deliver(() => Effect.void)
        yield* addNote("retried-1", "First")
        const failed = yield* log.deliver(() => Effect.fail("queue down")).pipe(Effect.flip)
        assert.strictEqual(failed, "queue down")
        const sent: Array<unknown> = []
        yield* log.deliver((batch) =>
          Effect.sync(() => {
            sent.push(...batch.map((envelope) => envelope.attrs["note"]))
          }),
        )
        assert.deepStrictEqual(sent, ["retried-1"])
      }),
    ),
  )
})
