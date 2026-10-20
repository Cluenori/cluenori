# @cluenori/projects

Projects and their components, with the ingest keys that components send telemetry with. Each
project lives in a Durable Object of its own, where `Projects` runs; the workspace's own object lists
them, in `ProjectIndex`.

## Use it

```ts
const projects = yield* Projects

const project = yield* projects.create(actor, ProjectName.make("Folio"))
const { component, ingestKey } = yield* projects.addComponent(actor, {
  key: ComponentKey.make("folio-api"),
  name: ComponentName.make("Folio API"),
})
// ingestKey: Redacted "cluenori.folio.folio-api.<43 characters>", returned only here, once.

// Where telemetry arrives: which component sent it?
const sender = yield* projects.authenticate(presentedKey) // ComponentKey "folio-api"

// In the workspace's object: the index of the workspace's projects.
const index = yield* ProjectIndex
yield* index.record(project) // again for the same key changes nothing but its name
const all = yield* index.all // every project, by key
```

A second component with the same key fails with `ComponentExists`, and stores nothing. A key that
isn't one of the project's components', whatever is wrong with it, fails with `IngestKeyRejected`.

## Owns

- **Data:** the project of its Durable Object (`projects_project`, one row), and its components
  with the SHA-256 digest of each ingest key (`projects_components`). The key itself is kept
  nowhere. In the workspace's object, the index of its projects (`projects_index`): their keys,
  names, and when they were created. Each project's object is what it is; the index only lists it,
  so it emits no activity of its own.
- **Rules:** what project and component names may be, and the form of an ingest key,
  `cluenori.<project>.<component>.<secret>`.

## Does not own

- **Which object holds which project:** the host names each object `<workspace>/<project>`, and the
  workspace's own `<workspace>`.
- **Keeping the index whole:** the host records each project it creates. Its two objects share no
  transaction, so the host also records a project it finds existing (apps/worker, "Decisions").
- **Changing names, removing components, or new keys for a component:** not built yet.

## Contract

`src/index.ts`. The host builds `Projects` in each project's object and `ProjectIndex` in the
workspace's; the API's `ProjectsGroup` defines listing projects, showing one with its components,
creating projects, and adding components; `IngestKey` and `ingestKeyScope` let the Worker
route a key to its project before the project checks it.

## Depends on

`@cluenori/foundation`, for the scope keys and `ActivityLog`, through which every write commits.

## Activity

Emits `project.created` when the project is created, and `component.added`, with the component's
key, when a component is added. Reacts to nothing.

## Settings

`Projects.layer({ project })`: the key of the object's project.

## Decisions and constraints

- **The key is made, and hashed, before the write's transaction,** which holds only SQL.
- **Keys are compared as digests,** so the comparison reveals nothing about a key
  (PATTERNS.md, "Credentials").
