# Glossary

One name per concept, used the same way in code, APIs, storage, UI, and conversation.

- Don't introduce synonyms.
- Don't reuse a name for something else.
- Add terms in the same change that introduces them.

Product terms (project, component, origin, environment, release, feature, account, trace, operation,
idea, signals, records, activity, engines, and the module catalog)
are defined in `concept/Foundation.md` and `concept/Modules.md`. When code implements one, its row moves here.

## Terms the code implements

Each is a Schema or service in the package named (Foundation unless said), whose doc comment holds
its exact rule.

| Term | Meaning | In code | Don't call it |
|---|---|---|---|
| Scope key | A permanent key that places a record: workspace, project, component, environment (`notes-ios`) | `WorkspaceKey`, `ProjectKey`, `ComponentKey`, `EnvironmentKey` | slug, handle, ID |
| Feature key | A capability of a project, dotted: `editor.export` | `FeatureKey` | feature ID, tag |
| Feature story | One feature over everything kept of it: who used it each day, and the operations, warnings and errors its services sent naming it in `cluenori.feature` | `FeatureStory` | feature report, feature detail |
| Release version | The version that names a release within its component: `2.4.0+312` | `ReleaseVersion` | build (it includes one), tag |
| Origin | The component and release a trace started in, from baggage | `originComponent`, `originRelease` on the envelope | caller, client |
| Envelope | The one shape of every signal and activity entry | `Envelope` | event (that is one kind), message, record |
| Kind | What an envelope holds: `event`, `run`, `log`, ..., or a module's, `uptime.check` | `EnvelopeKind` | type, category |
| Source | Where data comes from: `sdk-ios`, `otel`, `module:releases` | `Source` | origin (that is the component a trace started in) |
| Activity entry | One fact about a change to a record, named `<record>.<past tense>` | an `Envelope` of kind `activity`; its payload a `Schema.TaggedStruct` | event, audit row, log |
| Activity log | The activity of one database, and the only way to change its records | `ActivityLog`, its `commit` | event store, outbox, journal |
| Ingest key | The credential a component sends its telemetry with: `cluenori.<project>.<component>.<secret>` | `IngestKey`, `@cluenori/projects` | API key, API token; SDK key (the apps' key) |
| SDK key | The public key a component's app builds carry, so its SDK can send that component's signals and read its manifest, and nothing else: `cluenori-sdk.<project>.<component>.<id>`. A component has several at once, so keys rotate; a revoked one is refused | `SdkKey`, `IssuedSdkKey`, `@cluenori/projects` | ingest key (a secret, for services), API key, app token |
| Person | One end user in one project, by the ID Cluenori gives them: the app's user IDs link to one, and an installation's signals without one are its person's | `PersonId`, `AppPerson`, `@cluenori/signals` | user (a member is a user of Cluenori), customer (a person who pays), user ID (the app's own ID for them, `AppUserId`) |
| Installation | One app on one device, by the ID its SDK makes at first launch: its person, release, device, country and when it was last seen | `InstallationId`, `AppInstallation`, `@cluenori/signals` | device (it may hold several), install, phone (Cluenori's own paired phones) |
| Session | One time a person had the app in the foreground: it starts when the app comes to the foreground, and ends 30 s after it leaves, with its foreground time | `SessionId`, `SessionStarted`, `SessionEnded`, `@cluenori/signals` | open, visit, sign-in (a browser's, for members) |
| Timeline | A person's latest 1,000 signals but memory, newest first: what they did | `TimelineEntry`, `@cluenori/signals` | activity (facts about records), history, event log |
| Cohort | The people first seen in one UTC week, Monday to Sunday, in a component and environment: how many there were, and how many were active in each week since; retention reads them | `RetentionCohort`, `AppRetention`, `@cluenori/signals` | segment, audience (the planned engine's) |
| App health | How one release of an app runs, over all that is kept of it: launch times cold and warm, memory, and MetricKit's crashes and hangs, per 1,000 sessions; compared with the release before it, with a verdict in a release's words | `AppHealth`, `ReleaseHealth`, `HealthVerdict`, `@cluenori/analytics` | crash-free rate (one measure of it), stability, vitals |
| Manifest | The one small response an app's SDK reads at launch and on resume, the same for every installation of a release, kept at the edge five minutes: its version policy now; flags, messages and What's New later | `AppManifest`, `@cluenori/manifest` | config, remote config (one future part of it), bootstrap |
| Version policy | For one app component, the oldest version its users may keep (minimum) and the version to offer (recommended), with where to update and the project's words: in production, a release below the minimum must update, one below the recommended is offered it | `ComponentVersionPolicy`, `versionPolicyFor`, `@cluenori/releases`; `VersionPolicy`, what the manifest says of one release, `@cluenori/manifest` | force update (one decision of it), update gate (the SDK's screen), kill switch |
| Store version | A version as a store shows it, and as a release names it before `+`: one to four numbers, compared part by part | `StoreVersion`, `@cluenori/manifest` | marketing version (Apple's word), build |
| Calendar day | A day in UTC, `YYYY-MM-DD`, which what is counted by day is counted in | `CalendarDay`, Foundation | date (a date-time is an `Instant`) |
| API token | The credential that lets someone use a deployment's public API | `CLUENORI_API_TOKEN`, `MemberAuthorization` in `apps/worker` | API key, password |
| Operation | What a service does, by name: an HTTP route it answers (`GET /api/notes/{id}`), a message it processes, or a job it starts (`cleanup.run`). Each time it runs is counted from its span: a server or consumer span, or an internal span that starts its trace | `operation`, `isOperationSpan`, `@cluenori/signals` | endpoint (an HTTP API's address), route (the template inside a name), request (an HTTP request is one kind), job (another), run, transaction |
| Counts | How many times each operation ran and failed, by environment, by the minute and by the hour, with a sketch of their durations | `OperationCounts`, `Signals`, `@cluenori/signals` | metrics (a separate signal, later), counters |
| Load | The counts over time: how many operations ran, and how many failed, in each step | `LoadSeries`, `@cluenori/signals` | traffic, throughput |
| Request | One time an operation ran, as its trace opens it: an HTTP request, a message processed, or a job's run; the item under an operation (`concept/Experience.md`) | `KeptTraceRow`, the trace page, `TraceScreen` | run, call, invocation |
| Moment | A step of a chart opened by a click, marked within the rest of its period, never a filter | `?at=`, `MomentPanel`, `Moment` | zoom, selection, drill-down |
| Kept trace | A trace Cluenori keeps so it opens from its operation: of each operation, environment and hour, the five slowest and the five slowest failed, 14 days | `KeptTrace`, `KeptTraces`, `@cluenori/signals` | sample (it isn't random), exemplar, slow request |
| Incident | One problem from its start to its recovery, one open for each detector and subject: it opens when its detector fires, resolves 10 minutes after the problem is gone, and reopens if it is back within 30 | `Incident`, `Incidents`, `@cluenori/incidents` | alert (that is a notification about one), issue (a record people track), outage |
| Detector | A fixed rule that opens incidents, each measure against its own usual: `down`, `failing`, `stopped` | `Detector`, `@cluenori/incidents` | alert rule, check (one fetch of a monitor), threshold |
| Monitor | A URL of one component that Cluenori fetches every minute, such as its health endpoint | `Monitor`, `@cluenori/incidents` | uptime check, probe, health check (the endpoint it fetches) |
| Phone | A phone paired with a deployment, which calls its API with its own key for whoever paired it | `Phone`, `Phones`, `@cluenori/phones` | device (any device an app runs on), installation (an app on an end user's device) |
| Pairing link | The link a phone opens to pair, shown on the web as a QR code, good once for 10 minutes: `cluenori://pair?url=<deployment>&code=<pairing code>` | `Pairing`, `PairingCode`, `@cluenori/phones` | invite, QR login |
| Phone key | The credential a paired phone calls the API with: `cluenori.phone.<phone ID>.<secret>` | `PhoneKey`, `@cluenori/phones` | API token (the deployment's), device token (APNs') |
| Member | Someone who signs in to the deployment: an owner, who sees every project and manages members, or a member, who sees the projects chosen | `Member`, `Members`, `@cluenori/members` | user (that is an end user: a person), account (a customer's), team |
| Invitation | A link good once for 7 days that makes its member's passkey and signs them in: `<deployment>/invite#<code>` | `Invite`, `InviteCode`, `@cluenori/members` | invite code, signup link |
| Passkey | A key a person's device keeps for the deployment's site, unlocked by Face ID, Touch ID or a PIN: how members sign in | `Passkey`, `@bagatka/webauthn` | password, credential (any of the ways in) |
| Sign-in | A browser signed in as a member, kept 30 days: what it is, and when and where it was last seen | `SignIn`, `SignInToken`, `@cluenori/members` | session (that is a person's app session), login |
| Access | What a member sees: every project, or those listed | `Access`, `canSee`, `@cluenori/members` | permissions, scope (scope keys place records), role (owner or member) |
| Alert | A push to a paired phone about an incident (when it opens, gets worse, reopens, recovers, or someone acknowledges it), or about a feed's new entries | `Alert`, `Notifications`, `@cluenori/notifications` | notification (any of them, alerts are one kind), page, incident (what an alert is about) |
| Alert level | How an alert reaches the phone: `alarm` rings through silent mode and Do Not Disturb, `timeSensitive` breaks through a Focus that allows it, `quiet` shows without a sound | `AlertLevel`, `@cluenori/notifications` | priority, severity, interruption level (APNs' word, which it maps to) |
| Feed | A named live list of the events an owner chose across projects, such as every registration, with its alert level: `none`, `quiet` or `timeSensitive`, never an alarm | `Feed`, `Feeds`, `@cluenori/feeds` | stream, channel, timeline (a person's signals) |
| Feed source | One event a feed watches: a project and the name its apps send that event by there, `user.registered` | `FeedSource`, `@cluenori/feeds` | trigger, rule, filter |
| Feed entry | One watched event that arrived from production, in a feed, kept 90 days: the project, the event, when, the component, environment and release, the country, and the app's user ID when known | `FeedEntry`, `@cluenori/feeds` | item, post, notification (the alert about it) |
| Push token | The token iOS gives the app on one phone, by which APNs reaches it | `PushToken`, `RegisterPush`, `@cluenori/phones` | device token (Apple's word), phone key (the phone's credential) |
| Today | What needs attention now across every project, the most urgent first: open incidents, errors new or happening now, slower operations, promotions that need a member, and projects that sent nothing; with each project's pulse. The apps say it as each product's line about each project, on Now, their first screen, and on a project's page | `TodayList`, `TodayItem`, `@cluenori/today` | inbox, feed, alerts (notifications about incidents), dashboard |
| Pulse | How a project is going now, beside what needs attention: its load over the last 24 hours by the hour, and its apps' daily and monthly people on the latest whole UTC day and a week before, in its production environments | `ProjectPulse`, `@cluenori/today` | summary, stats, overview, health |
| Slower | An operation whose p95 over the last day is at least 1.5 times, and 100 ms more than, its p95 over the 7 days before | `slowerOf`, `@cluenori/signals` | regression (a release's), slow (by nature, not news) |
| Production environments | The environments a project calls production, where its incidents alert and its views and Today start; `prod`, `production` and `live` until it chooses, and telemetry without an environment always | `ProjectSettings`, `isProduction`, `@cluenori/projects` | live, main, primary |
| Deploy report | A deploy of a release, sent from the component's CI by `cluenori-release` with its ingest key: the release, its environment, commit, tag, and the commits since the release reported before | `ReleaseReport`, `@cluenori/releases` | release event, deployment (Cluenori's own) |
| Component links | Where a component's releases come from beside telemetry, and where they go: its GitHub repository, its deploy targets, and the component it ships with | `ComponentLinks`, `@cluenori/projects` | integrations, connections |
| Ships with | A component deployed by another component's deploys, from the same commit with the same release, such as a background service the API's workflow builds and deploys; it has nothing to promote of its own | `shipsWith`, `@cluenori/projects` | sidecar, child, part of |
| Delivery | How a component's releases reach its environments: those of its deploy targets in their order, each with the release there now and since when, a promotion under way, and the one next step: promote the release of the environment before it, or, to the first, build the latest commit | `Delivery`, `@cluenori/releases` | pipeline (a deploy workflow is one), track, flow |
| Deploy target | Where a component's releases go in one environment, and how: the deploy workflow that builds and deploys a release there, the App Store Connect app its builds go to (for TestFlight, or on to the App Store), or both | `DeployTarget`, `@cluenori/projects` | channel, lane, destination |
| Deploy workflow | The GitHub Actions workflow in a component's repository that builds and deploys a release to an environment, started with the inputs `release`, `environment`, `commit` and `runner`: `deploy.yml` | a deploy target's `workflow`; `WorkflowFile`, `@cluenori/github` | pipeline, workflow (that is the Workflows engine's), job |
| Component version | The `MAJOR.MINOR.PATCH` a component's next builds are numbered in, set by a member: `0.6.0` | `ComponentVersion`, `setVersion`, `@cluenori/releases` | marketing version (Apple's word for it), app version |
| Build number | The number after `+` in a release: the next for the component, given to a commit the first time its CI asks, for good, so one number is one commit everywhere | `numberCommit`, `cluenori-release number`, `@cluenori/releases` | build ID, CFBundleVersion (Apple's) |
| Promotion | A release deployed to an environment from Cluenori by its deploy target: its workflow started on GitHub, and for an app, its build followed in App Store Connect, through review for the App Store; by a member, with their reason | `Promotion`, `promote`, `@cluenori/releases` | deploy (a deploy report is what CI sends after deploying), rollout, submission (one step of it) |
| Release notes | What a release tells its users, one note for each language: its What's New on the App Store, or What to Test in TestFlight; drafted by the project's language model, edited and saved by a person | `ReleaseNote`, `saveNotes`, `draftNotes`, `@cluenori/releases` | changelog (the planned module), What's New (one place they go) |
| Notes style | How a project's release notes read, in its own words, which drafts follow | `NotesStyle`, `@cluenori/releases` | tone, prompt |
| Runner | Where a deploy workflow's jobs run: `local`, the founder's own machine, a self-hosted runner labelled `local`; `cloud`, the repository's hosted runner; `auto`, local while it is online | `Runner`, `cluenori-release runner`, `@cluenori/releases` | machine, agent, host |
| GitHub App | The workspace's own app on GitHub, which an owner connects from the web and installs on their accounts; Cluenori reads and starts workflows as it | `GitHubConnection`, `@cluenori/github-app` | integration, token, connector (the planned engine for all outside systems) |
| Store stage | Where an app's build stands in App Store Connect: processing, in TestFlight, in review, pending release, releasing (phased), live, and so on | `StoreStage`, `@cluenori/releases` | status, app state (Apple's word for one of its inputs) |
| Release before | The release of the same component and environment first seen latest before a release: what it is compared with | `previous`, `@cluenori/releases` | last release, prior version |
| Verdict | How a release compares with the release before it: `worse` (an operation slower or failing more, or an error first seen in it), `better`, `same`, `tooEarly` (under an hour, or no operation ran 100 times in both), `first`, `unmeasured` (no telemetry from it yet) | `Verdict`, `@cluenori/releases` | grade, health, status |
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
| Release | One version of one component, as its telemetry reports it in `service.version` | a deploy of Cluenori itself |
| App | A component that runs on people's devices: an iOS, Android, or web app. It has sessions, screens, and crashes | the dashboard, for Cluenori's own web app |
| Backend | A component that runs on servers, answering requests, processing messages, or running jobs, such as `notes-api` or `notes-jobs`; an app and a backend are the two roles of a component, which its platform decides | the Worker, for Cluenori's own server; a service, which is an Effect service |
| Crash | An error that ended an app: on a phone it closed, in a browser it was not handled. Crash-free sessions are the share without one | a defect, for a bug in Cluenori |
| Workflow | A run of the Workflows engine: durable steps on behalf of a person or a process | a Cloudflare Workflow (the runtime it uses); a GitHub Actions workflow (a deploy workflow) |
| Operation | What a service does, by name, such as `GET /api/notes/{id}` | a step, for one span of a trace; a write or a read, for what code does to data; a process, for what a workflow runs |
| Query | A named read a module declares, served as an API route and an MCP tool | a SQL statement |
| Action | A change with an actor, class, target, before and after, reason, result, and undo | a function, a handler |
| Policy | What an actor may do, for each project and class of action | a rule, a setting |

## Architecture terms

| Term | Meaning | Lives in | Don't call it |
|---|---|---|---|
| Package | A workspace package with one entry, `src/index.ts` | `packages/`, `product/`, `apps/`, `sdks/`, `tests/` | module, library, lib |
| Capability | A general-purpose package that knows nothing of Cluenori | `packages/<name>`, `@cluenori/<name>` | util, helper, shared, common, core |
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
