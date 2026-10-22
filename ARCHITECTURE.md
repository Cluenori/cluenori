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
founders' apps (SDK), services (OpenTelemetry) ──signals──▶ ingest ──▶ counts, lake
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
hosts         apps/worker, apps/cli, apps/dashboard,  translate: HTTP, MCP, queues, cron, the command line, the browser,
              apps/ios                                the iPhone
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
cluenori                       the cluenori command: projects, components, and questions about them
cluenori-release               reports a deploy from any CI: git and curl, the one file founders copy
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
  web-crypto/                  @bagatka/web-crypto: Effect's Crypto service on the Web Crypto API
  otlp/                        @bagatka/otlp: reads OTLP/HTTP protobuf exports
  quantile-sketch/             @bagatka/quantile-sketch: percentiles from small mergeable sketches
  scrub/                       @bagatka/scrub: removes credentials and personal data from text
  qr-code/                     @bagatka/qr-code: encodes text as a QR code, drawn as SVG path data
  openapi-swift/               @bagatka/openapi-swift: writes a typed Swift client from an OpenAPI document
  es256-jwt/                   @bagatka/es256-jwt: signs JSON Web Tokens with ES256 keys, such as Apple's
  rs256-jwt/                   @bagatka/rs256-jwt: signs JSON Web Tokens with RS256 keys, such as a GitHub App's
  apns/                        @bagatka/apns: sends pushes to Apple devices through APNs
  app-store-connect/           @bagatka/app-store-connect: apps' builds and App Store versions; submits, releases, What to Test
  cloudflare-workers-ai/       @bagatka/cloudflare-workers-ai: effect/ai's LanguageModel on Cloudflare Workers AI
  github/                      @bagatka/github: a repository's tags, commits, changes and workflows, with a token or as a GitHub App
  webauthn/                    @bagatka/webauthn: makes and checks passkeys
product/
  foundation/                  @cluenori/foundation
  engines/<engine>/            @cluenori/<engine>: projects, signals, manifest, incidents, phones, today, notifications, members, github
  modules/<module>/            @cluenori/<module>: releases, analytics
apps/
  worker/                      @cluenori/worker: the deployable Worker and composition root
    wrangler.jsonc
    openapi.json               generated from the API definition by `bun run generate`
  cli/                         @cluenori/cli: the `cluenori` command
  dashboard/                   @cluenori/dashboard: the web app, served as the Worker's static assets
  ios/                         the iPhone app: a small Xcode project, and its Swift package CluenoriApp
    CluenoriApp/Sources/CluenoriClient/CluenoriAPI.swift   generated from the API definition
    CluenoriAlerts/            the notification extension, which rings alarms
sdks/
  web/                         @cluenori/sdk: browsers and JavaScript backends (MIT)
  swift/                       the Swift SDK for Apple's platforms (MIT): a Swift package, no workspace package
    openapi.json, Sources/CluenoriIngest/CluenoriIngestAPI.swift   generated from the ingest API's definition
tests/
  journeys/                    the real Worker through its public API
```

Every package has the same shape: `package.json`, `tsconfig.json`, `README.md`, `src/index.ts`,
`src/`, `test/`. Hosts and test suites that nothing imports (`apps/cli`, `apps/dashboard`,
`tests/journeys`) have no contract: no `exports` and no `src/index.ts`. The iPhone app is Swift
(`apps/ios`, its README): its layers are the targets of one Swift package, checked by
`bun run check:ios` on a Mac with Xcode.

## Parts

| Part | Package | Purpose | Status |
|---|---|---|---|
| Worker | `apps/worker` | The one deployable Worker and composition root: the public API and MCP, ingest, the manifest, queue consumers, cron, Durable Object and Workflow classes, the dashboard's files | Built: the public API behind an API token, or a browser's sign-in (projects, components, operations, their load, errors and logs over time, kept traces, logs, traces, incidents and monitors, Today across projects, phones, each calling with its own key, and GitHub's connection; and the Releases module's routes, its queries and its action), GitHub's return when an owner connects it (`/api/github/connected`), OTLP ingest of traces, logs and metrics, the ingest API apps' SDKs call with a component's SDK key (`CluenoriIngestApi`: batches of their signals, limited per key and per installation, and the manifest, kept at the edge five minutes), modules' ingest writes with a component's key (`/ingest/v1/<module>/<name>`, such as deploy reports), the archive in R2, each project's Durable Object and the workspace's, apps' batches in R2, the project's alarm that runs its detectors every minute and delivers its activity to the activity queue, the queue's consumer that hands it to the workspace's notifications, and the dashboard's files |
| CLI | `apps/cli` | `cluenori`: run, setup, update, projects and components, questions about them, and the repository's check and generate | Built |
| Dashboard | `apps/dashboard` | The web app over the public API | Built: served by the Worker, signed in with a passkey or the API token; members, invitations and the browsers signed in; reads the public API for a project's overview, its performance, operations, errors, logs and releases by component, and a trace; the views waiting for app data are in its design kit, on sample data |
| iPhone app | `apps/ios` | Cluenori on the founder's iPhone, from TestFlight: near the web's parity, and where alerts reach them | Built: pairing by the web's QR code or a passkey, the phone's key in the Keychain, Today, and each project's incidents, load, operations, errors, logs and releases, and its delivery, what release is in each environment with its one next step, every screen kept for offline; alerts: the push token registered with the phone's key, an alarm through silent mode from its notification extension, Acknowledge on the alarm and the notification, and a test alarm |
| Foundation | `product/foundation` | Scope keys, feature keys, the envelope, activity, the module contract | Built: the keys, IDs and names, the envelope, actors, `ActivityLog`, which commits a write with its activity and delivers it, at least once, and the module contract's first part, `defineModule`: a module's ID, scope, queries and their routes |
| Engines | `product/engines/<engine>` | Shared product capabilities, each with the first module or slice that needs it (`concept/Foundation.md`, "Shared engines") | Built: `projects` (projects, components, ingest keys and SDK keys, components' links to their repository and App Store app, and each project's production environments) and `signals` (the archive, operation counts by release, kept traces, warnings and errors, error groups, traces; and apps' signals: people and installations, activity, sessions and measures by day and release, retention, timelines, apps' batches archived), `manifest` (the manifest's contract, which the Worker composes), `incidents` (detectors, incidents, monitors), `phones` (pairing, phone keys, last seen, push tokens), `today` (what needs attention now, across projects), `notifications` (alerts on phones), `members` (members, what each sees, passkeys and sign-ins), and `github` (the workspace's GitHub App, connected from the web, and tokens that act as it in projects); the first action, Releases' promote, is served for the members who see the project, and the rest of Actions and policy come with the first action that needs each |
| Modules | `product/modules/<module>` | The catalog and phases in `concept/Modules.md` | Built: `releases`, each component's releases from its telemetry, its CI's deploy reports and App Store Connect, each compared with the release before it, with its commit and changes from GitHub; each build numbered by the component's version, so a number is one commit; releases promoted by their deploy targets, through a workflow and on through App Store review; and release notes the project's language model drafts; and each app component's version policy, which the manifest serves. `analytics`, apps' usage, retention, each release's app health beside the release before it, features, and one person, from Signals. The rest planned |
| Capabilities | `packages/<capability>` | General-purpose packages, added when an engine or module needs one | Built: `workspace-rules`, for the architecture check; `web-crypto`, for `Crypto` in workerd; `otlp`, for OpenTelemetry exports; `quantile-sketch`, for percentiles; `scrub`, to remove secrets and personal data; `qr-code`, for the links phones pair by; `openapi-swift`, for the iOS app's API client; `es256-jwt`, for tokens signed with Apple's keys; `rs256-jwt`, for tokens signed with a GitHub App's key; `apns`, for pushes to phones; `app-store-connect`, for apps' builds and App Store versions, submitting them for review and releasing them; `cloudflare-workers-ai`, for the language model that drafts release notes; `github`, for releases' commits, tags and changes, workflows started and followed, organizations' self-hosted runners, and a GitHub App's installations and tokens; `webauthn`, for passkeys |
| Web SDK | `sdks/web` | Init, identify, consent, track, feature, flags, and the client kit views, for browsers and JavaScript backends | Planned |
| Swift SDK | `sdks/swift` | The SDK in founders' iPhone apps: a core every app links (installation, sessions, identify, consent, the feature in effect, the manifest and the update gate's decision, the queue that sends to ingest, and the release and trace headers for the app's own API), and opt-in libraries where including one has a cost: `CluenoriAnalytics` (events and screens), `CluenoriPerformance` (launches, memory, MetricKit), `CluenoriUpdateGate` (the gate's views) | Built, not yet in an app; published as `Cluenori/cluenori-swift`, a read-only mirror (its README) |
| Journeys | `tests/journeys` | The Worker in workerd, through its public API | Built: the deployment and telemetry journeys |

## Dependency rules

| Package | May import | Must not import |
|---|---|---|
| `@bagatka/*` | `effect`, other `@bagatka/*` (no cycles), approved dependencies; Cloudflare's runtime types only when its name says `cloudflare` | `@cluenori/*`; Bun, Node, or DOM APIs |
| `@cluenori/foundation` | `effect`, `@bagatka/*` | engines, modules, hosts |
| Engine | foundation, other engines (no cycles), `@bagatka/*`, `effect` | modules, hosts |
| Module | foundation, engines, `@bagatka/*`, `effect` | other modules, hosts |
| `apps/worker` | everything above, `@effect/sql-*` drivers, Cloudflare packages | — |
| `apps/cli`, `apps/dashboard` | `apps/worker`, whose contract is only the public API definition; foundation's, engines' and modules' contracts, for the Schemas of what they send (open decision: "How clients import the API definition"); `@bagatka/*`, `effect`; the CLI also `@effect/platform-bun`; the dashboard also React, Vite, Tailwind CSS, and the libraries of shadcn/ui's views, and for its build and tests React Compiler, Playwright, and axe (its README) | engine and module implementations |
| `apps/ios` | Its own layers, each only the one beneath: the app's Xcode target, `CluenoriViews` (SwiftUI), `CluenoriScreens` (Observation), `CluenoriClient` (Foundation); Apple's SDKs, no third-party code. The API's contract only as `CluenoriAPI.swift`, generated from it | Apple-only frameworks in `CluenoriClient` and `CluenoriScreens`, which build on Linux too |
| `@cluenori/sdk` | `@bagatka/*`, `effect`, the API definition of what it calls | server packages |
| `sdks/swift` | Its own libraries, each only the core beneath it, and the core only `CluenoriIngest`; Apple's SDKs, no third-party code. The ingest API's contract only as `CluenoriIngestAPI.swift`, generated from it; `CluenoriIngest` imports Foundation alone. Checked by `bun run check:sdk-swift`: it isn't a workspace package, so the architecture check doesn't read it | third-party code, server packages, anything else in this repository |
| Package tests | the package they test, `@effect/vitest`, Vitest; product packages also `@cloudflare/vitest-plugin`, Wrangler, and `@effect/sql-sqlite-do`, to run inside a Durable Object | other packages' private files |
| `tests/journeys` | `apps/worker`, foundation's, engines' and modules' contracts, `@bagatka/*`, for what a journey plays a client with (a passkey's authenticator), `effect`, `@cloudflare/vitest-plugin`, Wrangler, Vitest | the Worker's private files |

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
  | Signals: counts | SQLite in each project's Durable Object: operations counted by name and environment, with a quantile sketch of their durations, by the minute for 14 days and by the hour for 15 months; no person IDs | Signals: added up where an export arrives, recorded by the project's object |
  | Signals: archive | Every export as received, with secrets and personal data removed, as gzip OTLP protobuf in R2 (`cluenori-archive`), kept 90 days by the bucket's lifecycle rule; indexed by time in the project's object | Signals |
  | Signals: warnings and errors | SQLite in each project's Durable Object, searchable, 90 days; errors grouped by type and stack, groups kept 15 months | Signals |
  | Signals: duplicate window | The digest of each export, kept an hour in the project's object | Signals |
  | Signals: apps' counts | SQLite in each project's Durable Object: by UTC day, release and feature, who was active on which installation, sessions, feature use, launch and memory sketches, MetricKit's diagnostics, 15 months; people, their user IDs and installations; each person's first day; sessions 90 days; each person's latest 1,000 signals | Signals: `AppSignals` |
  | Signals: apps' batches | Each batch's new signals as received, scrubbed, each with its person instead of the app's user ID, as gzip JSON in R2 (`cluenori-app-batches`), kept 5 years by the bucket's lifecycle rule, as product events are | Signals |
  | Signals: apps' duplicate window | The ID of each signal of the last 14 days, by its own time | Signals |
  | Signals: lake | Planned: SQL over long periods, built from the archive and apps' batches | Signals |
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
- Personal data follows `concept/Foundation.md` and `concept/Platform.md`: no person IDs in counts,
  a pseudonymous ID in the lake with the mapping in SQL, and every module can export and delete one
  person's data.
- The jurisdiction (global or EU) is chosen once, at setup, because a store's jurisdiction can't
  change after it is made. Local runs use none: workerd doesn't implement jurisdictions.
- Backends send OpenTelemetry traces and logs, not metrics (yet). Ingest counts each operation
  from its span, and keeps the full trace only for failed, slow, and sampled ones
  (`concept/Modules.md`, "Performance, errors and logs").

## Communication

**Ask synchronously, commit once, react asynchronously.**

- **Ask:** an action or query may call an engine's service to read what it needs.
- **Commit once:** an action writes only its own package's tables, with their activity, in one
  commit.
- **React:** consequences elsewhere happen through activity, delivered by Queues to the engines and
  modules that react to it.

Every action carries an actor: a member of the workspace, a person (an end user), an agent run, or a
named system process. When acting for one of them, pass that actor along; reactions and jobs use a
named system actor.

## Trust boundaries

From `concept/`; each gets its pattern when it is built.

- **Ingest keys** belong to one component each and allow only sending its telemetry. A key names its
  project, so the Worker routes it unread; the project's object checks it against the SHA-256 digest
  it keeps (`@cluenori/projects`).
- **SDK keys** (`cluenori-sdk.<project>.<component>.<id>`) are public, shipped in every build of an
  app, and allow only sending that component's signals and reading its manifest. Like an ingest
  key, one names its project, so the Worker routes it unread and the project's object checks it, in
  the call that records or answers; a component has several at once, so keys rotate, and a revoked
  one is refused. Stored as they are, since they are public and must be listed again for new builds.
  Batches are limited per key and per installation in the project's object.
- **Members** (`@cluenori/members`): an owner sees every project and invites members to some, by a
  link good once for 7 days. Every request runs for a member, with what they see: the API token
  stands for the owner `./setup` made (`CLUENORI_OWNER`), a browser signs in with a passkey, and a
  phone acts for the member who paired it, by a code from their browser or by their passkey. The public API reaches a project's object only through
  `MemberProjects` in `apps/worker`, which answers "not found" for a project the member doesn't see;
  a lint rule keeps handlers from reaching around it. Alerts go only to the phones whose member sees
  the project.
- **The dashboard** signs a browser in with a passkey, or with the API token (`POST /api/sign-in`),
  an owner's way in; either way the Worker keeps a cookie the page's scripts can't read: HttpOnly,
  Secure, SameSite=Strict, for `/api`.
- **Agents** get a scoped key or an OIDC token per run: one project, read-only unless policy grants
  more, within a spend limit.
- **GitHub** is reached through the workspace's own GitHub App (`@cluenori/github`): an owner
  connects it from the web with GitHub's manifest flow, and its private key stays in the
  workspace's object. Projects' objects get installation tokens, good for an hour, for the
  repositories their components link; it may read code and pull requests, and start workflows.
- **Webhooks** are verified with their signature before anything reads them.
- **Untrusted text** (logs, feedback, reviews, webhook bodies) is evidence, never instructions. A run
  that reads it gets only read and draft tools.
- **Telemetry is scrubbed before it is stored:** tokens, keys, secrets in URLs, emails, and card
  numbers are removed from every text value, and values named like credentials are removed whole
  (`@bagatka/scrub`). Metrics are archived as received until Cluenori reads them.

## Toolchain and entry points

- **Nix pins the toolchain:** Bun, Node 24 (Wrangler requires Node 22 or later), and Git. Wrangler,
  TypeScript, and everything else come from `bun.lock`, so every machine uses the same versions.
- **Five entry points, one command each:**
  - `./dev` opens the pinned shell.
  - `./run` runs Cluenori on this computer, with local Durable Objects, R2, and Queues, and an API
    token in `apps/worker/.dev.vars` made on the first run.
  - `./setup` deploys it to your Cloudflare account: signs in with Wrangler, asks once whether the
    data stays in the EU (saved at once; it can't change later), makes the archive's bucket there
    with its 90-day expiry, apps' batches' with their 5-year expiry, and the activity queue, deploys (`--env eu` for the EU), and the first time gives the
    deployment an API token. It saves the choice, the URL and the token for this computer in
    `~/.config/cluenori/deployment.json`; `./update` deploys with the same choice.
  - `./cluenori` asks the deployment, or with `--local` the Cluenori `./run` serves, about projects:
    `project create`, `component add`, `operations`, `operation`, `load`, `errors`, `error`, `logs`, `trace`.
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
- **Every export is archived, and views are derived from it** (October 2026). Data that was never
  stored can't be had later, while storage can be cut: so every export is kept 90 days, scrubbed,
  in R2, and what is asked about often (counts, warnings and errors, error groups) is derived from
  it at ingest. A new view can be built from data that arrived before it. A million log records a
  day cost about 9 GB, around $0.13 a month; R2 writes, one per export, cost more, and can be
  batched per minute if they matter.
- **Counts live in each project's Durable Object, not Analytics Engine** (October 2026). A spike
  found that locally Analytics Engine keeps nothing and nothing answers its SQL, so charts couldn't
  work under `./run` or in tests. Counting in the project's own SQLite works the same everywhere,
  exactly rather than sampled, and can be deleted. Counts are kept by the minute for 14 days, for
  incidents, and by the hour for 15 months, for trends, as CloudWatch does; both are written as an
  export arrives, so they always agree. It costs one writer per project, which a founder's traffic
  is far below, and SQLite row writes: two per operation and environment in each export, about 20
  million a month for a service with a million operations a day (50 million are included per
  account). Rolling hours up from minutes in an alarm would halve that, at the cost of tracking
  late data; a project that outgrows either can count in Analytics Engine behind the same `Signals`
  contract.
- **Apps' batches are kept 5 years, in a bucket of their own** (October 2026). They are the product
  events, which `concept/Platform.md` keeps 5 years, while exports are diagnostic evidence kept 90
  days; two buckets let each keep a lifecycle rule. What is counted of them by day lives in the
  project's object 15 months, as hourly counts do, with people counted exactly from one row per
  installation and day; older questions will read the lake.
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

1. **The dashboard's UI stack.** Being tried in a prototype (October 2026): React 19, Vite 8,
   Tailwind CSS 4, and shadcn/ui on Base UI; its charts are our own views, Recharts only in the
   design kit. Decide once the look is settled. The pages read the API (October 2026) through
   `effect/reactivity`'s atoms on the client derived from the `HttpApi` definition; the first load
   is 241 KB of scripts, compressed, about 75 KB of it that client, and a page shown a moment ago
   shows again without asking.
2. **Where the Swift and Kotlin SDKs live.** Swift Package Manager expects a package at a
   repository's root, which argues for their own repositories.
3. **How clients import the API definition.** The dashboard, the CLI, and the SDK need the
   `HttpApi` definition, but not the server code that sits beside it in an engine's or module's
   `src/index.ts`. Either each such package gets a second entry, `./api`, with only its definition
   (the one exception to "one entry"), or one `@cluenori/api` package holds every definition.
   Effect's own guide to `HttpApi` keeps definitions apart from server code, ideally in a package of
   their own. Today `CluenoriApi` lives in `apps/worker`, and the CLI and journeys also depend on
   foundation's and engines' contracts for the Schemas of what they send. Checked with the
   dashboard (October 2026): with every package side-effect free and an API's schemas in modules of
   their own, apart from server code, only the definitions reach its bundle, with no second entry.
   Nothing checks that yet beyond the first-load budget. Decide with the first module.
4. **The lake: SQL over long periods.** The archive keeps everything 90 days, but questions such as
   "every info log mentioning X this month" need SQL over it. Basin Pipelines and R2 SQL would do
   it in production; locally Pipelines' `send` keeps nothing and nothing reads the lake, and a
   Pipelines binding makes Wrangler use the developer's stored login whenever it generates types.
   Converting archive files into Iceberg tables in R2 works the same locally. Decide with the first
   question that needs it.
5. **Publishing.** The build for published packages (TypeScript's own emit or a bundler), the
   versioning tool, and the npm scope and license of `@bagatka/*` (assumed MIT, like the SDKs).

## Module map

Keep this current. Any change that adds, removes, splits, merges, or re-wires an engine or module
updates this table in the same change.

| Package | Kind | Owns | Uses | Reacts to |
|---|---|---|---|---|
| `@cluenori/projects` | Engine | The project of each object, its components, their ingest keys' digests and their SDK keys; the workspace's index of its projects | Foundation's `ActivityLog` | — |
| `@cluenori/signals` | Engine | The archive of every export and its index; operations counted by name and environment; warnings and errors; error groups; the duplicate window; what "slower", "new" and "happening now" mean; apps' signals: people and their user IDs, installations, activity and measures by day, sessions, timelines, apps' batches, and the limits on how much they take | `@bagatka/otlp`, `@bagatka/quantile-sketch`, `@bagatka/scrub`; an `ArchiveStore` and an `AppBatchStore` the host provides; `projects` for its API's errors and SDK keys | — |
| `@cluenori/manifest` | Engine | The manifest's shape and its route: what an app's SDK reads at launch and on resume | Foundation | — |
| `@cluenori/incidents` | Engine | Its project's incidents and monitors; the detectors and what they learn: usual error rates and schedules | `@cluenori/signals`, `@cluenori/projects`; Foundation's `ActivityLog`; an `HttpClient` the host provides, for monitors | — |
| `@cluenori/phones` | Engine | The workspace's paired phones, their keys' digests, when and where each last called, their push tokens, and open pairings; the names of Apple's models | Foundation's `ActivityLog` | — |
| `@cluenori/today` | Engine | Today's detectors and order: what needs attention now in each project, from its incidents and counts | `@cluenori/incidents`, `@cluenori/signals`, `@cluenori/projects` | — |
| `@cluenori/notifications` | Engine | Each alert's level and words; which activity reached which phone | `@cluenori/phones`, `@cluenori/members`, `@cluenori/projects`' index, `@bagatka/apns`; an `HttpClient` the host provides | `incident.*`, from the activity queue |
| `@cluenori/members` | Engine | The workspace's members, what each sees, invitations, passkeys, and browsers' sign-ins | `@cluenori/projects`' index, `@bagatka/webauthn`; Foundation's `ActivityLog` | — |
| `@cluenori/releases` | Module | Releases' commits, changes, store builds, deploys, numbering, promotions and notes; each app component's version policy, and what one release gets from it (`versionPolicyFor`) | `@cluenori/signals`, `@cluenori/projects`, `@cluenori/incidents`, `@cluenori/manifest`'s Schemas; `@bagatka/github`, `@bagatka/app-store-connect` | — |
| `@cluenori/analytics` | Module | Nothing stored: apps' usage, retention, features and people as Signals counts them, and what makes a release's app health worse or better than the release before it's | `@cluenori/signals`, `@cluenori/projects` | — |
