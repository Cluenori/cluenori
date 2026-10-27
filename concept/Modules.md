# Modules

This tab lists every module that Cluenori can have, with the phase that ships it. Each module is a page in the sidebar, and each one follows the module contract in Foundation.

## Navigation

Cluenori is a tree of levels, the same on the web and on the phone (decided on 2026-10-23, in place of a sidebar with every module by name):

- **Now,** the root: every project, those that need me first, each with one line for each product that has news ("Errors: 1 happening now", "Performance: GET /api/feed slower"), opening the one thing it is about or the product, and the steady ones in one quiet row; then the feeds (decided on 2026-10-26, in place of a list of everything that needs me).
- **A project:** a row for each product, the most urgent first, with its line and the things behind it, each leading into the product; the products with nothing to say last, still a way in (decided on 2026-10-26, in place of its people, its load and three doors). The sidebar still has the doors: Product (its features, each with its usage, funnel, health, flag and releases inside it), Tech (requests, errors, logs and incidents, each a summary, then a list, then one item, and the production setting), Releases, and later People.

Each level shows only the summary that I need to act or to understand, and one level deeper shows more. A module from the table below goes behind the door where it fits when it is built.

Every level follows Experience: lists, groups and items, the answer first, and each product's own screens inside the shared tree (decided on 2026-10-26). First on it: Errors as a list, a group and an item, then Feeds.

Built so far (2026-10-23): Now, a project and Tech, on the web and on the phone; Product and Releases still show their earlier pages. Next, in this order: the words (jobs are not "requests", and nothing is called "runs"; proposed: Requests and Jobs as two sections of Tech, Load for the chart, and "operation" only in code); on the web, Tech without its Components and Production panels, Releases as a short line, and a quieter Logs chart; then Product and its features; then making a release ("Making a release", below).

Above the sidebar are a workspace switcher, a project switcher (the portfolio or one project) and search (⌘K). Above the content is the shared filter bar: component (ran in or started from), environment, release, feature, person or account, and period. The filters stay when I move between modules, so "Export in the iOS app" stays selected from Analytics to Logs. Lists and groups have the filter bar; an item's page has none, because it shows one thing whole (Experience, "Lists, groups and items").

| Group | Module | Use it to | Contains | Phase |
| --- | --- | --- | --- | --- |
|  | Today | See what needs you now | Incidents, due decisions, missing data, opportunities | v1 |
|  | Portfolio | Compare all projects | Purpose, stage, spend, revenue, value, quality, coverage, next decision | v1 |
|  | Customers | See each person and account | List, customer page, accounts | v1 |
|  | Decisions | Track questions, actions and outcomes | Open decisions, review dates, outcomes | v1 |
|  | Feeds | Watch chosen events live, across projects | Feeds, their entries, alerts | v1 |
| Product | Analytics | See how people use your apps | Value events, funnels, retention, paths, acquisition, web traffic | v1 |
| Product | Features | See one feature across all modules | Catalog, scorecard, feature pages | v1 |
| Product | Feedback | Collect bugs, ideas and questions from users | Inbox, ideas board, votes, replies | v2 |
| Product | Reviews | Read and answer store reviews | App Store and Google Play reviews, replies | v2 |
| Product | Experiments | Find the variant that gives more revenue and retention | Experiments, holdouts, results | v3 |
| Product | Surveys | Ask users questions | Surveys, NPS, cancellation reasons | v3 |
| Engineering | Errors | Find crashes and exceptions | Error groups, readable stack traces, affected customers | v1 |
| Engineering | Logs | See what your apps report as wrong | Errors and warnings with how often each occurs, search, the logs of one trace | v1 |
| Engineering | Performance | See the load, and what got slower: each operation, screen and query against its usual | The load over time, operations, database queries, external calls, screens, the trace of one operation | v1 |
| Engineering | Uptime | Make sure that apps are available and jobs run | Cron check-ins, certificates | v2 |
| Engineering | Issues | Track bugs and tasks | List, statuses, links | v2 |
| Delivery | Releases | See what you shipped, who updated, and what changed | Releases, store rollout, impact | v1 |
| Delivery | Versions | Control which app versions can run | Version adoption, update prompt, force update, API check | v1 |
| Delivery | Flags | Control what is on, and for whom | Kill switches first; then flags with audiences, and remote config | v1 |
| Delivery | Changelog | Tell users what is new | Entries, What's new in the app, public page, digest | v2 |
| Engage | Audiences | Define who gets a message, a flag or a prompt | Segments, consent, eligibility | v2 |
| Engage | Campaigns | Send one message to many people | Push, email and in-app sends, schedules, results | v2 |
| Engage | Templates | Keep the messages of each brand consistent | Email and push templates, brands, languages | v2 |
| Engage | Journeys | Send messages automatically, step by step | Welcome, trial ending, win-back, What's new | v2 |
| Business | Revenue | See the money that comes in | MRR, payments, net receipts, failed payments | v1 |
| Business | Spend | See the money that goes out | Operating, development, distribution, overhead | v1 |
| Business | Inventory | Track what you own and when it expires | Domains, certificates, keys, accounts, subscriptions | v2 |
| Automation | Incidents | Follow each anomaly to a verified recovery | Open incidents, detectors, monitors, evidence, timeline | v1 |
| Automation | Agent runs | See what agents investigated, changed and spent | Runs, actions, outcomes, cost | v2 |
| Automation | Policies | Set what agents can do | Authority by action class, budgets, release policy | v2 |
| Automation | Workflows | Run processes step by step | Release announcements, notify voters, incident steps | v2 |
| Public | Pages | Give each project its public pages | Changelog, ideas board, status, privacy, terms, support, download link | v2 |

Settings are at the bottom of the sidebar: projects and components, blueprints, the feature catalog, members, integrations, SDK keys, data and privacy, and the usage of Cluenori itself.

A module stays hidden until its phase ships, so version 1 shows only what is ready. This table is the only place where phases are set. An engine can ship before its page: the Audiences engine serves version policies in version 1, before the Audiences page exists. A Today detector appears only when the module behind its action ships.

### How modules link

Each module is worth using alone (Experience, "Each product alone, better together"); these links are what makes them better together. Linked through the shared scope (release, component, feature, person), releases, performance, logs, features, flags and analytics give a developer, a product person or an agent the full context, fast. A link appears by itself when both sides have the data, and a page never shows an empty section because another module isn't used. So each page filters by and links to the others, the API offers agents the same joins, and a module's first slice says which modules it links to and which links wait for modules not built yet.

Each object has its own page and a permanent URL. Objects are projects, components, flags, releases, errors, customers, features, issues, incidents, decisions, agent runs, ideas, feedback items, changelog entries, campaigns, journeys and version policies. In other modules, an object shows as a chip.

1. **Chip:** shows the icon and the name of the object, for example a flag in a release.
2. **Hover:** shows a small card with the status and the important numbers.
3. **Click:** opens a side panel with the important data and actions, for example "turn on the flag". You stay on the same page.
4. **Open:** goes to the full page of the object. ⌘-click opens it in a new tab.

Each object page has a Related section, in groups by module. For example, a release shows the flags that it changed, new errors, closed issues, shipped ideas and its changelog post. The page of that flag shows the releases that contained it and the customers who saw it. All links go in two directions. Each point on a chart opens the customers behind it. The MCP tools use the same links.

## Today: the attention queue

Today uses a fixed set of detectors, not a query builder. Each item shows the evidence, its coverage, the affected customers and one action. Today sorts items by the money at risk, then by the number of affected users.

| Insight | Evidence | Action |
| --- | --- | --- |
| A new crash in a release affects paying customers | Crash count, customers, MRR at risk, release | Turn off the flag. Open a task for an agent with the stack trace and the customer timelines. |
| An operation or query is slower after a release | p95 before and after, the release, the slowest traces | Open the traces. Turn off the flag. |
| Most reporting devices are on an old version | Version adoption, MRR on old versions | Set a recommended or minimum version. Send an update message. |
| The usage of a customer decreased a lot | Weekly usage of the customer | Open the customer page. Send an email. |
| You can recover failed payments | Failed charges for each customer | Try the payment again. Send a reminder. |
| A customer or plan costs more than it pays | Cost and revenue | Set a usage limit. Examine the price. |
| Customers who pay a lot ask for a feature | Votes, weighted by what voters pay | Mark the idea as planned. Tell the voters. |
| A paying customer reported a bug | The feedback item, plan, MRR and session trail | Reply. Make an issue. |
| Activation decreased after a release | Activation before and after the release | Compare the releases. Turn off the flag. |
| Reviews of a release are worse than before | Stars and topics of reviews by version, with the sample size | Reply to the reviews. Open an issue. |
| Spam complaints rise for a sending domain | Complaint and bounce rates, the campaign | Pause the campaign. Check the audience. |
| A domain, certificate or key expires soon | Days until expiry, the projects that use it | Renew it. |
| A project has spend but no users for 60 days | Users and spend in the last 60 days | Mark it for sunset. Archive it. |
| A project sends no data | Last event time, expected events from the factory contract | Fix the instrumentation. Never read it as zero users. |
| A decision is due for review | The decision record and the new data | Record the outcome: helped, harmed, inconclusive or abandoned. |

Each item links to its evidence. Today marks results from small samples and never shows missing data as zero.

## Feeds: chosen events, live

Decided on 2026-10-26. A feed is a live list of events that I chose, across my projects, with an alert on my phone for each one if I want it. "Registrations" shows everyone who signs up in any project; "Purchases" every purchase.

The same moment has a different name in each project: `user.registered` in Notes, `signup_completed` in Folio. So a feed has a name, its sources (one or more pairs of a project and the name of the event its apps send there), and its alert level: none, quiet, or time sensitive. A feed never rings like an alarm; alarms are for things that are broken.

- **The feed's page** shows its entries, newest first, as they arrive: the project, the event, when, the component and release it came from, the country, and the person, who opens their page. New entries appear within about a minute of reaching Cluenori, without a reload. Above them: how many arrived today and in the last 7 days, by project.
- **Alerts** name the feed, the project and what is known without personal data: "Folio · Registration, Germany, iOS 2.4.0". One alert for each entry, and at most one a minute for each feed: more in that minute become one alert, "12 Registrations: Notes 9, Folio 3".
- **Sources** are the events that apps send with `track`, now. Events from backends and payments (a Stripe purchase) join the same feeds when Cluenori receives them.
- **Who:** the owner makes, changes and deletes feeds. Each member sees the entries of the projects that they see, and gets their alerts.
- **Kept:** each feed's entries for 90 days. A feed only watches: it changes nothing in its projects, and stopping it loses no events, which stay in Analytics.

A feed is the first use of one meaning with many names across projects. Portfolio numbers (registrations per project per week) and agents' questions ("which projects got purchases this week?") read the same definitions later.

## Customer and feature pages

I and the agents use these pages most: the customer page, the feature scorecard and the feature page.

### Customer page

- **Header:** plan, MRR, lifetime revenue, margin, health score, acquisition source, platforms and app version.
- **Timeline:** one list of all customer activity: events, sessions, errors, slow traces, payments, failed charges, plan changes, flag exposures, messages, feedback, survey answers and support messages.
- **Session trail:** the screens and actions before an error. This is a list of events, not a video.
- **Cost to serve:** the AI tokens, emails, storage and requests of this month, compared with what the customer pays.
- **Other projects:** my other projects linked to this person by a verified link, with the purposes that the person agreed to.
- **Actions:** turn on a beta flag, send an email or a push notification, refund or extend where the payment source allows it, export or delete all data of the customer (GDPR), and ask an agent about the customer.

### Feature scorecard

The scorecard has one row for each feature, and agents read the same rows through MCP. A label (keep, fix, grow or remove) is a recommendation after an investigation, not an automatic judgment.

| Column | Shows |
| --- | --- |
| Funnel | Availability, exposure, successful use and repeat use |
| Adoption | Successful use among the eligible population, not among all users |
| Retention difference | The retention of users of the feature, compared with similar users who did not use it |
| Health | The error rate and latency of the routes and screens of the feature |
| Cost | The AI, infrastructure and third-party costs of the feature, with precision labels |
| Associated revenue | The MRR of customers who use the feature. You cannot add it up across features. |
| Demand | Open ideas and votes, weighted by what voters pay |
| Last change | The last release or configuration change that affected the feature |

A row can show "insufficient evidence". A retention difference is a correlation, not a cause.

### Feature page

A feature page shows one feature across all modules. A switch at the top selects all components or one component, for example the iOS app.

- **Usage:** the funnel from availability to repeat use, and adoption among eligible users.
- **Engineering:** the operations, screens and queries of the feature, with p95 and error rate. Its error groups, logs and slowest traces.
- **Delivery:** its flags and their exposure, the releases that changed it, and its changelog entries.
- **Voice:** its ideas, votes, bug reports and store reviews.
- **Money:** its cost and associated revenue, with precision labels.
- **Decisions:** open and past decision records about the feature.

The feature catalog lists each feature with its key, stage and tagging rules. For each component, it shows the share of data that has no feature.

## Performance, errors and logs

Three engineering modules answer three questions. Each module links to the other two. They read three kinds of data: product events (what people did), operations (what your services did) and errors (what broke).

| Module | Question | Views |
| --- | --- | --- |
| Performance | How much load is there, and is each operation, screen and query fast? | The load over time; operations, database queries, external calls, screens and web vitals; the trace of one operation |
| Errors | What broke, and whom did it affect? | Error groups, readable stack traces, affected customers |
| Logs | What did the apps report as wrong? | Errors and warnings with how often each occurs, search, and the logs of one trace |

There is no separate page to search traces. The trace of an operation opens from an error, from a slow point on a chart, or from a customer timeline. It is a waterfall of the steps, with their queries, external calls, logs and error. This is the evidence that an agent gets to find a root cause.

Metrics (CPU, memory, queue depth and custom counters) comes later, when a need shows. Hosts such as Cloudflare report their own runtime metrics, and a custom counter is a product event or a field of an operation. Live tail and log patterns also come later.

### Performance in detail

- **Load:** operations per minute over time, for the project, one component or one operation.
- **Operations:** one row for each operation with its count, average, p50, p80, p95, p99, error rate and total time (count × average). Sort by total time to find the operation that uses the most time in total, not only the slowest one.
- **Database queries:** queries in groups by shape, without values. Each group shows calls, total time, p95, rows returned and the operations that use it. A warning shows N+1 patterns: an operation that repeats the same query many times in one trace.
- **External calls:** third-party APIs, for example Stripe, OpenAI or email providers, with latency and error rate. This shows which provider has the outage.
- **Screens:** screen load time and app start time on mobile, and Core Web Vitals on the web.

Each row shows whether it got slower than usual, the change from the previous release, the sample size, and a link to retained example traces.

### Data sources

Backends send standard OpenTelemetry traces and logs. Web frameworks, HTTP clients and database drivers send them without more code, for example ASP.NET Core and Entity Framework Core in .NET. The mobile and web SDKs add screens and web vitals. Cluenori keeps OpenTelemetry metrics in its archive but does not show them yet.

An operation is what a service does, by name, such as a normalized route: an HTTP request it answers, a message it processes, or a job it starts. When its trace arrives, Cluenori turns each time it ran into one row: operation, status, duration, database time, query count, slowest query, external calls, error, person, feature and release. The charts come from these rows: operation counts, error counts and latency distributions for each operation, environment and release. Counts are exact, and percentiles are within 2% of the true value, which the charts say.

Cluenori keeps every export it receives in an archive for 90 days, with emails, tokens and card numbers removed. Thus the full trace and every log line of any trace, failed or not, can be opened for 90 days, and new views can be built from data that arrived before them.

Cluenori's own Worker and apps will report to Cluenori too, as a project of their own. It must not loop: the Worker never traces or logs its own ingest (`/otlp/*`) or its exporter's requests, and a failed export is never exported.

| Data | Kept for |
| --- | --- |
| Product events | 5 years |
| Every export: traces, logs and metrics, in the archive | 90 days |
| Warnings and errors, searchable | 90 days |
| Counts (by operation) | By the minute for 14 days, and by the hour for 15 months, in the database of each project |
| Error groups | 15 months after they were last seen |
| Other records | Until you delete them |

### Errors and crashes

Crashes on iOS and Android, and exceptions on the web and on backends, are grouped by their stack. The release pipeline uploads dSYM files, R8 or ProGuard mapping files and source maps, so the stacks are readable. Each group shows the release where it started, the affected customers and MRR, the feature, and the session trail before the error.

## Incidents and alerts

Nobody watches a dashboard. Cluenori checks each project every minute and tells me when something is broken, on my phone: once for each problem, and once when it recovers.

### Detectors

A detector is a fixed rule that opens an incident. It compares each measure with its own usual, as "Quality: worse than usual" in the vision says, so I set no thresholds.

| Detector | Opens an incident when | Alert |
| --- | --- | --- |
| Down | A monitor's URL fails two checks in a row | Alarm |
| Failing | An operation's error rate over the last 15 minutes is at least 2% and three times its usual, with at least 5 failures | Alarm |
| New error | An error group appears for the first time | None; the morning brief |
| Slower | An operation's p95 over the last day is at least 1.5 times its p95 over the 7 days before, and at least 100 ms more | None; the morning brief |
| Quiet | An operation that usually runs about every N minutes, as Cluenori guessed from its history, hasn't for a while: "GET /api/sync usually runs about every 31 minutes; nothing for 3 hours. Maybe fine: Cluenori guessed this from its history." Shown where Slower shows, with "Monitor this" | None; the morning brief |

Every alert must be real, so nothing guessed ever alerts (decided on 2026-10-26). Cluenori used to learn a "schedule" from how an operation ran and open "stopped" when it missed one; an endpoint an app called about every 31 minutes was taken for a job and alerted. That guess is now only the Quiet hint, which never opens an incident or sends a push. Incidents opened as "stopped" before stay readable, and never notify.

### Monitors

A monitor is what I set up: a subject, a condition, and a level. Down and Failing need nothing; a monitor is for what Cluenori can't know by itself, such as which operation is a job, or how many failed sign-ins are too many.

| Condition | Subject | Fires when | Example title |
| --- | --- | --- | --- |
| Doesn't answer | A URL, such as a component's health endpoint | Two checks in a row fail (Down) | `https://notes.example/health is down: HTTP 503` |
| Nothing for N | An operation (a job) or an event | None in the last N minutes | `cleanup.run hasn't run for 30 minutes` |
| More than N in a window | An error, a log message or an event | More than N in the last M minutes | `Error 3f9c… happened 14 times in 1 hour, more than 10` |
| Latency above X | An operation | Its p50, p95 or p99, as chosen, over the last M minutes is above X ms, with at least 5, 20 or 100 runs; fewer are unknown, never an alert | `GET /api/card p95 820 ms, above 500 ms` |
| Error rate above X | An operation | More than X% of its runs failed over the last M minutes, with at least 5 runs | `GET /api/card: 12% failed, above 5%` |

Its level is alarm, time sensitive or quiet (no push); a URL monitor is an alarm by default, others time sensitive. Each is set up in one step: "Monitor this" on an operation's, error's, log message's or event's page offers the conditions that fit it; Uptime adds a URL; and `./cluenori monitor add` does both. It is removed just as explicitly, and removing it resolves its open incident. Each is looked at in the minute's check, from the counts Signals already keeps. No formulas, query language, combinations or rule dashboards.

A small app is silent for hours at night, so silence alone cannot tell "down" from "no users": that's why a URL monitor fetches, and why "nothing for N" is set by someone who knows the subject.

### Incidents

An incident is one problem from its start to its recovery, one for each detector and subject: an operation, a monitor or an error group. It alerts me once when it opens, at its detector's level (a monitor's own), and again only when it gets worse. It resolves after 10 minutes without the problem and tells me "Recovered", quietly. A problem that returns within 30 minutes reopens the same incident, with a time-sensitive alert. Acknowledging an incident stops its alerts. Each incident keeps its evidence: the chart of its window, the error group behind it and a few failed traces.

Every alert goes out when it happens, a minute or two after the problem starts. There are no quiet hours.

### How alerts reach me

Alerts reach the Cluenori iOS app through APNs, at three levels:

| Level | What it does | For |
| --- | --- | --- |
| Alarm | Rings through silent mode and Do Not Disturb, like an alarm clock | Down, Failing, a monitor set to alarm |
| Time sensitive | Breaks through a Focus I allow it in, and follows the silent switch | A monitor set to it (a job that stopped), a reopened incident |
| Quiet | A notification without a sound, which doesn't light the screen | Recovered, Acknowledged |

An alarm is an AlarmKit alarm: the push wakes the app's notification extension, which starts one, and it rings through a locked phone, silent mode and Do Not Disturb. It needs no entitlement from Apple. It says what is down, rings our own siren in the app's red, and has an Acknowledge button that acknowledges the incident and stops it.

A push names the project, the detector and what it saw: "notes · Failing: POST /api/export, 18% failed, usually 0.1%". Acknowledge is one press on the notification itself.

When a push cannot be delivered, Cluenori tries again, then shows the failure on Today. When the checks themselves stop, Today says since when. If Cluenori itself is down, the outside watcher tells me: a GitHub Actions schedule in a repository I name (`@cluenori/watcher`) checks its health every 5 minutes and rings my phone through APNs, with Telegram and email too. Email, Slack and the morning brief come later.

### The iOS app

The app shows nearly everything the web shows: Today, each project's overview, its load and the latency of every operation at p50, p80, p95 and p99, errors with their stacks, logs, incidents and monitors. A trace's steps open on the web. It opens instantly with what it last saw, says when that was, and keeps it when the network drops.

A phone joins by scanning a code the web shows for 10 minutes, and gets its own key; the API token stays on my computer. The web lists every phone: its model as people call it (iPhone 17 Pro), its iOS and app versions, the address and country it last called from, and when. I can remove any one of them.

The app is private: I install it from my own TestFlight, never the App Store. It needs iOS 27. A deployment sends with its owner's APNs key to the owner's own build of the app.

## Releases, versions, changelog, flags and issues

Each release has a page that connects the code to the customers: what you shipped, who got it, and if it helped.

### Release page

Cluenori makes a release from a git tag, a store build or a deploy. The release page shows:

- **Shipped items:** the merged PRs and commits since the last release, in groups by feature (from PR labels or file paths), and the issues and ideas that the release closes.
- **Rollout:** platforms, the progress of the App Store phased release and the Google Play staged rollout, version adoption, and the flags that you turned on with the release.
- **Impact, compared with the previous release:** crash-free sessions, new error groups, latency, the activation and retention of users on this version, and store rating.
- **Notes:** an internal summary for you and a note for your customers.

### Making a release

Decided on 2026-10-23:

1. Release starts from the latest commit on main; Change picks another.
2. Cluenori suggests the version, and I can change it.
3. AI drafts the notes, with a choice of model. Write again drafts them again, and Edit prompt changes the project's notes style, which drafts follow.
4. I choose the environment, then Release.

The release page then offers one next step, with the same notes: Promote to the next environment, Send to App Store review, or Release to everyone. Not built yet: the New release sheet, the choice of model, and the one next step on the release page, such as Release to everyone first for a build that App Store review approved.

### Versions and force update

The Versions page shows, for each component, the versions in use and the people and MRR on each one. Three numbers stay separate:

- **Store rollout:** the progress of the App Store phased release or the Google Play staged rollout. It is not installed adoption.
- **Observed version adoption:** the version last seen on reporting devices, for example "64% of reporting devices active in the last 30 days were last seen on version 2.4". The current version of inactive devices is unknown.
- **Feature exposure:** the users who actually got a capability or a flag variant.

To force an update:

1. Open the component and select the oldest version to keep.
2. Choose the policy: a soft prompt that the user can close, or a hard block. Target all users of the component, or an audience.
3. Check the preview: the people and MRR on the blocked versions, the devices that cannot update because their OS is too old, and the store rollout. A hard block needs a 100% rollout on Google Play.
4. Set a grace period. Cluenori shows the soft prompt first, then the hard block on the date.
5. The SDK shows the update screen at start and on resume. The API returns an "update required" error to blocked versions, with the same text.
6. Review the result: update completion, people lost, and new feedback. Cluenori keeps it as a decision record.

The app can block only builds that contain the update gate. If the device is offline, the SDK uses the last policy that it received. A device that cannot update gets the soft prompt or a "device not supported" screen, by policy. A maintenance message uses the same screen when a backend is down.

### Changelog

A changelog entry has a title, a type (new, improved or fixed), a body with images or video, the components and features that it covers, an audience and languages. I write it from a release, or alone, for example for a change on the server. One entry publishes to five places:

- the What's new sheet in the app after the update, and an unread badge on the changelog list,
- the public changelog page, with RSS,
- an email digest for subscribers,
- a push notification, when I choose one,
- the release text for the stores.

Cluenori counts the views of each entry, and the use of the feature after a view. From PRs to an entry:

1. Merge each PR with a feature label.
2. Make a release. Cluenori puts the PRs in groups by feature.
3. AI writes draft notes in simple words from the PR titles and descriptions. Edit the draft.
4. Add visuals: screenshots, short videos, GIFs, or before-and-after images.
5. Publish. Cluenori updates the public changelog page, the "What's new" sheet in your apps, the email digest, an optional push notification, and the release text for the stores.
6. Cluenori tells each user who voted for a shipped idea, and moves the idea to Shipped.

### Flags, remote config and experiments

- Target users by customer, plan, platform, app version or percentage. On mobile, kill switches and a minimum app version are the most important, because store review makes fixes slow.
- Each flag shows the customers who saw it, and the errors and conversion with the flag on and off.
- Experiments use revenue and retention as results, not clicks.

### Issues

Cluenori has a small issue tracker: a title, a status, and links to customers, errors and releases. You make an issue from an error group, an incident, an idea or a store review, or manually. Each issue shows the affected customers and the MRR at risk. It links to the PR that fixes it and the release that ships it. GitHub sync can come later.

## Feedback and reviews

Users report a bug, suggest an idea or ask a question from the app, the website or by email. The SDK form attaches context automatically: the component, version, device, session trail, recent errors, and a screenshot with marks if the user adds one. It never attaches text that the user typed on other screens.

- **Inbox:** new items for each project, with the plan and MRR of the author.
- **Triage:** link an item to a feature, merge duplicates (an agent proposes merges), make an issue, or make a public idea.
- **Ideas board:** public ideas with votes and a status: under review, planned, in progress or shipped. It shows in the app and on the public page.
- **Reply:** answer the author in the app inbox or by email. The thread stays on the customer page.
- **Close the loop:** when a release ships an idea, Cluenori moves it to Shipped and tells each voter.
- **Store reviews:** App Store and Google Play reviews arrive in the same inbox, by component and version. I reply from Cluenori. The Google Play API returns only recent reviews, so Cluenori collects them each day.

Feedback text is untrusted. Agents read it as evidence, never as instructions.

## Engage: audiences, campaigns and journeys

Engage reaches people in one project or across projects. Campaigns, journeys, flags and update prompts use the same audiences, consent rules, templates and results.

### Audiences

| Condition | Example |
| --- | --- |
| Component and platform | All users of the Notes iOS app |
| Version | iOS users on a version below 2.4 |
| Plan and money | Trial ends in 3 days; a failed payment |
| Behavior | No core value event in 7 days; used Export more than 5 times |
| Feature and flag | Saw the new editor; voted for an idea |
| Place and language | Country, language, time zone |
| Consent | Opted in to product news by email |

An audience is a saved rule, not a fixed list. Version audiences resolve to installations: a person with an iPhone on 2.3 and an iPad on 2.4 gets the prompt only on the iPhone. Cluenori evaluates it when a send starts, or for one person at the edge. Each send removes duplicates, applies frequency limits and suppression lists, and records why each person was eligible.

### Campaigns

A campaign is one send, now or at a set time, on one or more channels. Examples: "Update to 2.4" to all iOS users on older versions, a product update email to all paying customers, or "Try my other app" to opted-in users of three projects. A campaign can use the local time of each person. Results show delivery and the effect on a goal event, for example installs of the other app. Large sends fan out through Queues, because APNs and FCM take one device for each request.

### Journeys

A journey enrolls each person once, with a goal, a holdout group, and rules for exit and re-entry. Its steps are a trigger, waits, conditions and sends. Examples: a welcome series, a trial-ending reminder, a failed-payment reminder, a win-back email after 30 days without use, and What's new after an update. The holdout group gets nothing, so I see the real effect. Journeys are step lists in a form or in code, not a drag-and-drop canvas.

Journeys run on the Workflows engine, but their enrollment state lives in the database of the project. Workflows keeps finished instances for only 30 days and limits how fast new instances start. Thus a large enrollment goes through a queue.

### Channels

| Channel | How | Rule |
| --- | --- | --- |
| iOS push | APNs with a token key | Promotional push needs an explicit opt-in and an opt-out in the app |
| Android push | Firebase Cloud Messaging | The same consent rules as iOS |
| Web push | VAPID, in browsers and home-screen web apps | The browser asks for permission |
| In-app | The manifest and the inbox | Shows on the next open, without a permission |
| Email, transactional | [Cloudflare Email Sending](https://developers.cloudflare.com/changelog/product/email-service/) (public beta since April 2026) or another provider | Receipts, sign-in links, alerts |
| Email, marketing | A bulk provider, for example Amazon SES, Postmark or Resend | A separate subdomain for each project |

### Email rules

Each project sends from its own domain, and its marketing mail uses a separate subdomain. This limits the damage that one project can do to another, but it does not remove it: a provider can pause a whole account, shared IP pools link senders, and Gmail adds the volume of subdomains to their primary domain. Thus a project with a large list gets its own provider account or sub-account, and a new domain warms up slowly.

Gmail requires senders of about 5,000 or more messages a day to use SPF, DKIM and DMARC, to support one-click unsubscribe (RFC 8058), and to honor unsubscribes within 48 hours. The spam rate should stay below 0.1% and must never reach 0.3% ([summary](https://www.suped.com/email-deliverability/answers/what-are-the-gmail-sender-requirements-for-one-click-unsubscribe-and-where-should-the-links-be-p)). Cluenori adds the headers, keeps the suppression lists, and pauses a campaign when complaints rise. Each brand has a postal address in the footer where the law requires one.

Opens are not reliable, because Apple Mail Privacy Protection loads images in advance. Thus goals use events, not opens.

### Consent and subscriptions

Consent is a record, not a flag. It holds the person, the purpose or topic (product news, changelog, promotions), the channel, the wording version, the source, the time, and a double opt-in where the law requires it. Each project has a preference page with its topics. A contact can be only an email, for example from a waitlist or a changelog subscription. Imported contacts keep their source and their proof of consent.

### Templates

Each project has a brand: name, icon, colors, sending domain and footer. Templates use Markdown with variables, in each language. Agents send only from templates that I approved.

## Workflows

Workflows run processes step by step, with one instance for each event on a record. Journeys use the same engine, with one enrollment for each person. Each step is an action, so it follows the policy and goes to the audit log.

| Trigger | Steps |
| --- | --- |
| A release reaches all iOS users | Publish the changelog entry, send What's new to opted-in users, review adoption after 7 days |
| An idea moves to Shipped | Tell the voters in the app and by email |
| Complaints for a campaign pass 0.1% | Pause the campaign and tell me |
| An error group crosses its threshold | Open an incident, start an Amp investigation within the policy |
| A project sends no data for 7 days | Ask me to check the instrumentation |
| A domain expires in 30 days | Ask me to renew it, or renew it when the policy permits |

## Spend and cost per customer

Spend uses the four categories of the vision: operating, development, distribution and shared overhead. Each amount has a precision label: reported, estimated or allocated.

### Sources

| Source | Examples | How Cluenori gets it | Precision |
| --- | --- | --- | --- |
| Infrastructure | Cloudflare, Vercel, AWS | Usage or billing APIs, by resource or tag | Reported or estimated |
| Runtime AI | AI provider API keys | One key for each project, or the `cost()` call | Estimated from tokens |
| Store fees and taxes | App Store, Google Play | RevenueCat or store reports | Estimated until reconciled |
| Payment fees | Stripe | Payment provider API | Reported |
| Agents | Amp | Thread usage, collected each day, without double counts across parent threads and subthreads | Reported for the collected period |
| Fixed costs | Domains, developer program fees, subscriptions | Entered one time, divided by month | Allocated |
| Unknown | Anything that is not connected | A separate line | Unallocated |

### Cost for each customer

| Method | Costs | How |
| --- | --- | --- |
| Direct | AI tokens, emails, payment fees | Tagged with a customer and a feature when they occur |
| Metered | Requests, CPU time, storage | Usage for each customer from traces, multiplied by the unit prices |
| Allocated | Fixed bills | Divided by the share of usage of each customer |

This data gives five views: projects that cost more than they earn, customers who cost more than they pay, the cost to serve each plan compared with its price, the cost of each feature, and the costs that retirement would actually stop.

## Inventory

Inventory lists what I own and pay for, by project, with its expiry date and renewal cost. Today warns me before each expiry.

| Item | Examples | Source |
| --- | --- | --- |
| Domains and DNS | Domains, DNS records, email authentication records | Cloudflare Registrar and DNS APIs, or manual |
| Certificates and keys | TLS certificates, Apple distribution certificates, provisioning profiles, push credentials, Google service accounts | APIs where available, or manual |
| Accounts | Apple Developer Program, Google Play Console, store listings | Store APIs, or manual |
| Subscriptions | Vendors and tools | Spend sources |
| Secrets | API keys of providers, with their rotation date | Manual. Cluenori stores the date, never the secret. |

## Public pages

Each project gets public pages on its own domain or a subdomain, with its brand:

- a changelog, with RSS and an email subscription,
- an ideas board with votes,
- a status page, from Uptime and incidents,
- a privacy policy and terms,
- a support and contact form, which makes feedback items,
- a download link that opens the right store for each device,
- a waitlist form before launch, which adds people to an audience.

The data inventory lists what each component collects, from its SDK settings. Cluenori uses it to draft the privacy policy, the App Store privacy details and the Google Play Data safety answers. I check them and submit them myself.

## Proposed: knowing each feature in the field

Proposed on 2026-10-23, not yet decided. Each item extends a page above rather than adding a module.

- **Field health per feature.** The SDK wraps each `feature()` in a MetricKit signpost named by its key, so iOS reports CPU time, memory, disk writes and hitch rate per feature, every day, from real devices. A screen declares its budgets: first frame, tap to next frame, requests, bytes and memory. The SDK measures them in a sample of sessions. Both appear on the feature page's Engineering row, by release and device class.
- **A rollout that stops itself.** During an App Store phased release, Cluenori compares each feature's crashes, hangs, hitches, energy and working number with the release before. A regression beyond its noise pauses the rollout and alerts the feature's owner. Resuming is my action.
- **Intents and outcomes.** `intent('export.share')` opens what a person set out to do; it ends as done, abandoned at a step, or failed with an error code, across screens and launches. The feature page shows unfinished intents, and frustration counted without recording the screen: repeated taps, taps on what isn't tappable, back-and-forth between two screens, long hesitation. Searches that find nothing count as demand.
- **Events as a contract.** Events and funnels are declared in the feature catalog, and Swift, Kotlin and TypeScript types are generated from it. An unknown event doesn't compile, and ingestion refuses one.
- **Replay by real views.** For an app whose views draw only plain data, the SDK keeps the last minute of each screen's state in memory. A crash or a feedback report carries it, and so does a support session the person agrees to. Fields marked personal are never kept, and other people's records are kept by ID only. The replay renders the app's own views at that release, step by step, so a developer or an agent sees exactly what the person saw, and can turn it into a failing test.

## SDK and integrations

The SDK has a few calls, and ready views for the client kit (Foundation). Integrations add money, code, store and deploy data without more code.

```ts
init({ project: 'notes', component: 'notes-ios', environment: 'production', release: '2.4.0' })
identify(userId, { account: accountId, plan: 'pro', email })
consent({ analytics: 'full', productNews: true, promotions: false })

feature('editor.export', async () => {   // events, spans, logs and costs inside get the key
  track('export.completed')                // a core value event
  cost({ vendor: 'openai', tokens: 1840 })
})
flag('new-editor')                         // the variant from the manifest; records the exposure

// Client kit views, driven by the manifest
updateGate()   // soft prompt or hard block, by the version policy
whatsNew()     // unread changelog entries after an update
feedback()     // a bug, an idea or a question, with context attached
inbox()        // in-app messages and replies
registerPush() // asks for permission at a chosen moment, then sends the device token
```

In .NET, the backend helpers sit on OpenTelemetry:

```csharp
builder.Services.AddCluenori(o => o.Project = "notes");
app.UseCluenoriVersionPolicy();                                  // "update required" error for blocked app versions
app.MapPost("/api/export", Export).WithFeature("editor.export");
```

On iOS, Android and web, the SDK automatically records sessions, screens, crashes, component version and device. It also shows update prompts, the update screen and in-app messages. The SDK has bounded memory, batching, retries and a telemetry budget for each project. If Cluenori is not available, the app continues to work. Each API request carries the app version and build in a header. Backends send OpenTelemetry data with the `cluenori.person` and `cluenori.feature` attributes when they are known. Put your user ID in the customer metadata of Stripe or RevenueCat. Then payments connect to customers automatically.

| Area | Integrations | Data |
| --- | --- | --- |
| Code | GitHub | PRs, commits, labels |
| Deploys | Cloudflare, Vercel, GitHub Actions | Releases, rollback |
| Payments | Stripe, Paddle, Lemon Squeezy, RevenueCat, App Store and Google Play notifications | Revenue, trials, churn, failed payments, fees |
| Stores | App Store Connect, Google Play Console | Builds, rollout, ratings, reviews |
| Spend | Cloudflare, Vercel, AWS, AI providers, email providers | Spend, if the provider supplies usage or billing data |
| Agents | Amp | Webhooks that start Orbs, agent spend |
| Messages | APNs, FCM, Web Push, Cloudflare Email Sending, Amazon SES, Postmark, Resend | Delivery, bounces, complaints, unsubscribes |
| Domains | Cloudflare Registrar and DNS | Domains, records, expiry dates |
| Notifications | iOS push, Slack, Discord, email | Alerts, approvals and the daily brief |
