# Architecture

The one-page map of Cluenori: what the parts are, what each owns, and how they connect. How to
solve recurring problems lives in `PATTERNS.md`, vocabulary in `GLOSSARY.md`, the product in
`concept/`, and each package's details in its own `README.md`.

Parts marked "Planned" don't exist yet; this map is the plan they follow. Decisions that need
evidence first are listed under "Open decisions", not settled here.

## Product

Cluenori is the control room for a software factory: one founder, hundreds of projects. It answers
three questions (what needs action now, where the next hour and euro go, which project continues),
gives each new project the parts every app rebuilds (update gate, flags, changelog, feedback, push
and email), and runs in the founder's own Cloudflare account. `concept/Cluenori product vision.md`
is the source.

```
founders' apps (SDK) ──signals──▶ ingest ──▶ counters, lake, exact counts
                     ◀──manifest──
dashboard, cluenori CLI, MCP clients, agents ──▶ public API: queries and actions
                                                       │
                                     engines and modules (records, policy, audit)
                                                       │
                                     activity ──▶ queues ──▶ reactions: Today, timelines, workflows, agents
```

- **Projects and their components:** the business unit and the parts that ship separately. Every
  record carries the scope keys (`concept/Foundation.md`, "Scope"), so one filter bar works in every
  module.
- **Signals, records, activity:** the three shapes of all data, each with its own store and rules.
  A write to a record emits activity; activity feeds timelines, Today, workflows, webhooks, agents,
  and the audit log.
- **Engines and modules:** an engine is a shared product capability (Actions and policy, Audiences,
  Manifest, Ledger, ...); a module is a page in the sidebar built on them. A new module works with
  all others from its first day because it uses the same scope, activity, and actions.
- **The SDK:** what runs in founders' apps. Shipped builds live for years, so it and the manifest it
  reads only grow.

### Principles that shape the structure

These come from the vision; each one is a reason for a rule below.

- **One API for people and agents.** The dashboard, the CLI, and MCP use the same queries and
  actions, so every number has one definition. There is no private API for our own clients.
- **Each change is an action.** Every write goes through the action layer: actor, class, target,
  before and after, reason, result, undo, and the policy that allowed it. Agents get no other path.
- **Cluenori governs, agents execute.** Credentials and APIs enforce what an agent may do; its
  instructions don't.
- **Evidence shows its coverage.** Every answer carries its population, period, freshness, and gaps.
  Unknown is a value; it never becomes zero.
- **You own the code and the data.** Everything runs in one Cloudflare account and keeps data in
  open formats. A founder deploys it with one command.

## Layers

Each level is changed by reading it and the contracts of the level beneath, never more.

```
hosts         apps/worker, apps/cli, apps/dashboard   translate: HTTP, MCP, queues, cron, the command line, the browser
                    │
product       product/modules/<module>                pages: Releases, Flags, Feedback, ...
                    │
              product/engines/<engine>                shared product capabilities: Actions, Audiences, Manifest, Ledger, ...
                    │
              product/foundation                      scope keys, envelope, activity, the module contract
                    │
capabilities  packages/<capability>                   general: @bagatka/<capability>, no Cluenori in them
                    │
platform      effect, Cloudflare                      the standard library and the runtime
```

- **A capability is general and deep.** It knows nothing of Cluenori (projects, features, people),
  hides much behind a small contract, runs on any runtime with web standards (Workers, Bun, Node,
  browsers) unless its name says otherwise (`@bagatka/cloudflare-<x>`), and is tested on its own.
  Another product could use it with glue of its own. Examples it will likely hold: APNs and Web Push
  senders, exact money with currencies, stable hash bucketing, an OTLP decoder, vendor clients.
- **Foundation is the shared product model.** The concepts every module uses: the scope keys and
  feature keys, the envelope, activity, and the shapes of the module contract (`defineModule`,
  queries, actions). It holds what is expensive to change later (`concept/Foundation.md`, "What
  version 1 must get right"), and nothing else.
- **An engine is a shared product capability.** It owns its state and rules and offers a service
  that modules use; a module never builds its own copy. Engines ship with the first module that needs
  them. An engine that also has a page, such as Audiences, defines that module in its own package.
- **A module is a page and its records.** It is defined with `defineModule`, reads and writes only
  its own tables, uses engines, and reacts to activity. Nothing depends on a module except the host
  that lists it.
- **A host translates.** `apps/worker` maps HTTP, MCP, queue messages, and cron to contracts and
  back, and composes the layers; it holds no rules of its own. `apps/cli` and `apps/dashboard` are
  clients of the public API.

## Naming rule

`@bagatka/*` is general-purpose: it never imports `@cluenori/*` and could serve another product
unchanged. `@cluenori/*` belongs to this product. The folder says the same thing as the name:
`packages/` is general, `product/` is Cluenori, `apps/` are hosts, `sdks/` run in founders' apps.
The name tells you which rules apply before you open the package.

## Repository layout

```
AGENTS.md, ARCHITECTURE.md, PATTERNS.md, GLOSSARY.md, README.md
concept/                       the product: vision, foundation, modules, platform
flake.nix, flake.lock          the pinned toolchain
dev, run, setup, update        entry points: check Nix, enter the toolchain, run a program in apps/cli
package.json                   workspaces, scripts, and the catalog: the one exact version of every dependency
bun.lock, bunfig.toml          the lockfile; isolated installs
tsconfig.base.json             compiler settings and Effect diagnostics every package extends
.oxlintrc.json                 lint rules; every rule turned off has its reason
.oxfmtrc.json                  formatting
vitest.config.ts               every package's tests, run as one
docs/templates/                package-readme.md
packages/
  <capability>/                @bagatka/<capability>
    package.json               exports: { ".": "./src/index.ts" }; scripts: { "typecheck": "tsc" }
    tsconfig.json              extends tsconfig.base.json
    vitest.config.ts           when it has tests
    README.md                  the package's map
    src/index.ts               the contract: the only file other packages import
    src/                       everything else, private
    test/
  workspace-rules/             @bagatka/workspace-rules: checks packages' names, entries, and dependencies
product/
  foundation/                  @cluenori/foundation
  engines/<engine>/            @cluenori/<engine>
  modules/<module>/            @cluenori/<module>
apps/
  worker/                      @cluenori/worker: the deployable Worker and composition root
    wrangler.jsonc
    openapi.json               generated from the API definition by `bun run generate`
  cli/                         @cluenori/cli: the `cluenori` command
  dashboard/                   @cluenori/dashboard: the web app, served as the Worker's static assets
sdks/
  web/                         @cluenori/sdk: browsers and JavaScript backends (MIT)
tests/
  journeys/                    the real Worker through its public API
```

Every package has the same shape: `package.json`, `tsconfig.json`, `README.md`, `src/index.ts`,
`src/`, `test/`. Hosts and test suites that nothing imports (`apps/cli`, `apps/dashboard`,
`tests/journeys`) have no contract: no `exports` and no `src/index.ts`.

## Parts

| Part | Package | Purpose | Status |
|---|---|---|---|
| Worker | `apps/worker` | The one deployable Worker and composition root: the public API and MCP, ingest, the manifest, queue consumers, cron, Durable Object and Workflow classes, the dashboard's files | Built: serves the API's health check and its OpenAPI document |
| CLI | `apps/cli` | `cluenori`: run, setup, update, and the repository's check and generate; later `project create` and `add module` | Built |
| Dashboard | `apps/dashboard` | The web app over the public API | Planned; its UI stack is decided with its first page |
| Foundation | `product/foundation` | Scope keys, feature keys, the envelope, activity, the module contract | Planned; the first product package. Creating it adds `product/foundation` to the root workspaces, which Bun refuses to list while the folder doesn't exist |
| Engines | `product/engines/<engine>` | Actions and policy first, then each engine with the first module that needs it (`concept/Foundation.md`, "Shared engines") | Planned |
| Modules | `product/modules/<module>` | The catalog and phases in `concept/Modules.md` | Planned |
| Capabilities | `packages/<capability>` | General-purpose packages, added when an engine or module needs one | `workspace-rules` built, for the architecture check |
| Web SDK | `sdks/web` | Init, identify, consent, track, feature, flags, and the client kit views, for browsers and JavaScript backends | Planned |
| Journeys | `tests/journeys` | The Worker in workerd, through its public API | Built: the deployment journey |

## Dependency rules

| Package | May import | Must not import |
|---|---|---|
| `@bagatka/*` | `effect`, other `@bagatka/*` (no cycles), approved dependencies; Cloudflare's runtime types only when its name says `cloudflare` | `@cluenori/*`; Bun, Node, or DOM APIs |
| `@cluenori/foundation` | `effect`, `@bagatka/*` | engines, modules, hosts |
| Engine | foundation, other engines (no cycles), `@bagatka/*`, `effect` | modules, hosts |
| Module | foundation, engines, `@bagatka/*`, `effect` | other modules, hosts |
| `apps/worker` | everything above, `@effect/sql-*` drivers, Cloudflare packages | — |
| `apps/cli`, `apps/dashboard` | `apps/worker`, whose contract is only the public API definition; `@bagatka/*`, `effect`; the CLI also `@effect/platform-bun` | engine and module implementations |
| `@cluenori/sdk` | `@bagatka/*`, `effect`, the API definition of what it calls | server packages |
| Package tests | the package they test, `@effect/vitest`, Vitest | other packages' private files |
| `tests/journeys` | `apps/worker`, `effect`, `@cloudflare/vitest-plugin`, Wrangler, Vitest | the Worker's private files |

- A module reaches another module only through activity and its declared actions, never by
  importing it. Reacting to activity is the sanctioned reverse direction, as it is between engines.
- Only `src/index.ts` is importable; a deep import doesn't resolve.
- The architecture check fails on any edge this table doesn't allow, and on a package whose folder
  and name disagree. It reads this table as data from `apps/cli/src/dependency-rules.ts`; a change
  updates both.

## Runtime on Cloudflare

- **One Worker, one deployment.** A modular monolith: every engine and module is part of the same
  Worker and deploys with it, composed in-process; work on a project's records runs inside that
  project's Durable Object (below). Its entry points are the ones the platform defines: `fetch` (the
  API, MCP, ingest, the manifest, the dashboard's files), `queue`, `scheduled`, and the exported
  Durable Object and Workflow classes.
- **The runtime is built once per isolate.** The Worker builds its layers once and reuses them for
  every request; it never builds them per request. Promises appear only where the platform calls
  us, and become Effects on the first line.
- **Each project is a Durable Object.** Its records live in the SQLite database of its own Durable
  Object, and the engine and module code that reads and writes them runs inside that object, so a
  write and its activity commit in one transaction. The Worker routes each query and action to the
  object by project key. The workspace has one object of its own. A question across projects reads
  summaries that activity keeps current in the workspace, never every project live.
- **Where each shape lives** (from `concept/Foundation.md`; how long each is kept is in
  `concept/Modules.md`, "Data sources"):

  | Shape | Store | Owner |
  |---|---|---|
  | Records | SQLite in a Durable Object: one per project, one for the workspace | The engine or module that owns the table |
  | Activity | Committed with its record, delivered through Queues, archived to R2 | Foundation |
  | Signals: counters | Analytics Engine, no person IDs, added up for each batch at ingest | Ingest writes, the Query engine reads |
  | Signals: lake | Basin Pipelines into R2 as Iceberg: product events, requests, kept traces, logs | Ingest writes, the Query engine reads |
  | Exact counts, duplicate window | Durable Objects | Ingest |
  | Durable steps | Cloudflare Workflows | The workflows engine |
  | Media, uploads, symbol files | R2 | Content; symbol files, Errors |

- **Background work has an owner.** Every queue consumer, cron trigger, alarm, and workflow is owned
  by one engine or module and listed on a visible line in `apps/worker`. Every handler is
  idempotent, because delivery is at least once.
- **Production runs in workerd.** Bun installs packages and runs repository programs; Node runs
  Wrangler. Nothing that deploys may use a Bun or Node API.

## Data

- Each engine and module owns its tables, reached only through its own code and changed only by its
  own migrations.
- No package reads another package's tables. There are no cross-package joins, foreign keys, or
  transactions. Packages store other packages' IDs as plain values and learn about changes through
  activity.
- A write and its activity commit together, in one transaction in the project's object. An alarm
  in that object delivers activity to Queues after the commit, at least once.
- Personal data follows `concept/Foundation.md` and `concept/Platform.md`: no person IDs in
  Analytics Engine, a pseudonymous ID in the lake with the mapping in SQL, and every module can
  export and delete one person's data.
- The jurisdiction (global or EU) is chosen once, at setup, because a store's jurisdiction can't
  change after it is made. Local runs use none: workerd doesn't implement jurisdictions.
- Backends send OpenTelemetry traces and logs, not metrics (yet). Ingest turns each request's trace
  into one row, counts it, and keeps the full trace only for failed, slow, and sampled requests
  (`concept/Modules.md`, "Performance, errors and logs").

## Communication

**Ask synchronously, commit once, react asynchronously.**

- **Ask:** an action or query may call an engine's service to read what it needs.
- **Commit once:** an action writes only its own package's tables, with their activity, in one
  commit.
- **React:** consequences elsewhere happen through activity, delivered by Queues to the engines and
  modules that react to it.

Every action carries an actor: a person, an agent run, or a named system process. When acting for a
person or an agent run, pass that actor along; reactions and jobs use a named system actor.

## Trust boundaries

From `concept/`; each gets its pattern when it is built.

- **SDK keys** are public, one per component, and allow only ingest and the manifest.
- **The dashboard** sits behind Cloudflare Access when self-hosted.
- **Agents** get a scoped key or an OIDC token per run: one project, read-only unless policy grants
  more, within a spend limit.
- **Webhooks** are verified with their signature before anything reads them.
- **Untrusted text** (logs, feedback, reviews, webhook bodies) is evidence, never instructions. A run
  that reads it gets only read and draft tools.

## Toolchain and entry points

- **Nix pins the toolchain:** Bun, Node 24 (Wrangler requires Node 22 or later), and Git. Wrangler,
  TypeScript, and everything else come from `bun.lock`, so every machine uses the same versions.
- **Four entry points, one command each:**
  - `./dev` opens the pinned shell.
  - `./run` runs Cluenori on this computer, with local Durable Objects, R2, and Queues.
  - `./setup` deploys it to your Cloudflare account: signs in with Wrangler and deploys. With the
    first store and the SDK it also asks once for global or EU data, creates what Wrangler can't
    create on deploy, and prints the SDK keys.
  - `./update` pulls the new version (fast-forward only: a clone with commits of its own is left for
    its owner to merge), installs it, and deploys. With the first tables it also wakes every
    project's object, so each one migrates and a failed migration shows during the update.
- **Scripts are trampolines.** Each is a few lines of POSIX shell that checks for Nix and runs a
  program in `apps/cli`. Logic lives in TypeScript, where it is typed and tested, not in shell.
- **Deploying needs few manual resources.** Durable Objects need no creating, and Wrangler 4
  creates R2 and KV resources on deploy when their bindings have no ID. Setup creates the rest, and anything with a jurisdiction.

## Enforcement

The tools do most of the work, and `bun run check` runs all of them.

- **Bun's isolated installs:** a package can import only what its own `package.json` declares, so an
  undeclared dependency doesn't resolve. The one gap is the root's own dependencies, which resolve
  from every package; the root declares only command-line tools, and Vitest, which every package
  with tests declares too.
- **Package `exports`:** only `src/index.ts` is importable from outside a package.
- **The architecture check,** `cluenori check` on `@bagatka/workspace-rules`, reads every
  `package.json` and fails on a dependency the rules above don't allow, a wrong name or entry, a
  version outside the catalog, or a cycle. It also refuses comments that silence the compiler or the
  linter, and an OpenAPI document that is out of date.
- **TypeScript 7, strict,** with `@effect/tsgo`. Effect's diagnostics fail the build: floating
  Effects, missing services and errors, leaking requirements, Effect 3 APIs, and platform globals
  (`Date`, `Math.random`, `fetch`, `console`, timers, `process.env`, `async`, `new Promise`).
  Capabilities compile without DOM, Node, or Bun types, so those APIs don't exist for them.
- **Oxlint,** type-aware, for what the compiler doesn't check, and **Oxfmt** for formatting.
- **One catalog** of exact versions in the root `package.json`.

## Deliberate decisions

These are choices, not omissions. Change them only through `PATTERNS.md`, with a migration path.

- **Modular monolith in one Worker.** In-process contracts already give the boundaries; a second
  Worker costs latency, partial failure, and deploy coordination. Split one out only for a measured
  reason, such as ingest volume.
- **Effect everywhere, one async model.** No `async`/`await` and no Promise chains in our code;
  Promises exist only where the platform calls us. Errors are values in the error channel; defects
  are for bugs and infrastructure failures.
- **Layers are the only dependency injection.** No container, no decorators, no service locator.
- **One `HttpApi` definition is the API.** The Worker serves it, MCP tools and TypeScript clients
  derive from it, and the generated OpenAPI document is committed so that every API change shows in
  review.
- **Records live in SQLite Durable Objects, one per project.** A spike (October 2026) compared them
  with one D1 database per project. D1 bindings are fixed in the Worker's configuration, so a
  database made for a new project needs a redeploy; Effect's D1 driver has no transactions, only
  batches of statements fixed in advance, and Effect's migrator can't run on it. A Durable Object
  is made by name on first use, commits with transactions, migrates itself with Effect's migrator,
  and takes the EU jurisdiction for each object. Both cap a database at 10 GB with one writer, which
  suits records: about 1 to 2 GB a year for a busy project, since signals live elsewhere. The
  costs: each project answers from one location (the SDK uses its last manifest, so app starts
  don't wait), questions across projects read summaries, and D1's console and export give way to
  Cloudflare's Data Studio and each module's export.
- **SQL directly, through `effect/sql`.** Parameterized tagged templates and Schema-decoded rows; no
  ORM and no query builder.
- **No mediator and no event bus.** Callers call services; activity on Queues is the only
  asynchronous channel.
- **Bun manages packages; workerd runs production.** Bun is fast and runs TypeScript directly, which
  suits the repository's programs. It is never the deployed runtime, and `bun test` isn't used,
  because it can't run code in workerd.
- **Exact versions in one catalog.** Several Effect modules we use are marked unstable, so upgrades
  are deliberate changes, never drift.
- **Packages are TypeScript source inside the repository.** A package that is published gets a
  build step for JavaScript and declarations; nothing inside the repository consumes built output.
- **Erasable TypeScript only.** No `enum`, `namespace`, or parameter properties: closed sets are
  literal unions and tagged unions, so code runs under type stripping and reads the same everywhere.

## Open decisions

Each needs evidence or a product choice before the code that depends on it.

1. **The dashboard's UI stack.** Decided with its first page. `effect/reactivity` can derive its data
   layer from the same `HttpApi` definition.
2. **Where the Swift and Kotlin SDKs live.** Swift Package Manager expects a package at a
   repository's root, which argues for their own repositories.
3. **Who owns ingest.** `concept/` lists twelve engines, and none of them writes signals: catalog
   rules, the duplicate window, counters, and the lake. Ingest is either its own engine or the
   write side of the Query engine. Decide with the first signal.
4. **How clients import the API definition.** The dashboard, the CLI, and the SDK need the
   `HttpApi` definition, but not the server code that sits beside it in an engine's or module's
   `src/index.ts`. Either each such package gets a second entry, `./api`, with only its definition
   (the one exception to "one entry"), or one `@cluenori/api` package holds every definition.
   Effect's own guide to `HttpApi` keeps definitions apart from server code, ideally in a package of
   their own. Today `CluenoriApi` lives in `apps/worker`, whose contract is only that definition.
   Decide with the first module, by checking what reaches the dashboard's bundle.
5. **Publishing.** The build for published packages (TypeScript's own emit or a bundler), the
   versioning tool, and the npm scope and license of `@bagatka/*` (assumed MIT, like the SDKs).

## Module map

Keep this current. Any change that adds, removes, splits, merges, or re-wires an engine or module
updates this table in the same change.

| Package | Kind | Owns | Uses | Reacts to |
|---|---|---|---|---|
| — | | | | |
