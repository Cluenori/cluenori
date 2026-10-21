# Glossary

One name per concept, used the same way in code, APIs, storage, UI, and conversation.

- Don't introduce synonyms.
- Don't reuse a name for something else.
- Add terms in the same change that introduces them.

Product terms (project, component, origin, environment, release, feature, person, installation,
account, session, trace, operation, idea, signals, records, activity, engines, and the module catalog)
are defined in `concept/Foundation.md` and `concept/Modules.md`. When code implements one, its row moves here.

## Terms the code implements

Each is a Schema or service in the package named (Foundation unless said), whose doc comment holds
its exact rule.

| Term | Meaning | In code | Don't call it |
|---|---|---|---|
| Scope key | A permanent key that places a record: workspace, project, component, environment (`notes-ios`) | `WorkspaceKey`, `ProjectKey`, `ComponentKey`, `EnvironmentKey` | slug, handle, ID |
| Feature key | A capability of a project, dotted: `editor.export` | `FeatureKey` | feature ID, tag |
| Release version | The version that names a release within its component: `2.4.0+312` | `ReleaseVersion` | build (it includes one), tag |
| Origin | The component and release a trace started in, from baggage | `originComponent`, `originRelease` on the envelope | caller, client |
| Envelope | The one shape of every signal and activity entry | `Envelope` | event (that is one kind), message, record |
| Kind | What an envelope holds: `event`, `run`, `log`, ..., or a module's, `uptime.check` | `EnvelopeKind` | type, category |
| Source | Where data comes from: `sdk-ios`, `otel`, `module:releases` | `Source` | origin (that is the component a trace started in) |
| Activity entry | One fact about a change to a record, named `<record>.<past tense>` | an `Envelope` of kind `activity`; its payload a `Schema.TaggedStruct` | event, audit row, log |
| Activity log | The activity of one database, and the only way to change its records | `ActivityLog`, its `commit` | event store, outbox, journal |
| Ingest key | The credential a component sends its telemetry with: `cluenori.<project>.<component>.<secret>` | `IngestKey`, `@cluenori/projects` | API key, API token; SDK key (the apps' key, later) |
| API token | The credential that lets someone use a deployment's public API | `CLUENORI_API_TOKEN`, `MemberAuthorization` in `apps/worker` | API key, password |
| Operation | What a service does, by name: an HTTP route it answers (`GET /api/notes/{id}`), a message it processes, or a job it starts (`cleanup.run`). Each time it runs is counted from its span: a server or consumer span, or an internal span that starts its trace | `operation`, `isOperationSpan`, `@cluenori/signals` | endpoint (an HTTP API's address), route (the template inside a name), request (an HTTP request is one kind), job (another), run, transaction |
| Counts | How many times each operation ran and failed, by environment, by the minute and by the hour, with a sketch of their durations | `OperationCounts`, `Signals`, `@cluenori/signals` | metrics (a separate signal, later), counters |
| Load | The counts over time: how many operations ran, and how many failed, in each step | `LoadSeries`, `@cluenori/signals` | traffic, throughput |
| Kept trace | A trace Cluenori keeps so it opens from its operation: of each operation, environment and hour, the five slowest and the five slowest failed, 14 days | `KeptTrace`, `KeptTraces`, `@cluenori/signals` | sample (it isn't random), exemplar, slow request |
| Incident | One problem from its start to its recovery, one open for each detector and subject: it opens when its detector fires, resolves 10 minutes after the problem is gone, and reopens if it is back within 30 | `Incident`, `Incidents`, `@cluenori/incidents` | alert (that is a notification about one), issue (a record people track), outage |
| Detector | A fixed rule that opens incidents, each measure against its own usual: `down`, `failing`, `stopped` | `Detector`, `@cluenori/incidents` | alert rule, check (one fetch of a monitor), threshold |
| Monitor | A URL of one component that Cluenori fetches every minute, such as its health endpoint | `Monitor`, `@cluenori/incidents` | uptime check, probe, health check (the endpoint it fetches) |
| Phone | A phone paired with a deployment, which calls its API with its own key for whoever paired it | `Phone`, `Phones`, `@cluenori/phones` | device (any device an app runs on), installation (an app on an end user's device) |
| Pairing link | The link a phone opens to pair, shown on the web as a QR code, good once for 10 minutes: `cluenori://pair?url=<deployment>&code=<pairing code>` | `Pairing`, `PairingCode`, `@cluenori/phones` | invite, QR login |
| Phone key | The credential a paired phone calls the API with: `cluenori.phone.<phone ID>.<secret>` | `PhoneKey`, `@cluenori/phones` | API token (the deployment's), device token (APNs') |
| Alert | A push to a paired phone about an incident: when it opens, gets worse, reopens, recovers, or someone acknowledges it | `Alert`, `Notifications`, `@cluenori/notifications` | notification (any of them, alerts are one kind), page, incident (what an alert is about) |
| Alert level | How an alert reaches the phone: `alarm` rings through silent mode and Do Not Disturb, `timeSensitive` breaks through a Focus that allows it, `quiet` shows without a sound | `AlertLevel`, `@cluenori/notifications` | priority, severity, interruption level (APNs' word, which it maps to) |
| Push token | The token iOS gives the app on one phone, by which APNs reaches it | `PushToken`, `RegisterPush`, `@cluenori/phones` | device token (Apple's word), phone key (the phone's credential) |
| Today | What needs attention now across every project, the most urgent first: open incidents, errors new or happening now, slower operations, and projects that sent nothing | `TodayList`, `TodayItem`, `@cluenori/today` | inbox, feed, alerts (notifications about incidents), dashboard |
| Slower | An operation whose p95 over the last day is at least 1.5 times, and 100 ms more than, its p95 over the 7 days before | `slowerOf`, `@cluenori/signals` | regression (a release's), slow (by nature, not news) |
| Covered period | The part of an asked-for period that counts answer for: no earlier than they are kept, no later than now | `covered` | — |
| Archive | Every export Cluenori received, scrubbed, kept 90 days: the source every view is derived from | `ArchiveStore`, `@cluenori/signals` | lake (the planned SQL over it), backup, logs |
| Error group | Errors that are the same error: one exception type and stack top, or one logger and message template | `ErrorGroup`, `ErrorGroupId` | issue (a record people track), exception, crash |
| Culprit | Where an error group happens: the top frame of its stack, or its logger | `culprit` | cause, source |

## Words that already mean a product concept

Several everyday programming words name a product concept in Cluenori. In code and conversation they
keep the product meaning only.

| Word | Means here | For the programming sense, say |
|---|---|---|
| Feature | A capability of a project with a dotted key, such as `editor.export` | a change, a capability |
| Component | A part of a project that ships separately, such as `notes-ios` | a view (UI), a part (architecture) |
| Module | A page in the sidebar, defined with `defineModule` | a file, a package |
| Session | One visit or app session of a person, with device context | a sign-in |
| Event | A product event an app tracks, such as `export.completed` (the envelope's kind `event`) | activity, for facts about changes to records |
| Release | One version of one component | a deploy of Cluenori itself |
| App | A component that runs on people's devices: an iOS, Android, or web app. It has sessions, screens, and crashes | the dashboard, for Cluenori's own web app |
| Backend | A component that runs on servers, answering requests, processing messages, or running jobs, such as `notes-api` or `notes-jobs`; an app and a backend are the two roles of a component, which its platform decides | the Worker, for Cluenori's own server; a service, which is an Effect service |
| Crash | An error that ended an app: on a phone it closed, in a browser it was not handled. Crash-free sessions are the share without one | a defect, for a bug in Cluenori |
| Workflow | A run of the Workflows engine: durable steps on behalf of a person or a process | a Cloudflare Workflow (the runtime it uses) |
| Operation | What a service does, by name, such as `GET /api/notes/{id}` | a step, for one span of a trace; a write or a read, for what code does to data; a process, for what a workflow runs |
| Query | A named read a module declares, served as an API route and an MCP tool | a SQL statement |
| Action | A change with an actor, class, target, before and after, reason, result, and undo | a function, a handler |
| Policy | What an actor may do, for each project and class of action | a rule, a setting |

## Architecture terms

| Term | Meaning | Lives in | Don't call it |
|---|---|---|---|
| Package | A workspace package with one entry, `src/index.ts` | `packages/`, `product/`, `apps/`, `sdks/`, `tests/` | module, library, lib |
| Capability | A general-purpose package that knows nothing of Cluenori | `packages/<name>`, `@bagatka/<name>` | util, helper, shared, common, core |
| Foundation | The product model every engine and module shares: scope keys, feature keys, the envelope, activity, the module contract | `product/foundation` | core, kernel, platform, common |
| Engine | A shared product capability with its own state and a service modules use, such as Audiences or the Ledger | `product/engines/<name>` | service (for the package), subsystem, domain |
| Contract | A package's exports from `src/index.ts`: services, Schemas, errors, its part of the API definition | `src/index.ts` | interface file, facade, port |
| Service | An Effect service: a contract callers reach through the context, declared with `Context.Service` | a package's `src/index.ts` | manager, provider (unless it provides a vendor), client |
| Layer | How a service is built from its dependencies: an Effect `Layer`, the service's `static layer` | next to its service | module, factory, container |
| Host | A package that composes others and translates the outside world to contracts: the Worker, the CLI, the dashboard | `apps/` | server, backend, frontend |
| Worker | The one deployable Cloudflare Worker and composition root | `apps/worker` | API server, backend |
| Composition root | The place that builds layers and registers everything on visible lines; only hosts have one | `apps/*` | bootstrap, startup, DI setup |
| Public API | The `HttpApi` definition the Worker serves, and the MCP tools from the same queries and actions | the API definition | REST layer, backend API, BFF |
| Record | An object with state that one engine or module owns, stored as rows, decoded with a `Schema.Class` | its package | entity, model, aggregate, DTO |
| Value type | A Schema with a rule and a brand, such as `FeatureKey` | its package | value object, wrapper, newtype |
| ID | A branded string holding a UUIDv7 | its package's contract | key (unless it is a feature or project key), raw string |
| Error | A tagged error in an Effect's error channel, declared with `Schema.TaggedError`; its tag is the stable code | the contract of what fails with it | exception |
| Defect | A failure no caller can act on: a bug or an infrastructure failure, raised with `Effect.die` or `Effect.orDie` | anywhere | crash, panic, fatal error |
| Reaction | An engine's or module's handler for activity, idempotent | the reacting package | consumer, subscriber, listener, handler |
| Journey | One test of a real flow through the public API, as named steps | `tests/journeys` | end-to-end test, scenario, integration test |
| Settings | The values a package needs, passed to its layer by the host | next to the layer | options, config |
| Actor | Who performs an action: a member of the workspace, a person (an end user), an agent run, or a named system process | `Actor` in Foundation | user, caller, principal |
| Spike | A short, throwaway experiment that settles one assumption before code depends on it | a scratch directory or an unmerged branch | prototype, POC |
