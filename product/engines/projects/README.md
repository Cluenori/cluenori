# @cluenori/projects

Projects and their components, with the ingest keys that components send telemetry with. Each
project lives in a Durable Object of its own, where `Projects` runs.

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
```

A second component with the same key fails with `ComponentExists`, and stores nothing. A key that
isn't one of the project's components', whatever is wrong with it, fails with `IngestKeyRejected`.

## Owns

- **Data:** the project of its Durable Object (`projects_project`, one row), and its components
  with the SHA-256 digest of each ingest key (`projects_components`). The key itself is kept
  nowhere.
- **Rules:** what project and component names may be, and the form of an ingest key,
  `cluenori.<project>.<component>.<secret>`.

## Does not own

- **Which object holds which project:** the host names each object `<workspace>/<project>`.
- **A list of all projects:** it comes with the workspace's own object.
- **Changing names, removing components, or new keys for a component:** not built yet.

## Contract

`src/index.ts`. The host builds `Projects` in each project's object; the API's `ProjectsGroup`
defines creating projects and adding components; `IngestKey` and `ingestKeyScope` let the Worker
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
