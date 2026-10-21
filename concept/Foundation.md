# Foundation

Every module in Cluenori is built from the same primitives. Version 1 fixes the shapes that are expensive to change later: the scope keys, the envelope, activity, actions, the SDK and the module contract. Each engine then ships with the first module that needs it, behind the same interface. Thus each later module is a small addition, not a rewrite.

## At a glance

&#91;embedded content: foundation · 5 layers, 1 contract\]

A module never reads the tables of another module. It uses the shared engines, and it reacts to activity.

## Scope: where each record belongs

Twelve keys place every record. Each module uses the same keys, so one filter bar works everywhere: project, component (ran in or started from), environment, release, feature, person or account, and period. The module contract refers to this list. Without a filter, a module shows the whole project, or the whole portfolio.

| Key | What it is | Example | Rule |
| --- | --- | --- | --- |
| Workspace | The tenant: members, billing, settings | My factory | A self-hosted deployment usually has one |
| Project | The business unit: one product and one investment | Notes | Owns spend, revenue, brand and decisions |
| Component | A part that ships separately | notes-ios, notes-android, notes-web, notes-api, notes-jobs | Has a platform, store and bundle IDs, an SDK key and a repository. Its platform gives its role: an app runs on people's devices (iOS, Android, web), a backend on servers (.NET, Node.js) |
| Origin | The app and release a trace started in | notes-ios 2.4.0 | Comes from baggage. Answers "did iOS 2.4 slow the API?" |
| Environment | Where a component runs | production, staging | Production is the default view |
| Release | One version of one component | notes-ios 2.4.0, build 312 | Has commits, PRs, features, notes and store state |
| Feature | A capability of the project, across components | editor.export | A dotted key: a filter on editor includes editor.export |
| Person | One end user in one project | An install ID; a user ID after sign-in; or only an email, from a waitlist | Holds identities: user ID, email, store and payment IDs |
| Installation | One app on one device | The iPhone of a person, on notes-ios 2.3 | Holds the push token, permission, OS version, locale, time zone and last-seen release. Version audiences use installations. |
| Account | The group that pays, for B2B apps | A team or a company | Optional |
| Session | One visit or app session, with device context | iPhone 15, iOS 18.4, Germany, German | Stored once; events refer to it |
| Trace | One operation and what it caused, across services | A W3C trace ID | Links spans, logs and errors |

Each record always has a workspace, a source and a time, and a project unless it is a workspace record. The other keys are attached when they are known. An unknown key stays empty and shows as "unknown", never as a guess.

Shared domains, shared costs, blueprints, policies and cross-project audiences are workspace records. An identity link joins one person in two projects. It is a separate, verified record, with the purposes that the person agreed to.

## Features: one filter across everything

A feature belongs to the project, not to one component. Export exists in the iOS app, the web app and the API, so it is one feature. The feature page shows Export in all components, or only in the iOS app. In every other module, the feature is one more filter in the filter bar.

Each feature has a dotted key, a name and a stage: idea, planned, building, beta, live, deprecated or removed. Ideas, changelog entries, flags and decisions link to the same key.

&#91;embedded content: feature key · from one tap to every record\]

The app sets the key once. With the Cluenori helpers, the API and the job inherit it, so their spans, logs and costs belong to the same feature. The helpers copy baggage into span and log attributes, put it into queue messages, and remove it from calls to third parties such as Stripe. Web apps must allow the `baggage` and `traceparent` headers in CORS. The server checks each key against the catalog, because the client controls the value.

A record gets its feature key in one of four ways:

| Method | Example | Used for |
| --- | --- | --- |
| In code | `track('export.completed', { feature: 'editor.export' })`. In .NET: `app.MapPost("/api/export", Export).WithFeature("editor.export")` | Events, spans, logs, costs |
| Propagated | The app sends the current feature in the W3C `baggage` header. The Cluenori helpers copy it to the spans, logs and queue messages of that trace. | Traces, logs, jobs |
| Catalog rules | Route `POST /api/export/*`, event names `export.*`, flag `new-export`, log category `Notes.Export` | Data that arrives without a key |
| Links | The PR label `feature:editor.export`, a feedback item, a changelog entry, an issue | Records in modules |

Four rules keep the filter honest:

- **Rules apply at ingest.** Counts are added up as data arrives, and the raw data behind them is not kept for long, so the Worker applies the catalog rules before it counts. Data in the lake can get new keys later by a backfill.
- **Two fields, one precedence.** `feature` is the owner of the code that ran: a key in code wins over a catalog rule. `callerFeature` is the feature of the screen that started the request, from baggage. The filter uses the owner by default. A switch adds the calls that a feature started, for example `GET /api/me` from the Export screen.
- **Calls keep their origin.** An API span has its own component, `notes-api`, and the origin app and release from the baggage, `notes-ios 2.4.0`. Thus "Export in the iOS app" includes the API calls that the iOS app made.
- **Keys are per project.** Blueprint keys, for example `billing`, have the same name in each project, so the portfolio can compare them.
- **Untagged data stays visible.** It shows as "(no feature)", with its share of calls and time. A low share tells me to add tags.

## Data shapes: signals, records and activity

All data has one of three shapes. Each shape has its own store and rules.

| Shape | What it is | Volume | Store | Examples |
| --- | --- | --- | --- | --- |
| Signals | Measurements and telemetry. Append only. | High | Lake (R2, Iceberg), and counts in the database of each project (Durable Objects) | Product events, runs and their traces, logs, errors, web vitals |
| Records | Objects with state that one module owns | Low | The database of the project or the workspace | Releases, deployments, provider resources, flags, version policies, campaigns, feedback, issues, decisions, consent records, ledger lines, distribution attempts |
| Activity | Typed facts about each change. Never edited. | Low to medium | With its record, then archived to R2 | release.published, flag.changed, payment.succeeded, feedback.submitted, agent\_run.finished |

Each write to a record emits activity. Activity feeds the customer timeline, Today, workflows, webhooks, agents and the audit log. Thus a new module appears in all of these places when it emits activity.

The data classes of the Vision map to these shapes. Business facts are records or exact counts: payments, ledger lines with their currency and exchange rate, and core value events, which Durable Objects count exactly. Operational measurements are counters. Diagnostic evidence is sampled signals. A change is activity.

Signals and activity use one envelope: an ID, a time, a kind (`event`, `operation`, `span`, `log`, `error`, `activity`, `cost`, `money`, or a module kind such as `uptime.check`), a name, the scope keys that are known, the source, and the payload. An activity entry also carries its actor. The envelope is defined in code, in `product/foundation/src/envelope.ts`, which owns its exact fields and rules.

## Shared engines

Twelve engines do the work that many modules need. A module uses an engine; it never builds its own copy.

| Engine | What it does | Used by |
| --- | --- | --- |
| Audiences | Selects people or installations by component, version, platform, plan, behavior, feature use, location and consent. Makes a list for a send, or checks one person at the edge. | Push, email, in-app messages, flags, experiments, surveys, version policy, cross-promotion |
| Manifest | One cached response that the SDK reads at start and on resume: version policy, flags, config, messages to show, unread changelog entries, survey and feedback settings | Update gate, flags, announcements, What's new, surveys |
| Channels | One adapter for each way to reach a person: APNs, FCM, Web Push, email providers, the in-app inbox, webhooks. APNs and FCM take one device for each request, so large sends fan out through Queues. | Campaigns, journeys, workflows |
| Content | Templates, languages, the brand of each project (name, icon, colors, sending domain), and media in R2 | Email, push, changelog, public pages, update screen |
| Workflows | Durable steps: trigger, wait, condition, send, change a record, call a URL, ask for approval, start an agent. Runs for each person (journeys) or one time (processes). Journey enrollment lives in the database of the project, because finished instances are kept for 30 days. | Journeys, release announcements, notify voters, incident response |
| Experiments | Stable assignment by hash, holdout groups, exposure records, goal metrics | Flags, campaigns, journeys, paywalls |
| Ledger | Money in and out as lines with a source, a precision label and attribution to project, component, feature and person. Stored exactly in the database of the project, with the currency and the exchange rate of the day. | Revenue, spend, portfolio, cost per customer and feature |
| Actions and policy | Each change is an action with an actor, a class, a target, the values before and after, a reason, a result and an undo. Policy decides what needs approval. | All modules, agents, workflows, the audit log |
| Connectors | Sign-in, history import, webhooks and mapping for each outside system | GitHub, stores, Stripe, RevenueCat, Cloudflare, Amp, email providers |
| Query | Counters, nightly summaries and drill-down to the lake. The dashboard and MCP use the same queries. | Every chart, agents |
| Search | One index across people, records and activity | ⌘K, MCP |
| My notifications | Alerts, approvals and the daily brief, with quiet hours | Today, incidents, policies |

Cloudflare supplies most of the runtime. [Workflows](https://developers.cloudflare.com/workflows/reference/limits) runs durable steps with sleeps of up to 365 days. Queues carry activity to the engines that react to it.

## Client kit: one SDK, many surfaces

The SDK gives each app the parts that I now build by hand in each project. Each surface has a ready native view, and a headless API for a custom design.

| Surface | What the user sees | Engines |
| --- | --- | --- |
| Update gate | A full screen, "Update to continue", with a store button | Manifest, content |
| Update prompt | A sheet that the user can close | Manifest, audiences |
| Maintenance screen | A message while a backend is down, set by a kill switch | Manifest |
| Announcement | A banner or a modal | Manifest, audiences, content |
| What's new | A sheet after an update, and a changelog list with an unread badge | Manifest, content |
| Feedback | A form for a bug, an idea or a question, with context attached | Channels, search |
| Ideas board | Ideas with votes and status | Audiences, content |
| Survey | One or two questions after a trigger | Workflows, audiences |
| Inbox | In-app messages and replies to feedback | Channels |
| Consent | Choices for analytics and for promotional messages | Audiences |
| Push registration | The permission prompt at a chosen moment, then the device token | Channels, consent |

Rules for shipped builds:

- **Old builds live for years.** The app can block only a build that contains the update gate, and push reaches only builds that register a token. Thus the first SDK release has the gate, push registration, consent, first-touch capture, and three generic views that the manifest fills: a sheet, a list and a form. What's new, the feedback form and the inbox can then start later without an app release.
- **The API enforces the same policy.** The SDK sends the app version and build in a header on each request. A blocked version gets an "update required" error (HTTP 403 with a problem+json body), and the SDK shows the update screen. A request without the header has an unknown version, and the policy decides whether to allow it. Old builds without the gate also stop, but they show their own generic error.
- **A hard block needs a possible update.** The SDK checks on each device that an update can be installed: the device OS meets the new minimum, and on Android the app came from Google Play and the staged rollout includes the device. Apple's phased release does not stop manual updates. A device that cannot update gets the soft prompt or a "device not supported" screen, by policy.
- **Fail open.** If Cluenori is not available, the SDK uses the last manifest that it received. Without a stored manifest, it never blocks the app.
- **The manifest only grows.** Old SDKs ignore unknown keys. New content and new uses of the generic views need no app release. A new kind of native surface needs a new SDK version.
- **One small request.** The shared part of the manifest is cached at the edge for each component, version and language. The personal part (flags, messages, unread entries) is small.
- **Platforms.** Swift (SwiftUI and UIKit), Kotlin (Jetpack Compose) and TypeScript (web components and React) come first. React Native and Flutter come later. Servers use OpenTelemetry, with small helpers for .NET and TypeScript.
- **One SDK for each platform, in modules.** Each platform has one package with one version, so its parts never disagree. A small core is in every build: keys, installation, the manifest (flags, config, the update gate, messages), the version header, and trace headers on requests. Old builds can only turn on what their core can read, so the core must ship first. A part becomes an opt-in module only when including it has a cost: crash reporting (it installs a crash handler, which conflicts with another reporter), push (a permission prompt and an entitlement), analytics (it changes the app's privacy label), and the ready-made screens (app size). On iOS the modules are libraries of one Swift package, in TypeScript entry points of one npm package with unused code dropped, and on .NET one NuGet package.

## The module contract

A module is a folder in the repository with one definition file. The definition says what the module adds. Cluenori then connects it to the rest, and no other module changes.

```ts
export default defineModule({
  id: 'feedback',
  scope: 'project',                                         // or 'workspace'
  nav: { area: 'Product', label: 'Feedback' },
  records: { item: FeedbackItem, vote: Vote },              // tables in the project's database
  migrations: './migrations',
  activity: ['feedback.submitted', 'feedback.status_changed', 'feedback.merged'],
  filters: 'standard',                                      // the shared filter bar
  queries: { openItems, demandByFeature },                  // become API routes and MCP tools
  actions: {
    changeStatus: { class: 'write', input: StatusInput, run, undo },
    reply:        { class: 'message', input: ReplyInput, run },
  },
  audiences: { votedFor: VotedFor },                        // "people who voted for idea X"
  workflow:  { triggers: ['feedback.status_changed'], steps: { notifyVoters } },
  manifest:  feedbackSettings,                              // what the SDK receives
  panels:    { person: Timeline, feature: Demand, release: ShippedIdeas },
  today:     [PayingCustomerReportedBug],                   // detectors for the attention queue
  notifications: ['feedback.from_paying_customer'],         // alerts that I can turn on
  connectors: [appStoreReviews, playReviews],
  settings:  FeedbackSettings,
  search:    indexItem,
  privacy:   { exportPerson, deletePerson },
})
```

A module can also declare its own signal kinds with a namespace, for example `uptime.check`. The envelope accepts them without a change to shared code.

From this definition, the module gets these parts without more work:

- a sidebar entry, the filter bar, and chips and Related links on other pages,
- entries in the customer timeline, and items in Today,
- triggers and steps in workflows, and conditions in audiences,
- API routes and MCP tools for each query and action,
- the audit log, undo and policy checks for each action,
- search, and the export and deletion of one person's data.

Four rules keep the modules independent:

1. A module reads and writes only its own tables. It reaches other modules through activity and their declared actions.
2. All modules use the shared scope, features, people, audiences, activity, actions and ledger.
3. The first modules live in the main repository. A public plugin API comes after about ten modules prove the contract.
4. `npx cluenori add module <name>` makes the folder from a template. An agent can write a new module from this contract and the template.

## Blueprints: the same setup in each project

A blueprint is the factory contract as code. It holds the setup that I now repeat by hand in each new project. `npx cluenori project create notes --blueprint subscription-app` registers the project and applies the blueprint. I keep a few blueprints, for example subscription-app, web-saas and utility.

| Part | Default in subscription-app |
| --- | --- |
| Components | iOS app, Android app, web app, API, jobs |
| Features | Sign-in, onboarding, billing, settings, and the core feature that I name |
| Value | The core value event and the activation funnel |
| Delivery | A kill switch for each component, a version policy and a release policy |
| Client kit | Update gate, What's new, feedback form, consent |
| Messages | Welcome email, trial-ending reminder, What's new push, failed-payment email |
| Public pages | Changelog, ideas board, status, privacy, terms, support |
| Quality | Critical journeys, uptime checks |
| Automation | The automation policy for agents |
| Brand | Name, icon, colors, a sending domain, and a subdomain for marketing mail |

Blueprints have versions. When I change a blueprint, Cluenori shows the change for each project as a diff that I apply or skip. Thus old projects do not drift away from new ones.

## What version 1 must get right

These choices are expensive to change after data and shipped builds exist. Version 1 makes all of them, even where its modules are small.

| Choice | Why a later change is expensive | Version 1 slice |
| --- | --- | --- |
| Scope keys and the envelope | Every stored row carries them. A change needs a backfill of the lake. | The full envelope, with origin and installation. Feature, account and session are optional. |
| Feature keys on counts | Counts are added up when data arrives, and recounting needs raw data that is gone. | Counts carry the feature and the caller feature. Catalog rules run at ingest. |
| The SDK in shipped builds | Shipped builds live for years. Only builds with the gate can be blocked, and only builds with push registration get push. | The manifest, kill switches, update gate, version header, push registration, consent, first touch and the generic views |
| Person, installation and consent | Consent cannot be collected for the past. A wrong merge of two people is hard to undo. | Identities, installations, a merge log, and consent records with purpose, channel, wording version, source and time |
| First touch | Install referrers and campaign tags cannot be collected later. | Play Install Referrer, the Apple AdServices token, and UTM tags or the referrer on the web |
| Duplicates | SDKs and exporters retry, so data can arrive twice, and the lake does not remove duplicates. | Event IDs, and the digest of each batch, kept for an hour in the project's database, so a retry counts once; queries remove the rest. |
| Personal data in stores that cannot delete | Iceberg files need a rewrite to delete a row. | No person IDs in counts. The lake keeps a pseudonymous ID, and the mapping lives in the database of the project. A delete removes the mapping at once and the rows at the next rewrite. |
| Retention of counts | Detail is kept only so long: counts by the minute 14 days. | Counts by the hour, kept 15 months, in the database of each project from the first day |
| Database layout | Each database has a size limit (10 GB) and one writer. | One SQLite database for each project, and one for the workspace, each in its own Durable Object |
| Activity on every write | Timelines, workflows and agents need history from the first day. | All module writes go through one function that emits activity. |
| Actions with audit and policy | Agents need a complete and enforced history before they act. | The dashboard, API, CLI and MCP use one action layer. |
| The module contract | Modules built without it will not fit later. | The first modules use the contract strictly, with no shortcuts. |
| The ledger | Mixed numbers and currencies lead to wrong decisions. | Each amount has a source, a precision label, an attribution, a currency and the exchange rate of the day. |
| A sending domain for each project | Email reputation builds slowly. | The blueprint sets a domain, and a subdomain for marketing mail. |

## From a goal to primitives

Each thing that I do by hand today is a short chain of the same primitives.

| I want to | Chain of primitives |
| --- | --- |
| Push to all users of Notes iOS on a version below 2.4 | Audience of installations (component, release below 2.4, push permission) → APNs channel with a Queues fan-out → template → action with policy → activity → result against the update event |
| Force an update for versions below 2.1 | Version policy record → manifest → update gate in the app, an "update required" error in the API → action with my approval → adoption and lost users afterwards |
| Send a welcome series and a trial-ending reminder | Workflow (trigger: trial.started) → wait → condition (core value event done?) → email channel → consent check → holdout group → goal: trial converted |
| Show a changelog in my apps | Release with PRs and features → changelog entry with media → manifest badge → What's new sheet, public page, email digest, push, store text → views, then feature use |
| Let users report bugs and ideas | SDK form with version, device and session trail → feedback record → feature link → issue → release → changelog entry → workflow tells the voters |
| See Export in the iOS app | Feature filter (editor.export) × app filter (notes-ios, as the component or the origin) on Analytics, Performance, Logs, Errors, Flags, Spend and Feedback |
| Retire a project | Ledger (costs that stop) → audience (all users) → campaign → data export → connector actions to stop services → checks for each step |
