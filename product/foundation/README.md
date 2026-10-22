# @cluenori/foundation

The product model every engine and module shares: the scope keys that place every record, the
envelope that every signal and activity entry uses, who acts, and the one way to change records,
which commits each write together with its activity.

## Use it

A module changes its records only through `ActivityLog.commit`, inside the project's Durable Object:

```ts
import { ActivityLog, Source } from "@cluenori/foundation"

/** A release went live in its store. Exported from the module's contract. */
export const ReleasePublished = Schema.TaggedStruct("release.published", { release: ReleaseId })

const source = Source.make("module:releases")

// In the module's layer: `sql` and `log` are yielded once, when the layer is built.
const publish = Effect.fn("Releases.publish")(function* (actor: Actor, release: Release) {
  return yield* log.commit({
    source,
    actor,
    write: markPublished(release.id), // SQL on the project's SqlClient
    activity: () => [
      {
        payload: ReleasePublished.make({ release: release.id }),
        component: release.component,
        release: release.version,
      },
    ],
  })
})
```

The write and its activity are stored together, or not at all. If `markPublished` fails with
`ReleaseNotReady`, `publish` fails with `ReleaseNotReady` and nothing is stored, including any row
the write had already changed. `log.latest` reads the most recent activity back as `Envelope`s.

Values from outside become typed once, at the trust boundary:

```ts
const envelope = yield* Schema.decodeUnknownEffect(Envelope)(body)
// kind "metric" fails at ["kind"]: one of the kinds Foundation lists, or a module's, such as uptime.check
```

## Owns

- **Rules:** the format of every scope key, ID and name: project, component, environment and
  workspace keys; feature keys; release versions; trace IDs; envelope kinds, names and sources;
  activity names; and calendar days, UTC days as `YYYY-MM-DD`, which what is counted by day is
  counted in, and stored as days since 1970-01-01 (`CalendarDay`). Keys are permanent: shipped app builds contain them.
- **Data:** the `activity` table in each project's database and the workspace's, with its own
  migrations (`foundation_migrations`).
- **Rules about writes:** a write and its activity commit in one transaction; every entry gets its
  ID, time, actor, source, workspace and project from the log, never from the caller.
- **The module contract** (`defineModule`, `moduleQuery`, `moduleIngest`): a module's ID, scope,
  queries and their routes; its own services (its records and clients), built from settings the
  host reads; its background work on the project's alarm; and its ingest writes, which components'
  own tooling sends with their ingest key. Inputs, answers and tagged errors are plain Schemas,
  since the host serves them in the project's Durable Object; its sidebar entry, actions and the
  rest of `concept/Foundation.md`'s contract come with the first module that needs each.

## Does not own

- **Building the project's object.** The host makes the Durable Object, its `SqlClient` and its
  `Crypto`, and builds `ActivityLog.layer` once per object (`apps/worker`).
- **The queue.** `deliver` hands what is undelivered to the sender the host gives it; the project's
  object sends it to the activity queue on its alarm (`apps/worker`).
- **Who people are.** Person, installation and account IDs are assigned, and linked to the app's
  own IDs, by the engine that owns people, with the first signal that carries them.
- **Signals.** Ingest writes them in the envelope's shape; Foundation only defines that shape.

## Contract

`src/index.ts`. Callers use its Schemas to decode and type every key and envelope, and the
`ActivityLog` service to change records. Every exported Schema documents its rule.

## Depends on

`effect`, including `effect/sql` for the transaction and the migrations. The tests run in workerd
on a Durable Object's SQLite (`@effect/sql-sqlite-do`), with `@bagatka/web-crypto` for `Crypto`.

## Activity

Emits nothing of its own. Every activity entry any package emits is stored by `ActivityLog.commit`.

## Settings

`ActivityLog.layer({ workspace, project })`: whose database the log is in. The workspace's own
object leaves `project` out.

## Decisions and constraints

- **Every ID is a lowercase UUIDv7,** so IDs sort by time and compare as text. Person, installation
  and account IDs are pseudonyms Cluenori assigns, never the app's own IDs, so deleting the link to a
  person leaves their signals pointing to no one.
- **The origin is two fields, `originComponent` and `originRelease`,** not one `notes-ios@2.4.0`
  string, so the lake can filter on each without parsing.
- **An activity entry carries its actor in the envelope,** a field that signals never have.
- **Activity payloads are JSON values** (keys, IDs, text, numbers, booleans, times as ISO 8601
  text), so the log stores and delivers them as they are, and the type checker refuses anything
  else.
- **The write runs inside the Durable Object's transaction,** which blocks the object's other
  requests until it ends, so a write never waits for the network.
- **Each package tracks its migrations in its own table,** so their numbers never collide in the
  one database of a project. The log's migrations run when its layer is built, before the object
  serves a request.
- **Envelope fields are only added, and only as optional fields.** Stored rows and shipped SDK builds
  keep this shape for years.
