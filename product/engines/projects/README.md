# @cluenori/projects

Projects and their components, with the ingest keys that components send telemetry with and the
SDK keys their apps' builds carry. Each project lives in a Durable Object of its own, where
`Projects` runs; the workspace's own object lists them, in `ProjectIndex`.

## Use it

```ts
const projects = yield* Projects

const project = yield* projects.create(actor, ProjectName.make("Folio"))
const { component, ingestKey } = yield* projects.addComponent(actor, {
  key: ComponentKey.make("folio-api"),
  name: ComponentName.make("Folio API"),
})
// ingestKey: Redacted "cluenori.folio.folio-api.<43 characters>", returned only here, once.

// Where telemetry arrives: which component sent it? Any of its working keys says.
const sender = yield* projects.authenticate(presentedKey) // ComponentKey "folio-api"

// Ingest keys: several work at once, so one replaces another without a gap.
const added = yield* projects.addIngestKey(actor, ComponentKey.make("folio-api"), {
  name: IngestKeyName.make("blue"),
  expiresAt: DateTime.makeUnsafe("2027-01-31T00:00:00Z"), // optional
}) // added.ingestKey: shown only here, once; added.key: its IngestKeyInfo
const { keys: ingestKeys } = yield* projects.ingestKeys(ComponentKey.make("folio-api")) // names, never keys
yield* projects.revokeIngestKey(actor, ComponentKey.make("folio-api"), old.id, inADay) // or undefined: now
yield* projects.checkIngestKeys // the alarm's: warns 7 days and 1 day before a key expires

// SDK keys: public keys an app's builds carry, several active at once, so they rotate.
const issued = yield* projects.issueSdkKey(actor, ComponentKey.make("folio-ios"))
// issued.key: "cluenori-sdk.folio.folio-ios.<22 characters>", listed again by sdkKeys.
const { keys } = yield* projects.sdkKeys(ComponentKey.make("folio-ios")) // newest first, revoked too
yield* projects.revokeSdkKey(actor, ComponentKey.make("folio-ios"), oldKey) // its builds are refused
const app = yield* projects.authenticateSdkKey(presentedSdkKey) // ComponentKey "folio-ios"

// In the workspace's object: the index of the workspace's projects.
const index = yield* ProjectIndex
yield* index.record(project) // again for the same key changes nothing but its name
const all = yield* index.all // every project, by key
```

A second component with the same key fails with `ComponentExists`, and stores nothing. A key that
isn't one of the project's components', whatever is wrong with it, fails with `IngestKeyRejected`.
An SDK key that is unknown, revoked, or another project's fails `authenticateSdkKey` alike, with
`SdkKeyNotFound`; revoking a key revoked before returns it unchanged, with no new activity. An
ingest key that expired or was revoked fails `authenticate` as an unknown one does. A component has
at most 10 ingest keys that work and 20 active SDK keys: one more is refused (`IngestKeyRefused`
`tooMany`, `TooManySdkKeys`) until one is revoked.

### Changing an ingest key without a gap

1. Add a key: `./cluenori component ingest-keys <project> <component> --new <name>`, or the web's
   Tech page, under Ingest keys. It is shown once.
2. Deploy it, blue-green or not: the old key keeps working meanwhile.
3. Watch the old key's last use: it moves at most once an hour, so once it hasn't moved for about
   two hours, nothing sends with it.
4. Revoke it: `--revoke <id>`, or `--revoke <id> --in 24h` to leave room for a deploy still
   rolling out.

A key with an expiry warns the owners twice, 7 days and 1 day before it expires: on their phones,
on Today, and as a badge on the key. A key revoked before it would expire never warns.

## Owns

- **Data:** the project of its Durable Object and its settings, the environments it calls
  production (`projects_project`, one row), and its components
  and their links: a GitHub repository, where their
  releases come from beside telemetry, a deploy target for each environment, a workflow and
  an App Store Connect app, where they go, and the component each ships with, whose deploys deploy
  it too (`projects_components`); it must be another of the project's. Each component's ingest
  keys (`projects_ingest_keys`): an ID, a name, the SHA-256 digest of the key, when it was added,
  last used (the start of the UTC hour), expires and is revoked, and the nearest warning sent; a key
  that ended 30 days ago is forgotten. The key itself is kept nowhere. Each component's SDK keys, as they are, with when each was issued and revoked
  (`projects_sdk_keys`). In the workspace's object, the index of its projects (`projects_index`): their keys,
  names, and when they were created. Each project's object is what it is; the index only lists it,
  so it emits no activity of its own.
- **Rules:** which environments are production: those the project chose, `prod`, `production` and
  `live` until it does, and an unknown one always (`isProduction`); what project and component names may be, and the form of an ingest key,
  `cluenori.<project>.<component>.<secret>`, and of an SDK key, `cluenori-sdk.<project>.<component>.<id>`;
  which SDK keys are active; which ingest keys work, when each is warned of, and the bounds on
  both.

## Does not own

- **Which object holds which project:** the host names each object `<workspace>/<project>`, and the
  workspace's own `<workspace>`.
- **Keeping the index whole:** the host records each project it creates. Its two objects share no
  transaction, so the host also records a project it finds existing (apps/worker, "Decisions").
- **What an SDK key lets an app do:** the Worker routes it by the project it names and asks
  `authenticateSdkKey`; the routes it opens (sending signals, reading the manifest) are the Worker's
  and the engines' behind them.
- **Who may manage keys:** the Worker lets only owners list, add and revoke ingest keys.
- **Telling anyone a key expires:** Notifications and Today react to `ingest_key.expiring`.
- **Changing names or removing components:** not built yet.

## Contract

`src/index.ts`. The host builds `Projects` in each project's object and `ProjectIndex` in the
workspace's; the API's `ProjectsGroup` defines listing projects, showing one with its components,
creating projects, adding components, linking them to their repository and deploy targets, and
adding, listing and revoking their ingest keys, and issuing, listing and revoking their SDK keys; `IngestKey` and `ingestKeyScope`, and `SdkKey` and
`sdkKeyScope`, let the Worker route a key to its project before the project checks it.

## Depends on

`@cluenori/foundation`, for the scope keys and `ActivityLog`, through which every write commits;
`@cluenori/github`, for what a repository's and a workflow file's names may be.

## Activity

Emits `project.created` when the project is created, `component.added`, with the component's key,
when a component is added, `component.linked`, with its links, when they change,
`project.settings_changed` when its settings do, and `sdk_key.issued` and `sdk_key.revoked`, with
the component and the key, when an SDK key is issued or revoked; `ingest_key.added` and
`ingest_key.revoked`, with the component, the key's ID and name (and when a revocation takes
effect), and `ingest_key.expiring`, with when it expires, 7 days and 1 day before it does. Reacts to
nothing.

## Settings

`Projects.layer({ project })`: the key of the object's project.

## Decisions and constraints

- **The key is made, and hashed, before the write's transaction,** which holds only SQL.
- **Keys are compared as digests,** so the comparison reveals nothing about a key
  (PATTERNS.md, "Credentials").
- **SDK keys are kept as they are, not as digests,** unlike ingest keys: an SDK key is public, as it
  ships inside every build, and the founder must be able to list it again to put it in a new build.
  Its ID is 16 random bytes, so it is unguessable and still looked up by exact match.
- **Several ingest keys work at once** (the founder, 2026-10-27), so a service deployed blue-green
  moves to a new key with no gap in what it sends. An owner can always add one, so a lost key never
  loses a component. Revoking may be scheduled, and only moves earlier.
- **Last use is kept to the hour,** so authenticating writes at most once an hour per key, not once
  per export.
- **SDK keys keep their own model:** public, listed whole, no names or expiry. An app's key ships in
  builds that live for years, so an expiry would cut off old builds; the bound of 20 active keys is
  what they share with ingest keys.
- **Several SDK keys are active at once,** so a new build can carry a new key while older builds
  keep working, until the old key is revoked. Revoking is permanent; a revoked key stays listed.
