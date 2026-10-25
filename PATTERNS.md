# Patterns

One problem, one solution. This file lists the established way to solve each recurring problem.

- **Follow an entry.** Before solving a problem listed here, follow its entry and the shape of its
  example.
- **Add a missing entry.** If a recurring problem isn't listed, choose a solution deliberately,
  implement it once, and add an entry in the same change.
- **Change an entry, don't fork it.** If an entry is wrong for a case, propose changing it, with a
  migration path for existing code. Never add a second way "just here."
- **Real code beats snippets.** Where an entry names a canonical example, that file is the
  specification. Elsewhere the snippet is, until the first real implementation exists; then add its
  path here and shorten the entry.

Most entries are still snippets, because the code that will be their example isn't written yet;
entries with real code name its file. The snippets were type-checked and tested against `effect`
4.0.5 with TypeScript 7.0.2 and `@effect/tsgo`, with the compiler settings of entry 20. Examples use a small feature catalog: a feature has a dotted key such as `editor.export`
(`concept/Foundation.md`, "Features").

---

## 1. Explicit over implicit

Code says what it does where it does it. A contributor who doesn't know TypeScript's or Effect's
conventions should be able to read any file and see every dependency, conversion, and default.

- **Named exports only.** No `export default`, except where the platform requires one: the Worker's
  entry (entry 16). Every import names what it takes.
- **Imports name their source.** Effect's modules come from the barrel or a subpath:
  `import { Effect, Schema } from "effect"`, `import { HttpApi } from "effect/http-api"`. Relative
  imports name the file with its extension: `import { FeatureKey } from "./feature-key.ts"`.
- **No re-export chains.** A package's `src/index.ts` exports its contract (entry 3); no other file
  re-exports another file.
- **Visible registration.** Every layer, route group, module, queue consumer, cron, and Durable
  Object class is a visible line in the host. Nothing is discovered by scanning, globbing, or
  decorators.
- **No escape hatches from the type system.**
  - No `any`, no `as` casts (except `as const`), no non-null `!`.
  - `unknown` appears only at a trust boundary, and is decoded with a Schema on the next line
    (entry 7).
  - No `@ts-expect-error`, `@ts-ignore`, or lint-disable comments (entry 20).
- **One step per statement.** A statement yields, calls, writes, or decides; not several at once.
  - A `yield*` is its statement's whole right-hand side: `const x = yield* a`, `yield* a`, or
    `return yield* a`. Never inside an argument, a condition, a template, or another expression:
    yield into a constant, then use it. A pipe on the yielded effect is still one step:
    `yield* a.pipe(Effect.orDie)`.
  - Conditions only read values computed before them.
  - Name conditions that don't read as a sentence on their own:
    `const keyTaken = existing._tag === "Some"`. Conditions like `found._tag === "None"` stay inline.
- **Constants over `let`.** Use `const`. A `let` needs a reason a reader can see, such as a loop
  accumulator in a hot path.
- **No classes of our own,** except the class forms Effect defines: `Context.Service`,
  `Schema.Class`, `Schema.TaggedError`, and `Schema.Opaque`. No inheritance, no `this` outside them.
- **Never rely on `toString()`** or template interpolation of a value that isn't a string or a
  number. Convert with a named function: `DateTime.formatIso(createdAt)`.

## 2. Same behavior on every machine

Developers and agents work under different locales and time zones, and Workers run in UTC. The code
must build, test, and run identically everywhere.

- **Machine-readable text is locale-free.** JSON, logs, storage, cache keys, URLs, and anything code
  parses back use ISO 8601 for time and JSON numbers for numbers. Schemas encode and decode them;
  never format or parse them by hand.
- **Human-readable text takes an explicit locale and time zone.** Emails, push messages, and pages
  format with `Intl` given the recipient's locale (a BCP 47 tag such as `de-DE`) and IANA time zone
  (such as `Europe/Warsaw`), both stored with the person. Never call `toLocaleString`,
  `toLocaleDateString`, or `localeCompare` without a locale.
- **Comparisons are explicit.** Sorting human text uses `Intl.Collator` with the recipient's locale;
  sorting machine text uses plain code-point order.
- **Terminal output** is read by people and agents alike, so the CLI writes numbers the en-US way and
  times in UTC, never the machine's: `apps/cli/src/terminal-text.ts`.
- **Files.** UTF-8 without a byte order mark, LF line endings (`.gitattributes`), and lowercase
  kebab-case file names, so casing never differs between macOS and Linux.
- **Tests outside workerd run with `TZ=Pacific/Chatham` and `LANG=tr_TR.UTF-8`,** a time zone with a
  45-minute offset and a locale with comma decimals and a dotless `ı`, so code that depends on the
  machine fails on every machine.
- **Toolchain.** `./dev` provides the pinned Bun and Node, so a host install never leaks in.

## 3. Packages

Every package has the same shape, so people and agents know where to look before they open it.

```
packages/feature-keys/
  package.json      { "name": "@cluenori/feature-keys", "private": true, "type": "module",
                      "exports": { ".": "./src/index.ts" }, "scripts": { "typecheck": "tsc" },
                      "dependencies": { "effect": "catalog:" } }
  tsconfig.json     { "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
  vitest.config.ts  when it has tests
  README.md         the map, from docs/templates/package-readme.md
  src/index.ts      the contract: the only file other packages may import
  src/*.ts          everything else, private
  test/*.test.ts
```

Canonical example: `packages/workspace-rules`.

- **One entry.** `exports` names only `src/index.ts`. Nothing else is reachable from outside; a deep
  import doesn't resolve. The one possible exception, an `./api` entry for API definitions, is an
  open decision in `ARCHITECTURE.md`: "How clients import the API definition".
- **`src/index.ts` is the contract, and only the contract.** It exports the package's services,
  their layers, the Schemas of their inputs and outputs, their errors, and, for engines and
  modules, their part of the API definition (entry 15). It holds no logic of its own.
- **Every export has a doc comment.** One or two sentences a caller needs: what it is, what it
  guarantees, what it costs. For services, each method's effects, idempotency, and limits (`AGENTS.md`,
  "Contracts are the design").
- **Dependencies are declared.** Every import from another package is a `dependencies` entry with
  `"catalog:"` (external) or `"workspace:*"` (ours). Bun's isolated installs make an undeclared import
  fail.
- **Size is a signal.** If `src/index.ts` no longer fits on a screen, the package holds more than one
  concept, or product logic sits in what should be a capability (`ARCHITECTURE.md`, "Layers").

## 4. Services and layers

A service is a contract that callers reach through Effect's context; its layer is how it is built.

```ts
import { ActivityLog, FeatureKey, Source } from "@cluenori/foundation"
import type { Actor } from "@cluenori/foundation"
import { Context, Crypto, DateTime, Effect, Layer, Schema } from "effect"
import { SqlClient, SqlSchema } from "effect/sql"

/** A feature was added to the project's catalog. */
export const FeatureAdded = Schema.TaggedStruct("feature.added", { feature: FeatureKey, name: FeatureName })

const source = Source.make("module:features")

/** The features of one project, by key. */
export class FeatureCatalog extends Context.Service<FeatureCatalog, {
  /** Adds a feature, with `feature.added`. Fails with `FeatureKeyTaken` when the key exists. */
  readonly add: (actor: Actor, input: AddFeature) => Effect.Effect<Feature, FeatureKeyTaken>
  /** Finds a feature by its key. */
  readonly find: (key: FeatureKey) => Effect.Effect<Feature, FeatureNotFound>
}>()("@cluenori/features/feature-catalog/FeatureCatalog") {
  static readonly layer = Layer.effect(
    FeatureCatalog,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const crypto = yield* Crypto.Crypto
      const log = yield* ActivityLog

      const findByKey = SqlSchema.findOneOption({
        Request: FeatureKey,
        Result: Feature,
        execute: (key) => sql`SELECT id, key, name, created_at AS "createdAt" FROM features WHERE key = ${key}`,
      })

      // The write `add` commits: it checks the key and inserts in the same transaction.
      const insert = Effect.fn("FeatureCatalog.insert")(function* (input: AddFeature) {
        const existing = yield* findByKey(input.key).pipe(Effect.orDie)
        if (existing._tag === "Some") {
          return yield* new FeatureKeyTaken({ key: input.key })
        }
        const uuid = yield* crypto.randomUUIDv7().pipe(Effect.orDie)
        const id = FeatureId.make(uuid)
        const createdAt = yield* DateTime.now
        const feature = new Feature({ id, key: input.key, name: input.name, createdAt })
        yield* sql`INSERT INTO features ${sql.insert({ id, key: input.key, name: input.name, created_at: DateTime.formatIso(createdAt) })}`.pipe(Effect.orDie)
        return feature
      })

      const add = Effect.fn("FeatureCatalog.add")(function* (actor: Actor, input: AddFeature) {
        return yield* log.commit({
          source,
          actor,
          write: insert(input),
          activity: (feature) => [
            { payload: FeatureAdded.make({ feature: feature.key, name: feature.name }), feature: feature.key },
          ],
        })
      })

      const find = Effect.fn("FeatureCatalog.find")(function* (key: FeatureKey) {
        const found = yield* findByKey(key).pipe(Effect.orDie)
        if (found._tag === "None") {
          return yield* new FeatureNotFound({ key })
        }
        return found.value
      })

      return FeatureCatalog.of({ add, find })
    }),
  )
}
```

- **When a service earns its place.** It is the contract of a package (an engine, a module, a
  capability); or several real implementations exist or are committed to, such as one per payments
  provider, all passing one conformance suite; or it is a resource tests must replace, such as a
  vendor's HTTP client. Never one service per function, and never "for future swapping."
- **The shape is the contract.** Methods are `readonly` properties typed in the class's type
  argument, with documented inputs, outputs, and errors.
- **Requirements never leak.** Every method's requirements are `never`. What the implementation
  needs (`SqlClient`, `Crypto`, other services) is yielded once, when the layer is built, and
  captured. `@effect/tsgo` reports a leak (`leakingRequirements`).
- **Keys are unique and deterministic:** `"<package name>/<file>/<Class>"`, where the file is the
  path inside `src/` without its extension: `"@cluenori/features/feature-catalog/FeatureCatalog"`.
  The compiler checks it (`deterministicKeys`).
- **The layer is a static property named `layer`,** built with `Layer.effect` (or `Layer.succeed`
  for a value with no dependencies). A second implementation is another static, named for what it
  is: `layerMemory`, `layerTest`. The layer's own requirements are what the host provides.
- **Every method is an `Effect.fn` named `"<Service>.<method>"`,** so every call is a span with a
  stable name. Exported functions that return an Effect use `Effect.fn` the same way.
- **No state outside the layer.** A service holds what its layer built; mutable state lives in a
  `Ref` or a store owned by the service, never in module-level variables.
- **Only hosts and tests provide layers.** `Effect.provide` appears in `apps/` and `test/`, never
  inside a package (`strictEffectProvide`).
- **Effect's platform services in workerd.** Effect has no platform package for Workers. `Crypto`
  comes from `@cluenori/web-crypto`, which the host provides with `webCryptoLayer(crypto)`; `Clock`
  and `Random` are Effect's defaults.
- Canonical example: `product/foundation/src/activity-log.ts`, a service whose layer takes its
  settings and does its setup (migrations) once, when it is built.

## 5. Writing Effect code

- **Generators for workflows, pipes for transformations.** A sequence of steps is an
  `Effect.gen` (or the generator of an `Effect.fn`). A transformation of one effect (`Effect.map`,
  `Effect.orDie`, `Effect.catchTag`, `Effect.withSpan`) is a `.pipe(...)` on it.

  ```ts
  export const nameOf = Effect.fn("nameOf")(function* (key: FeatureKey) {
    const catalog = yield* FeatureCatalog
    const feature = yield* catalog.find(key).pipe(
      Effect.map((found) => found.name),
      Effect.catchTag("FeatureNotFound", () => Effect.succeed("(unknown)")),
    )
    yield* Effect.logInfo("looked up feature").pipe(Effect.annotateLogs({ feature: key }))
    return feature
  })
  ```

- **No Promises in our code.** No `async`, `await`, `new Promise`, or `.then`. Wrap a
  platform Promise once, where it enters, with `Effect.tryPromise` and a typed error. `@effect/tsgo`
  makes `async` and `new Promise` errors.
- **No running inside effects.** `Effect.runPromise` and its siblings appear only where the platform
  calls us (entry 16), never inside an effect.
- **No `try`/`catch` or `throw`.** Expected failures are errors in the error channel (entry 9);
  bugs are defects.
- **No nested generators.** A step that needs its own generator is a named `Effect.fn`.
- **Concurrency is stated.** `Effect.forEach(items, f, { concurrency: n })` with a bound that comes
  from the platform's limits, never unbounded over input size.
- **Platform globals are banned:** `Date` (use `Clock` and `DateTime`), `Math.random` (`Random`),
  `crypto.randomUUID` (`Crypto`), `fetch` (`HttpClient`), `console` (`Effect.log*`), `setTimeout` and
  `setInterval` (`Effect.sleep`, `Schedule`), `process.env` (entry 11), and `JSON.parse` and
  `JSON.stringify` (Schema). `@effect/tsgo` reports each one.

## 6. Closed sets

- **A literal union when the cases are labels:** `Schema.Literals(["idea", "planned", "building",
  "beta", "live", "deprecated", "removed"])` for a feature's stage. Stored and serialized as the
  strings themselves.
- **A tagged union when the cases carry different data:** `Schema.Union([...])` of
  `Schema.TaggedStruct("...", { ... })` members, or the `Option` and `Result` types Effect provides.
- **No TypeScript `enum`** (erasable syntax only, entry 20).
- **Switch exhaustively, without a default.** `switch (value._tag)` names every case, so a new case
  fails the build wherever it is ignored. For `Option`, `Result`, and `Exit`, test `_tag` the same way
  or use the module's `match`.

## 7. Value types and validation

Parse, don't validate. Raw input becomes a typed value once, where it crosses a trust boundary.
After that, the type guarantees validity.

Canonical examples: `product/foundation/src/feature-key.ts` and the other keys in
`product/foundation/src/`. The snippets below build on `FeatureKey` from there.

```ts
/** What people call a feature: 1 to 100 characters. */
export const FeatureName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100))

export const AddFeature = Schema.Struct({ key: FeatureKey, name: FeatureName })
export type AddFeature = typeof AddFeature.Type
```

```ts
// At a trust boundary: the input is unknown, so decode it.
export const parseAddFeature = (body: unknown) => Schema.decodeUnknownEffect(AddFeature)(body)
```

- **Contracts take parsed values.** A service method takes `FeatureKey`, never a `string` that might
  be one. Decoding happens where data enters: the public API and MCP (their Schemas decode for us,
  entry 15), a queue message, a webhook, a stored row, configuration. So a service's error channel
  never contains `SchemaError`.
- **When a value gets a type.** When it has a rule: format, length, range, or normalization. Values
  without rules stay primitives.
- **Brands make values distinct.** Every value type and every ID is branded, so a `FeatureKey` can't
  be passed where a `ProjectKey` is expected.
- **Limits are written once,** in the Schema, and reused wherever the value is stored or shown.
- **A refusal says the rule.** Every `isPattern` names its rule for a person in `expected`, such as
  "lowercase letters, digits and single hyphens, starting with a letter, such as notes-ios", because
  the Schema's message is what an API caller or an agent reads.
- **`decodeEffect` for typed input, `decodeUnknownEffect` for `unknown`,** and the Effect-returning
  forms inside effects, never `decodeSync`.
- **Never silently truncate or "fix" input.** Reject it with the Schema's message. If shortening is a
  product rule, make it a named function.
- **Stored values decode through the same Schema,** so invalid data fails loudly when it is read.

## 8. Records and IDs

```ts
/** A feature's ID. `Uuidv7` is the rule in product/foundation/src/ids.ts. */
export const FeatureId = Uuidv7.pipe(Schema.brand("FeatureId"))
export type FeatureId = typeof FeatureId.Type

export class Feature extends Schema.Class<Feature>("Feature")({
  id: FeatureId,
  key: FeatureKey,
  name: FeatureName,
  createdAt: Schema.DateTimeUtcFromString,
}) {}
```

- **Records are `Schema.Class`es** of immutable fields. They cross boundaries as they are: the same
  class is the service's output, the API's response, and the row's decoded shape.
- **IDs are branded strings holding a lowercase UUIDv7,** created with `Crypto`'s `randomUUIDv7()`
  and `<Id>.make(...)`. UUIDv7 is time-ordered, so it indexes well and pages without an extra
  column, and lowercase compares as text. The envelope's `id` follows the same rule. Canonical
  example: `product/foundation/src/ids.ts`.
- **IDs are rebuilt only at the edges:** decoded from a route, a message, or a row.
- **Other packages' IDs are stored as plain values,** never as foreign keys (`ARCHITECTURE.md`,
  "Data").
- **Records hold data, not behavior.** A rule about a record lives in a function of the package
  that owns it, which takes the record and returns a new one or an error.

## 9. Errors

```ts
export class FeatureNotFound extends Schema.TaggedError<FeatureNotFound>()("FeatureNotFound", {
  key: FeatureKey,
}) {}

export class FeatureKeyTaken extends Schema.TaggedError<FeatureKeyTaken>()("FeatureKeyTaken", {
  key: FeatureKey,
}) {}
```

- **Expected failures are tagged errors** in the error channel, declared with `Schema.TaggedError`
  in the contract that fails with them, and yielded where they happen: `return yield* new
  FeatureNotFound({ key })`.
- **Names say what happened:** `<Noun><State>`, such as `FeatureNotFound`, `FeatureKeyTaken`,
  `VersionBlocked`.
- **The tag is the stable code.** Clients and agents branch on `_tag`; renaming one is a contract
  change. Fields carry the facts a caller needs to act, never secrets or personal data.
- **A contract lists only errors its caller can act on.** Infrastructure failures (`SqlError`, a
  `PlatformError`) become defects with `Effect.orDie` where they happen, unless the caller can do
  something about them. The host logs a defect once, with its trace.
- **Handle by tag:** `Effect.catchTag`, `Effect.catchTags`. Never catch everything to return a
  default; that hides failures (`AGENTS.md`, "Failure honesty").
- **No native errors.** Never `throw`, `new Error`, or a class extending `Error`
  (`extendsNativeError`).
- **On HTTP,** each error declares its status in the API definition (entry 15), with
  `HttpApiSchema.status` where an endpoint lists it. A middleware's error, which no endpoint lists,
  declares it on its class: `{ httpApiStatus: 401 }` (`apps/worker/src/member-authorization.ts`).

  | Failure | HTTP |
  |---|---|
  | Input that fails its Schema | 400, with the Schema's issues, produced by the API |
  | Not signed in, unknown key | 401 |
  | Not allowed | 403 |
  | Not found | 404 |
  | Conflict with current state | 409 |
  | Defect | 500, no internal details, trace ID included |

- **Don't reveal existence.** When the actor shouldn't learn whether something exists, fail with the
  not-found error, not a forbidden one.
- **Known gaps.** Every case the code doesn't handle, too rare to earn handling or not built yet, is
  marked once, where it would be handled: `// Not handled: <case>; <what happens today or what
  handling it would take>.` A rare case dies with `Effect.die` and a message saying what is off, and
  reaches the host's handler like any bug. The change that handles one removes its comment.

## 10. Time

- **One clock.** Read time with `DateTime.now` or `Clock.currentTimeMillis`. `Date.now()` and
  `new Date()` are errors (`globalDate`).
- **Instants are `DateTime.Utc` in code** and ISO 8601 UTC strings on the wire and in storage:
  Foundation's `Instant`, which the OpenAPI document marks `format: date-time`. Durations are `Duration`. Calendar dates are `YYYY-MM-DD`
  strings with their own Schema: Foundation's `CalendarDay`, a UTC day, stored as the number of days
  since 1970-01-01 (`product/foundation/src/calendar-day.ts`).
- **A person's time zone is data:** an IANA ID stored with them, applied with `DateTime` zone
  functions only when formatting for that person.
- **Tests control time** with `TestClock` from `effect/testing`.

## 11. Configuration and bindings

Owners declare what they need; hosts decide where it comes from.

```ts
/** What the APNs sender needs: values, never where they come from. */
export interface ApnsSettings {
  readonly teamId: string
  readonly keyId: string
  readonly privateKey: Redacted.Redacted<string>
}
```

```ts
// In the host: the only code that reads configuration, one visible line per owner.
export const apnsSettings = Config.all({
  teamId: Config.String("APNS_TEAM_ID"),
  keyId: Config.String("APNS_KEY_ID"),
  privateKey: Config.Redacted("APNS_PRIVATE_KEY"),
})
```

- **Hosts read configuration; packages receive values.** A package's layer takes its settings as an
  argument (`Apns.layer(settings)`). Packages never read `Config`, environment variables, or the
  Worker's `env`, so they move to another product or to npm unchanged, and tests simply construct
  the settings.
- **The Worker's `env` belongs to `apps/worker`.** Its variables reach `Config` through
  `ConfigProvider.fromUnknown(env)`, and its bindings (Durable Object namespaces, R2, queues) are
  passed to the layers that use them. Types for `env` are generated by `wrangler types` from
  `wrangler.jsonc`, never written by hand.
- **Secrets are `Redacted`** from the moment they are read, so they never print in logs or errors.
  They live in Wrangler secrets and in `.dev.vars` locally, never in committed files.
- **Invalid configuration fails at startup,** with the variable's name.
- **Prefer a sensible default to a setting.** Add a setting only for a value that differs between
  deployments.
- Canonical example: `apps/worker/src/worker.ts` reads the API token and its owner with `Config`.

## 12. Logging and tracing

- **Log with `Effect.log*`,** with annotations instead of interpolation:
  `Effect.logInfo("looked up feature").pipe(Effect.annotateLogs({ feature: key }))`.
- **One vocabulary of fields.** Log annotations and span attributes use the scope keys' names from
  the envelope (`project`, `component`, `release`, `feature`, `person`, `trace`, ...), so Cluenori's
  own telemetry filters the way it filters everyone else's.
- **What never goes in logs:** personal data, secrets, tokens, or text people wrote. Log IDs.
- **Levels.** Info for routine events, warning for something an operator should look at, error for
  a failure someone must fix. Expected errors aren't logged as errors; defects are logged once, by
  the host.
- **Spans come from `Effect.fn` names** (entry 4). Add `Effect.withSpan` only around work that isn't
  already a named function, such as one item of a batch.
- **Export** is configured once, in the host, with `effect/observability`.

## 13. Persistence

- **SQL through `effect/sql`.** Queries are tagged templates, `sql\`... ${value}\``, so every value
  is a parameter. Never build SQL from strings.
- **Rows decode through Schemas** with `SqlSchema.findOneOption`, `findAll`, and their siblings, so a
  stored value that breaks its rule fails loudly.
- **Each package owns its tables** and their migrations, and touches no one else's
  (`ARCHITECTURE.md`, "Data").
- **Tables are named for their package:** `<package>_<table>`, such as `projects_components`, so
  packages sharing a project's one database never collide. Columns are snake_case; queries alias
  them to the record's field names.
- **One commit per action,** with its activity (entry 14).
- **Where the tables live:** each project's in the SQLite database of its own Durable Object, and
  the workspace's in one more (`ARCHITECTURE.md`, "Runtime on Cloudflare"). Code that uses them
  runs inside that object, with `SqlClient` built from the object's storage, so
  `sql.withTransaction` commits a write and its activity together. Canonical examples:
  `product/foundation/src/activity-log.ts`, and `product/foundation/test/in-object.ts`, which builds
  it on an object's storage.
- **Migrations run inside each object,** with Effect's migrator, before it serves its first request
  after a deploy. A project is never served by code newer than its tables. An object builds no
  database before its project is created, so a request for a project that doesn't exist leaves
  nothing behind (`apps/worker/src/project-object.ts`).
- **Each package's migrations are its own:** an `effect/sql` `Migrator` with a table of its own,
  `<package>_migrations`, so numbers never collide in a project's one database. They run when the
  package's layer is built. Canonical example: `product/foundation/src/foundation-migrations.ts`.

## 14. Writes, activity, and reactions

Every write to a record emits activity: a typed fact, never edited, that timelines, Today,
workflows, webhooks, agents, and the audit log read (`concept/Foundation.md`, "Data shapes").

- **One write path.** Records change only through `ActivityLog.commit` from `@cluenori/foundation`,
  which commits the write and its activity together. A write that skips it is a bug.
  `product/foundation/README.md` shows a caller.
- **Activity is named `<record>.<past tense>`:** `feature.added`, `release.published`,
  `feedback.status_changed`. Its payload is a `Schema.TaggedStruct` whose tag is that name,
  exported from the emitting package's contract. Its fields are JSON values, with times as ISO 8601
  text, because activity is stored and delivered as it is.
- **Changes are additive.** A new field is optional; a breaking change is a new activity name, and
  the old one keeps being emitted until nothing reacts to it.
- **Reactions are idempotent.** Delivery through Queues is at least once and may be out of order, so
  a reaction checks before it acts, on a key with a unique index.
- **Delivery:** the project's object sends its new activity to the activity queue on its alarm
  (`ActivityLog.deliver`), and the Worker's consumer hands each batch to the engines that react.
  Canonical example: `@cluenori/notifications`, which pushes each entry to each phone once, keyed
  by entry and phone in `notifications_sent`.
- **Activity is an announcement, not a request.** To get an answer, call a service.

## 15. The public API and MCP

One API for people and agents (`ARCHITECTURE.md`, "Principles"): its definition is the contract.

```ts
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api"

export class FeaturesGroup extends HttpApiGroup.make("features").add(
  HttpApiEndpoint.get("find", "/features/:key", {
    params: { key: FeatureKey },
    success: Feature,
    error: FeatureNotFound.pipe(HttpApiSchema.status(404)),
  }),
  HttpApiEndpoint.post("add", "/features", {
    payload: AddFeature,
    success: Feature,
    error: FeatureKeyTaken.pipe(HttpApiSchema.status(409)),
  }),
) {}

export class CluenoriApi extends HttpApi.make("cluenori").add(FeaturesGroup) {}
```

- **Definitions are Schemas.** Params, payloads, successes, and errors reuse the contract's own
  Schemas, so decoding at the edge produces the parsed values services take (entry 7).
- **Every public route is a tool.** The same queries and actions become MCP tools, so their names and
  doc comments are written for people and models: what it does, when to use it, what its errors
  mean. Prefer batch operations and filterable queries to one-at-a-time calls.
- **Handlers translate only.** Build the actor, call the service, return its result. No rules and no
  SQL.
- **Clients derive from the definition.** The dashboard and the CLI build typed clients from
  `CluenoriApi`; nobody writes request types by hand.
- **The OpenAPI document is generated and committed,** and a check fails when it is stale, so every
  API change shows in review. So is the iOS app's Swift client of it
  (`apps/ios/CluenoriApp/Sources/CluenoriClient/CluenoriAPI.swift`); the Kotlin SDK will be too.
- **Every Schema the API carries has a name,** the one it is exported as: a `Schema.Class`, or
  `.annotate({ identifier: "PhoneList" })` on a struct, union, or literals. The document and the Swift
  client use the code's names, and `bun run generate` refuses an unnamed object or enum, since
  another language needs a name for its type. Dates are Foundation's `Instant` (entry 10).
- **Routes** are plural kebab-case resources with IDs as segments. A state change that isn't a plain
  update is a sub-resource: `POST /releases/:id/rollback`.
- **Each engine or module defines its group in its contract;** the host adds the group to
  `CluenoriApi`, with `MemberAuthorization` on every group but the system's. Handlers get the
  actor from `CurrentActor`. `CluenoriApi` imports a module's group, never its definition, so the
  clients built on it don't bundle the queries the module runs in projects' objects.
- **A module is defined with `defineModule`** (`product/foundation/src/module.ts`): its ID, scope,
  queries and routes. Each query (`moduleQuery`) has plain Schemas for its input, answer and tagged
  errors, and a `run` that reads the engines in the project's Durable Object. The host serves every
  query there under `<module>.<query>` from its `modules` list (`apps/worker/src/project-object.ts`),
  and a handler per route calls it with `moduleCall(module, query)` through `MemberProjects`
  (`apps/worker/src/releases-handlers.ts`). A module with records or clients has a `layer` taking
  its settings, which the host reads and builds on its own line in the project's object; its
  `background` runs on the project's alarm, bounded and at its own pace; its `ingest` writes are
  served at `POST /ingest/v1/<module>/<name>` for a component's ingest key
  (`apps/worker/src/module-ingest.ts`), for tooling such as CI that isn't a member. Its `actions`
  (`moduleAction`) change things for an actor: `run(actor, input)` in the project's object, served
  under `<module>.action.<name>`, which a handler calls with `moduleActionCall(module, action)` and
  the caller's actor; it commits its records with their activity through `ActivityLog.commit`
  (`product/modules/releases/src/promote.ts`).
- **Canonical examples:** a group, `product/engines/projects/src/projects-api.ts`; the API,
  `apps/worker/src/cluenori-api.ts`; handlers, `apps/worker/src/projects-handlers.ts`. The MCP
  server's comes with the first module.

## 16. The Worker entry

- **One entry file,** `apps/worker/src/worker.ts`, with the default export and the Durable Object
  and Workflow classes the platform requires.
- **The runtime is built once per isolate** from the app's layers, and reused for every request,
  queue batch, and scheduled event.
- **Promises live only here.** Each entry point turns the platform's call into an Effect on its first
  line and runs it with the shared runtime.
- **Per-request platform values** (the request, its `ExecutionContext`) are passed into the effect,
  never stored in module-level variables.
- **Shared work survives requests.** The app runs on Effect's sync scheduler, because Workers can
  discard timers a request owns.
- **A project's Durable Object is reached through one call per operation.** Each is an entry of
  `projectCalls`, with the Schemas of its input, its answer, and its error; both sides encode with
  them as JSON text, so tagged errors cross the boundary typed. The Worker calls
  `ProjectObjects.call(project, projectCalls.x, input)`; the object composes the engines' layers
  once and serves each call on a visible line.
- **The workspace's Durable Object is reached the same way,** through `workspaceCalls` and
  `WorkspaceObjects.call`; both kinds of object share `src/object-calls.ts`.
- **A request's body is read through `boundedBody`, never whole,** with the route's limit: past it,
  413, whether the sender declared its length or not, and nothing more is read
  (`apps/worker/src/bounded-body.ts`).
- **What callers may flood is limited where it is recorded:** in the project's object, fixed
  minutes counted in its memory, only the current one kept, refused with the seconds left to wait
  (429). Nothing is stored, and a restart forgets: right for keeping a project's writes bounded, not
  for billing (`product/engines/signals/src/app-rate-limits.ts`).
- **An answer the same for many callers is kept in the edge's cache,** named by everything it
  depends on, the credential included, so only one the project's object accepted ever finds it; it
  says how long it may still be used, so a change reaches everyone within that time
  (`apps/worker/src/manifest-cache.ts`). A cache that fails or keeps nothing means asking the object.
- Canonical examples: `apps/worker/src/worker.ts`; for Durable Object calls,
  `apps/worker/src/object-calls.ts`, `project-calls.ts`, `project-object.ts`, and `project-objects.ts`.

## 17. Background work

- **Ownership.** Queue consumers, cron triggers, Durable Object alarms, and Workflows are owned by
  one engine or module, and registered on a visible line in `apps/worker`.
- **Idempotent.** Every handler may run again for the same input, because the platform retries.
- **Bounded.** Each run processes a limited batch, within the platform's CPU and subrequest limits,
  and leaves the rest for the next run.
- **One failure never stops the rest.** A batch handles each item's failure, acknowledges what
  succeeded, and retries the rest with the platform's backoff.
- **Each item is its own span;** looking for work is not.
- **Actor.** Background work uses a named system actor.
- **`waitUntil`** is only for work whose loss is harmless (`AGENTS.md`, "State and resources").

## 18. External APIs

- **A vendor's API gets one client package,** `@cluenori/<vendor>`, built on `effect/http`'s
  `HttpClient`, with Schemas for what we read. Prefer a vendor's official SDK only when it runs in
  workerd and saves real work.
- **Vendors stay inside the package that uses them.** Their types never appear in a product
  contract; the client maps them to our own.
- **Inbound webhooks** verify their signature with the client, then call the owning engine or module
  with a system actor.
- **Tests fake vendors at `HttpClient`,** with recorded responses, never by mocking our own services.
  A client package's own tests do; an engine or module that uses a client may fake the client's
  service instead (`product/modules/releases/test/sources.test.ts`), since the client's tests
  already cover the wire.
- **A language model is `effect/ai`'s `LanguageModel`,** which the host provides
  (`@cluenori/cloudflare-workers-ai` on the Worker's `AI` binding); product code asks it with
  `generateText` and never names a provider. Text from commits, logs or people goes in the prompt
  as data, with the instruction not to follow it, and what the model writes reaches the outside
  only after a person saves it (`product/modules/releases/src/notes.ts`). Tests fake it with
  `LanguageModel.make` (`product/modules/releases/test/in-object.ts`).
- **JSON Web Tokens are signed with `@cluenori/es256-jwt`,** such as Apple's tokens from a `.p8` key:
  APNs's and App Store Connect's; and with `@cluenori/rs256-jwt` for RSA keys, such as a GitHub
  App's.
  A journey fakes them with Miniflare's `outboundService`, in a Vitest project of its own, so the
  other journeys' requests aren't affected.
- Canonical examples: `packages/apns`, its tests, and `tests/journeys/vitest.alerts.config.ts`.

## 19. Testing

Test what people and agents rely on, through the surface they use: the public API.

```ts
import { assert, describe, it } from "@effect/vitest"
import { Effect, Schema } from "effect"

describe("FeatureKey", () => {
  it.effect("rejects a key with spaces", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeEffect(FeatureKey)("editor export").pipe(Effect.result)
      assert.strictEqual(decoded._tag, "Failure")
    }))
})
```

- **One framework.** Vitest 5 with `@effect/vitest` (`it.effect`, `layer`). Tests that need the
  Worker run inside workerd through `@cloudflare/vitest-plugin`, with local Durable Objects, R2,
  and Queues. `bun test` isn't used.
- **Journeys** (`tests/journeys`). A journey is one test of a real flow through the public API, as
  named steps that check what matters along the way: what is tested is what people and agents can
  do. Every feature extends the journey it belongs to, or starts one: its normal path, its
  consequential failure, and who may use it.
- **Isolation without resets.** Each journey works in projects of its own, so journeys run in
  parallel without cleanup.
- **Conformance suites** for contracts with several implementations, such as payments providers and
  channels.
- **Package tests** for dense logic with many edge cases, through the package's contract: parsing,
  money, bucketing, catalog rules.
- **Product packages test inside a Durable Object,** in workerd with `@cloudflare/vitest-plugin`
  and the object's real SQLite, each test in an object of its own.
- **Tests in workerd keep Vitest's on-disk module cache off** (`fsModuleCache: false` in each such
  `vitest.config.ts`). With it, a new test worker asks Vitest for every module it already has on
  disk, and the plugin, as workerd can't read files, sends their code in one WebSocket message. That
  message grows with the code, and past workerd's 32 MiB limit the test worker dies with "Message is
  too large". Without the cache, each module comes in a message of its own; a full run is no slower.
- **Fakes only for paid or external services,** at `HttpClient` (entry 18). Everything we run
  ourselves, including the database and queues, is real.
- **Capabilities test against Effect's in-memory platform.** A capability that reads files or time
  is tested with `FileSystem.layerNoop` or `TestClock`, not a Node layer, so Node's types never
  enter its program.
- **Tests outside workerd** run under `TZ=Pacific/Chatham` and `LANG=tr_TR.UTF-8`, which
  `bun run test` sets (entry 2).
- **Canonical examples:** a journey, `tests/journeys/test/deployment-journey.test.ts`; package
  tests, `packages/workspace-rules/test/check-workspace.test.ts`; tests inside a Durable Object,
  `product/foundation/test/activity-log.test.ts`.
- **Time** is controlled with `TestClock`; durations come from settings, which tests make short.
  Code that runs inside a Durable Object gets its own `TestClock`
  (`product/engines/signals/test/in-object.ts`). A journey uses real time, because the Worker it
  calls does: `layer(..., { excludeTestServices: true })`.
- **Fixtures from real systems** are captured once, kept as test files with a note of where they
  came from, and never edited by hand: `packages/otlp/test/fixtures/`.
- **Names state behavior:** `"rejects a key with spaces"`.
- **Never mock** our own services or the database.

## 20. Build and checks

The configuration files are the specification; this entry says what each one owns.

| File | Owns |
|---|---|
| `package.json` (root) | Workspaces, scripts, and the catalog: the one exact version of every dependency |
| `tsconfig.base.json` | Compiler settings and Effect diagnostics every package extends |
| `.oxlintrc.json` | Lint rules, each one turned off with its reason |
| `.oxfmtrc.json` | Formatting |
| `bunfig.toml` | Isolated installs, and exact versions from `bun add` |
| `vitest.config.ts` (root) | Which packages' tests `bun run test` runs |
| `apps/dashboard/vite.config.ts` | React Compiler, and the dashboard's first-load budget, which `bun run check` builds to check |
| `apps/dashboard/vitest.config.ts` | The browser the dashboard's tests run in, and its locale and time zone |
| `tools/src/dependency-rules.ts` | The dependency rules the architecture check enforces |
| `stryker.config.json` | Mutation testing's settings, which every package's run shares, run in the package's folder: in place, as a copy of one folder can't reach the workspace around it |
| `tools/src/mutation-targets.ts` | The packages mutation testing measures, and each one's floor |
| `flake.nix`, `flake.lock` | Bun, Node |
| `apps/worker/wrangler.jsonc` | The Worker's bindings, routes, and compatibility date |

- **Compiler settings.** `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, `noUnusedLocals`,
  `verbatimModuleSyntax`, `isolatedModules`, `erasableSyntaxOnly`, `module: preserve`,
  `moduleResolution: bundler`, and `types: []`, so each package names the ambient types it may use.
  Capabilities name none.
- **Every Effect diagnostic that is on fails the build,** suggestions included, through
  `@effect/tsgo`'s plugin settings. Two are off, with their reasons in the file:
  `schemaClassMissingBrand` (records compare by shape on purpose; IDs and value types carry brands)
  and `newSchemaClass` (records and errors are made with `new`). `unstableApiUsage` stays on: each
  unstable module we use is allowed by name in `allowedUnstableApis`. `strictEffectProvide` is off
  only where layers are provided: `test/` and the hosts' entries.
- **Generated files.** `apps/worker/openapi.json` is generated by `bun run generate` and committed;
  `bun run check` fails when it is stale. `apps/worker/worker-configuration.d.ts` is generated by
  `wrangler types` on install and on every type check, and isn't committed.
- **Rules are turned off only in their config file,** with a one-line reason, scoped to the paths
  that need it. Never with a comment in code.
- **New dependencies need clear net value.** Add them to the catalog, and call them out in the
  change summary.
- **Repeated mistakes become rules.** When a mistake repeats, turn on a diagnostic, add a lint rule,
  or extend the architecture check, rather than adding another paragraph here.

## 21. Files and naming

- **One concept per file,** named in lowercase kebab-case after what it exports: `FeatureKey` lives
  in `feature-key.ts`, `FeatureCatalog` in `feature-catalog.ts`.
- **Names:** values and functions `camelCase`; types, Schemas, services, and errors `PascalCase`; a
  Schema and its type share one name (`FeatureKey`).
- **Package names** are the folder's name under the scope: `packages/web-push` is `@cluenori/web-push`,
  `product/engines/audiences` is `@cluenori/audiences`.
- **Tests** sit in the package's `test/`, named after the file or journey they cover:
  `feature-key.test.ts`, `release-journey.test.ts`.
- **Product words keep their product meaning** (`GLOSSARY.md`): in code, a UI building block is a
  view, never a "component"; a file is a file, never a "module".

## 22. Credentials and personal data

- **A credential is `Redacted` from the moment it is read** (entry 11), and never logged.
- **Telemetry is scrubbed before anything stores it:** every text value goes through
  Signals' `scrubbedText`, `@bagatka/scrub`'s `scrubText` with Cluenori's own key prefix, and a
  value whose name `isSecretName` is removed whole. The
  canonical example is `product/engines/signals/src/scrubbed.ts`.
- **Stores keep a digest, never the credential.** Keys and tokens are compared by their SHA-256
  digests, which also makes the comparison take the same time whatever is presented. The one
  exception is a key that is public by design, such as an SDK key, which every build of an app
  carries: it grants nothing secret, is stored as it is so it can be listed again for a new build,
  and is still unguessable (`product/engines/projects/src/sdk-key.ts`).
- **A credential Cluenori uses, rather than checks, is a Worker secret** when it is given at setup,
  such as APNs's key. One a vendor hands over while running, such as the private key GitHub gives
  the workspace's app, is kept only in the workspace's object: never returned by a route, logged,
  or put in activity. Others get short-lived tokens from it (`product/engines/github-app`).
- **Refusals say nothing about which part was wrong:** an unknown project, component, or secret
  fails the same way.
- **A key that names where it belongs** (`cluenori.<project>.<component>.<secret>`) lets the Worker
  route it before the owner checks it.
- **Every request acts for a member, and sees what they see.** The Worker resolves the caller's
  access once, with the credential (`CurrentMember`), and handlers reach a project's object only
  through `MemberProjects`, which answers "not found" for a project the member doesn't see, as for
  one that doesn't exist. A lint rule keeps handlers from importing `ProjectObjects`. Owner-only
  actions fail with Foundation's `NotAllowed`.
- **People sign in with passkeys** (`@cluenori/webauthn`); a browser keeps a sign-in token, stored
  as a digest like every key, and a refused passkey says nothing about why.
- Canonical examples: ingest keys, `product/engines/projects/src/ingest-key.ts` and `projects.ts`;
  the API token and sign-ins, `apps/worker/src/member-authorization-layer.ts`; access,
  `apps/worker/src/member-projects.ts`; passkeys and sign-ins, `product/engines/members/src/members.ts`.

## 23. Dashboard views

The dashboard (`apps/dashboard`) is React with shadcn/ui; its README is its map and holds the design
language.

- **Views, not components.** shadcn's views are copied into `src/views/ui/` and are our code: change
  them there, for every page. Our views sit in `src/views/`, pages in `src/pages/`. A view takes
  plain data and callbacks, and knows nothing of where data comes from. Imports start at the
  source root, `@/views/ui/button`, as `shadcn add` writes them; it is the one place imports don't
  name a relative file with its extension (entry 1).
- **Color means one thing each.** A component's color comes from `componentColor` in
  `src/lib/colors.ts`; failure is `failure`, a warning `yellow`; no view picks a color of its own.
- **Each question is a `Panel`** (`src/views/panel.tsx`): icon, title, what it covers, the time
  zone of its chart, and its answer, ending with `PanelStats`, the numbers that matter in a strip.
  Counts over time are `BarRows` (`src/views/bar-rows.tsx`), a row per thing counted. Canonical
  example: `src/pages/performance-page.tsx`.
- **Pages show what the API answers.** A view for data the API doesn't carry yet waits in the
  design kit, on sample data (`src/pages/kit-ahead.tsx`), never on a page. A page branches on what
  an answer says, never on a component's name.
- **One click, nothing hidden.** A choice among a few is a `Segmented` (`src/views/segmented.tsx`),
  always visible; the component, environment and release a page shows are its `FilterSwitches`
  (`src/views/filter-switches.tsx`), kept in the URL and in the links it opens. Details of a
  short item open in place, such as a log line. A summary shows the top few of a long list and
  links to a page with all of them, searchable and sortable; an item with more to show, such as an
  operation, an error, or a trace, has a page of its own (`src/pages/error-page.tsx`).
  Folded detail, such as a stack's library frames, opens with one click where it is.
- **Data comes from one file,** `src/project-data.ts`: an atom for each question the pages ask the
  public API, run on its typed client, `kept` so going back shows an answer at once and a stale one
  is asked again. The period is an atom the questions read, so changing it asks again and keeps
  the old answer, marked waiting, meanwhile. A question's family is keyed by a plain object (a
  project, a component), which Effect compares by value. Pages read atoms with `useAtomValue` and
  show each answer, or several with `AsyncResult.all`, through `Loaded` (`src/views/loaded.tsx`):
  a quiet line while it first loads, what failed if it did, the answer dimmed while a newer one
  loads.
- **What a page says about the answers** (what needs attention, what got slower) is computed once,
  by pure rules in `src/project-facts.ts`, and those only release pages need in
  `src/release-facts.ts`, which loads with them; pages show it. "Now" is the time an answer covers up to,
  never the clock, and a step without a point is unknown (`runColumnsOf`) unless the API says it
  means none (`logColumnsOf`).
- **An address is untrusted input:** `src/router.tsx` decodes its keys with the API's own schemas,
  once, so pages take `ProjectKey`, `ComponentKey`, and the like; an address that isn't a page's
  opens one that says so.
- **Lint keeps the layers** (`.oxlintrc.json`): only `src/project-data.ts` imports the API client;
  only the design kit reads the sample (others may import its types); views never import pages;
  shadcn's views import none of ours.
- **A link that looks like a button is a `Link`** with `buttonVariants`; a `Button` is for actions
  only, so a screen reader hears each for what it does (`src/views/attention-list.tsx`).
- **Views aren't memoized by hand.** React Compiler memoizes them at build time
  (`vite.config.ts`); `useMemo` and `useCallback` appear only where an identity is part of the
  contract, such as a context's value or a ref callback.
- **Numbers and times** go through `src/lib/format.ts`, in the viewer's locale and time zone, set in
  mono.
- **Effects only sync with something outside React.** A value derived from props or state is
  computed while rendering. A value from outside React that changes is read with
  `useSyncExternalStore`: the router (`src/router.tsx`), the viewport (`src/hooks/use-mobile.ts`).
  A DOM node is measured or scrolled by a ref callback (`useWidth` in `src/views/bar-rows.tsx`,
  `scrollIntoView` in `src/views/error-list.tsx`). State that must start fresh for another item is
  reset with a `key` (the trace page in `src/app.tsx`, the log pages in `src/pages/logs-page.tsx`).
  `bun run check` enforces these with Oxlint's React rules (`.oxlintrc.json`).
- **Work that waits runs as an Effect,** started with `Effect.runFork` in a React effect and
  interrupted in its cleanup: `src/hooks/use-highlighted-code.ts`.
- **Tests run in a real browser,** Playwright's Chromium, in an unfriendly locale and time zone
  (`vitest.config.ts`): rules through `src/project-facts.ts` (`test/project-facts.test.ts`), and
  journeys through the app (`test/errors-journey.test.tsx`), each step checked with axe
  (`test/accessible.ts`). Any error a page logs fails the test (`test/setup.ts`). Journeys call a
  fake public API at the network (`test/fake-api.ts`), which answers from a project made for each
  question's period and encoded with the API's own schemas (`test/notes-project.ts`), so a fixture
  that drifts from the contract fails.
- **The first load has a budget,** compressed, checked by every build (`vite.config.ts`): code
  that most visits don't need loads when it is needed, as the design kit does, or after start, as
  search does (`src/app.tsx`). What the first load needs is one chunk (Rolldown's `$initial`
  group), so it compresses as one. A package the dashboard imports is side-effect free
  (`"sideEffects": false`), and keeps an API's schemas apart from server code, so only the
  definitions reach the bundle (`trace-view.ts` and `read-archived-trace.ts` in Signals).

## 24. The iPhone app

`apps/ios` is Swift, and the same principles hold in Swift's own idiom (its README is its map).

- **Four layers, each only the one beneath.** The Xcode target holds what needs the app itself:
  `@main`, the Keychain, the phone's details, signing, the URL scheme. `CluenoriViews` is SwiftUI
  alone; `CluenoriScreens` holds each screen's state and actions as `@Observable` models;
  `CluenoriClient` talks to the API. The last two import Foundation and Observation alone, so they
  build on Linux (`apps/ios/check` fails otherwise).
- **Apple's guidance first.** Xcode 27.2's agent skills (`xcrun agent skills export`) are the
  reference for SwiftUI, Swift Testing, and security settings, over what we remember.
- **Screens say what happened; views say it in words.** A model exposes typed states and problems
  (`PairingModel.Problem.codeRejected`), never text; each view puts it in words, with
  `bundle: #bundle` and a translator's comment (`PairScreen.swift`). Models are `@Observable` on the
  main actor, with `Equatable` properties; rows take only the fields they show.
- **One look, one tree.** The app is dark always, in the founder's palette (`Theme.swift`:
  `Palette`, `Panel`, `PanelTitle`, `PanelRowStyle`, `Dot`, `PrimaryButtonStyle`); a new screen is
  built from them (`NowScreen.swift`), not from its own colors. Screens form a tree from Now: each
  level is a summary that leads one level deeper, and a link opens a screen over those that lead to
  it (`Route.chain`).
- **A `Button` gets a closure literal:** `Button(action: { open() })`, never `Button(action: open)`.
  After any edit to its file, Xcode 27.2's previews fail to build the second form ("ambiguous use
  of `__designTimeSelection`"); `apps/ios/check` refuses it.
- **One way to ask, typed failures.** Every screen's question is an `Answer` (`Answer.swift`):
  shown at once from what the phone kept, asked through the generated `CluenoriAPI`, whose methods
  run off the main actor and throw `APIError`. `.unreachable` keeps what was shown and says as of
  when; `.unauthorized` unpairs. Screens open by `Route`, their models made once by
  `DeploymentModels` and kept while recently used.
- **Credentials live in the Keychain,** after first unlock and this device only
  (`Cluenori/KeychainStore.swift`); never in defaults, files, or logs.
- **Tests are Swift Testing,** sentence-named, through the models' contracts with a fake transport
  and store (`CluenoriApp/Tests/CluenoriScreensTests`).
- **Strict by default:** Swift 6 with warnings as errors, Enhanced Security, `swift format` with
  `apps/ios/.swift-format`; `bun run check:ios` runs it all.

## 25. Recipes

These become `cluenori add` commands once there are a few examples to generate from.

### Add a capability

0. Check first: does an existing package own this? Does Effect already provide it?
1. Create `packages/<name>/` with the standard shape (entry 3) and its README from the template,
   then run `bun install` to link it into the workspace.
2. Write the contract in `src/index.ts` and a caller example in the README before the
   implementation.
3. Test it through its contract.
4. Add it to the parts table in `ARCHITECTURE.md`.
5. `bun run check` and `bun run test` pass.

### Add an engine or a module

0. Check first: should an existing engine or module own this? Is its phase in `concept/Modules.md`
   due?
1. Create `product/engines/<name>/` or `product/modules/<name>/` with the standard shape and its
   README, then run `bun install` to link it into the workspace.
2. Write its contract: records, activity, queries, actions, and their errors.
3. Register it in `apps/worker` on one visible line. A module: its definition in the `modules`
   list of `project-object.ts`, its group in `cluenori-api.ts`, and a handlers file for its routes
   provided in `worker.ts` (`product/modules/releases` is the example).
4. Extend the journey it belongs to.
5. Add it to the module map in `ARCHITECTURE.md` and its terms to `GLOSSARY.md`.
6. `bun run check` and `bun run test` pass.
