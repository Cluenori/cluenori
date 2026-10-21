# Cluenori: product vision

Oct 18, 2026 · @Aleksandr

Cluenori is the control room for my software factory, and my go-to tool for every project, app and business that I run. It helps me decide where my next hour and euro go, carry out that decision, and see whether it worked. It covers both sides of each project: the product side (users, value, money, messages) and the engineering side (speed, errors, releases). I build it for my own needs first. Other founders can use it when they see that it works.

This tab is the vision. Foundation lists the primitives that all modules share. Modules describes the full module catalog, with a phase for each module. Platform covers hosting, payments, privacy and the license.

## The problem

I am a solo founder, and I am obsessed with quality and performance. With AI agents (Amp and Amp Orbs), I build web, iOS and Android projects very quickly. But after a launch, I do not know what happens. Today I cannot see, in one place:

- that a project cost €50 in six months and has no users and no revenue,
- the latency of each operation, in each project,
- which features people use, and which features they ignore,
- that most iOS users never updated the app.

When I see a problem, I must go to another tool to act on it: force an update, message the users, turn off a feature or fix the code. Current tools are made for one product and a team. They charge for each project, seat or event. I need one tool for one person with hundreds of projects.

I also repeat the same manual work in each project. I build a force-update screen, a changelog, a feedback form, push and email sending, and flags again and again. Cluenori gives each new project these parts on its first day, through one SDK and one console.

My limit is attention, not code. Agents can build a project in a day, but I can watch only a few projects closely. [PostHog](https://posthog.com/pricing) already connects analytics, errors, business data and MCP, and its AI proposes pull requests. Cluenori is different in four ways: it operates many independent products as one portfolio, it sets up each project the same way at creation, it divides money and attention between projects, and it runs in my own account.

## Three jobs, two loops

Cluenori has three jobs. Each module must help with one of them.

| Job | Question |
| --- | --- |
| Operate | What needs my action now? |
| Invest | Which project, feature or distribution effort deserves more time and money? |
| Continue | Which project should grow, stay in maintenance, pause or retire? |

Two loops do this work, at two speeds. Both loops use the same evidence, decision records, controls and agents.

&#91;embedded content: two loops · engineering and product\]

The engineering loop starts with a regression and ends when the number recovers. The product loop starts with a bottleneck and ends with a reviewed decision. A latency regression can justify action in minutes. A weak week of retention justifies an investigation, especially when the sample is small.

## Principles

Eleven rules control what goes into Cluenori and what stays out.

- **Built for me first.** Each module solves a problem that I have in my own projects. Features that only other teams need wait until other teams use Cluenori.
- **Answers, not builders.** Each page answers fixed questions without setup. To change a view, edit its code or tell an agent to edit it. Journeys and messages use step lists and templates, not a drag-and-drop canvas.
- **Evidence shows its coverage.** Each answer shows its population, period, freshness and gaps. Missing data never shows as zero users, zero errors or good health.
- **Link what is known.** Each record has a source, a project and a time. It links to a customer, feature, release or trace only when that link is known.
- **One model for all modules.** Each module uses the same scope, features, people, audiences, activity, actions and ledger. Thus a new module works with all other modules from its first day.
- **Each action has an outcome.** A decision record keeps the question, the action and the result, so neither I nor an agent repeats a failed attempt.
- **The factory contract.** Each new project reports to Cluenori from its first deploy, and Cluenori checks that the data arrives.
- **Quality is measured against its own usual.** Each critical journey, operation, screen and app start is compared with its own recent past and with the previous release, not with a fixed limit that someone must set and keep current.
- **Cluenori governs, agents execute.** Cluenori decides what work is permitted, with which evidence, budget and authority. Credentials and APIs enforce these limits, not instructions.
- **One API for people and agents.** The dashboard and the MCP server use the same queries and actions, so revenue or activation has one definition.
- **You own the code and the data.** Cluenori runs in your Cloudflare account, keeps data in open formats, and shows its own spend as a project.

## The project model

A project is the business unit: one product and one investment. It contains components that release separately, for example an iOS app, an Android app, a web app, an API and scheduled jobs. Spend, revenue and value belong to the project. Versions and deployments belong to each component.

A feature is a capability of the project, for example Export. It can exist in several components. The feature is a filter on every module: analytics, operations, logs, traces, errors, flags, costs, feedback and releases. I can see Export in all components, or only in the iOS app. Without a filter, each module shows the whole project. Foundation explains how each record gets its feature.

&#91;embedded content: project model · 5 components × 4 features\]

Each project has a short operating profile. These fields let Cluenori interpret the numbers. A personal tool can succeed with one user and no revenue. An annual tax tool must not be judged by daily retention.

| Field | Sets |
| --- | --- |
| Purpose | Revenue, personal use, learning, infrastructure or experiment |
| Stage | Exploring, validating, growing, maintaining, paused or retiring |
| Core value event | The event that shows that a person got value, for example "export completed" |
| Usage cadence | Daily, weekly or occasional |
| Current objective | The result that I want now |
| Budgets | Operating spend, development spend and my attention |
| Critical journeys | The flows that must work, for example sign-up, checkout and export |
| Next decision | What I must decide, and when |

Cluenori keeps these concepts separate: project, component, feature, release, deployment, person or account, provider resource, change, and decision, action or agent run. A change can be code, a price, a campaign, a configuration or a store listing. Any change can explain a movement in the numbers.

A person belongs to one project by default, on all of its components. For B2B apps, send an account to `identify`. A link between the same person in two projects is a separate, verified record. Cluenori uses it only for the purposes that the person agreed to.

## Routines and the portfolio

Cluenori is organized around my recurring routines. The phone app is for the brief, approvals and controls. The web app is for deep investigation: traces, timelines and comparisons.

| Routine | When | Question | Where |
| --- | --- | --- | --- |
| Today | Each morning | What needs me now: incidents, due decisions, missing data? | Phone |
| Incident response | When a detector opens an incident | Is it real, and is it recovering? | Phone to approve, web to investigate |
| Release review | After each release | Did the release help or harm? | Web |
| Portfolio review | Each week | Where does my next hour and euro go? | Web |
| Ship and announce | When a release reaches its users | What must users know, and who must update? | Web |
| Decision review | On the review date | Did the action work? | Phone or web |
| Feedback triage | Each week | Which bugs and ideas matter most? | Phone or web |

The portfolio has one row for each project:

| Column | Shows |
| --- | --- |
| Purpose and stage | From the operating profile |
| Spend | Operating, development and distribution spend, with its precision |
| Revenue | MRR, net receipts and total investment, as separate numbers |
| Value | Core value events, and the number of people who got value |
| Quality | Pass or fail for the critical journeys |
| Coverage | Which data arrives, and which data is missing |
| Next decision | The open question and its review date |

Each number links down a level: from the portfolio to the project, then to one customer, feature, release, operation or error.

## From "going nowhere" to a diagnosis

"€50 spent and no revenue" does not tell me what to do next. Cluenori follows the path from cost to value and shows where the project stops. These are investigation paths, not automatic verdicts.

| What the evidence shows | What to investigate | Likely next step |
| --- | --- | --- |
| Costs, but no observed users | Missing telemetry, private use, or no distribution? | Check coverage and purpose |
| Almost nobody sees the product | Did the intended audience see it? | Run a small, bounded distribution test |
| Visitors arrive but do not activate | Audience, positioning, onboarding or a broken journey? | Examine the path to first value |
| Users activate but rarely return | Expected cadence, lasting value or disappointment? | Investigate repeat value |
| Users return but do not pay | Price, packaging, payment friction or willingness to pay? | Test a monetization hypothesis |
| Paying users hit failures | Which valuable journey fails? | Fix that reliability problem |
| Useful product, weak economics | Variable costs, price or extra infrastructure? | Examine the largest cost |
| Little value, continuing obligations | What would retirement actually remove? | Prepare a retirement plan |

Distribution is part of version 1. Without it, Cluenori would recommend features for products that nobody has seen. Past spend gives context, but the decision is about future spend: what can the next bounded attempt teach or earn, compared with another project? A distribution attempt is a record with a channel, spend, period and a tagged link. First-touch data from the SDK shows what each attempt brought.

## Decision records

A decision record turns an intervention into knowledge. After the project, it is the most important object in Cluenori.

| Field | Example |
| --- | --- |
| Question | Why do people start imports but rarely complete them? |
| Evidence | The import funnel, the p95 latency of the import route, feedback about imports |
| Hypothesis and alternatives | Import latency causes abandonment. Alternative: the file format is confusing. |
| Action and budget | Make the import path faster, with a development budget of €20 |
| Expected result | More completed imports, with the same cost and error rate |
| Review | Compare cohorts after 500 new import attempts |
| Outcome | Helped, harmed, inconclusive or abandoned |

Records connect engineering work to product value. Agents read them before they propose work, so they do not propose an intervention that already failed. Each review adds to what I know about my products.

## Economics

Spend is part of version 1, because it is at the center of the problem. Cluenori tracks four categories separately, and keeps my attention next to them.

| Category | Examples |
| --- | --- |
| Operating | Infrastructure, AI calls at runtime, storage, email |
| Development | Amp runs, other coding agents, build infrastructure |
| Distribution | Ads, campaigns, other acquisition spend |
| Shared overhead | Services and subscriptions that support many projects |
| Attention | A rough estimate of my maintenance time each month |

Each amount has a precision label:

- **Reported:** a transaction or an invoice from the provider.
- **Estimated:** measured usage multiplied by a rate. For example, RevenueCat [estimates](https://www.revenuecat.com/docs/dashboard-and-metrics/taxes-and-commissions) store commission and taxes.
- **Allocated:** a share of a common expense, by a stated rule.

Cluenori also shows unallocated expenses. A precise view that omits half of the bill is worse than an honest partial view. Two rules prevent wrong decisions:

- **Allocated cost is not avoidable cost.** If €3 of a shared subscription is allocated to an app, retirement does not save €3. The retirement view shows only the costs that would stop.
- **Revenue measures stay separate.** MRR, payments, net receipts, contribution and total investment are different numbers. "Revenue from customers who use a feature" is associated revenue. You cannot add it up across features, because one customer uses many features.

Agent spend needs continuous collection. Amp reports a cost for each thread. Its API reportedly keeps thread usage for only 90 days, so a six-month view needs Cluenori to collect usage each day.

## Trustworthy evidence

Cluenori keeps three classes of data, with different rules.

| Class | Examples | Rule |
| --- | --- | --- |
| Business facts | Payments, expenses, value events, decisions | Durable, deduplicated and traceable |
| Operational measurements | Operation counts, error counts, latency distributions | Aggregated from the observed traffic |
| Diagnostic evidence | Traces, detailed logs | Kept by explicit sampling and retention rules |

Each insight shows its population and denominator, its comparison period and cohort, the data freshness, the sampling or collection gaps, the attribution method and the remaining uncertainty. Missing data never shows as zero.

Sampling is stated, not hidden. Operation counts are exact and their percentiles are within 2%, and charts say so. To keep a trace because it was slow or failed, Cluenori must see the completed trace before it decides (tail sampling). Thus a chart point opens retained examples. It does not promise every trace behind the point.

## Act from the same place

When I see a problem, I act in Cluenori. Each action goes to the audit log and can link to a decision record.

| Action | How it works |
| --- | --- |
| Manage app versions | See store rollout, observed version adoption and feature exposure as three separate numbers. Set a soft update prompt, or force an update with a hard minimum version when I stop support for old versions. Cluenori first shows the people and MRR that a block affects. |
| Turn a feature on or off | Flags and kill switches, by customer, plan, platform or version |
| Message users | Push, in-app message or email to an audience, for example all users of an app or of one version. Send once as a campaign, or automatically as a journey. Cluenori checks the eligibility of each person. |
| Tell users what changed | Publish one changelog entry. It goes to What's new in the app, the public page, an email digest, a push notification and the store release text. |
| Answer feedback | Reply to the author, link the item to a feature or an issue, and change its status. Voters hear when it ships. |
| Help one customer | Send a message or turn on a beta flag from the customer page. Refunds and trial extensions depend on the payment source: Stripe allows both, and the App Store allows only a limited extension of the renewal date. |
| Roll back | Turn off the flags of a release. On the web, deploy the previous version through the deploy integration. |
| Give work to an agent | Open an investigation or a task with its evidence, scope and budget |
| Retire a project | Follow a checklist: tell the users, meet obligations, export the data, stop the services and their costs, then verify each step |

Version numbers need precise words. Apple's [phased release](https://www.developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases) sends automatic updates over 7 days, but anyone can update manually at any time. Thus store rollout is not installed adoption. Cluenori says, for example, "64% of reporting devices active in the last 30 days were last seen on version 2.4". A minimum version cannot install a new build. It can only prompt or block, and only in builds that contain the update gate. On Android, the SDK can use the Play [immediate update flow](https://developer.android.com/guide/playcore/in-app-updates) for apps installed from Google Play. Modules describes the safe steps of a force update.

Messages have an audience model. "Tell the users affected by this incident" and "Try my other app" have different purposes. For each send, Cluenori finds eligible people by purpose, channel and brand. Then it removes duplicates and applies frequency limits and suppression lists. Promotional push needs an explicit opt-in and an opt-out in the app (Apple guideline 4.5.4, [summary](https://betanews.com/2020/03/05/apple-iphone-ipad-push-notification-ads)). The normal notification permission is not sufficient.

## Agents: Cluenori governs, Amp executes

Cluenori decides whether work is warranted, which evidence an agent gets, which resources it can access, how much it can spend, which actions it can take, and what counts as success. Amp Orbs do the work.

&#91;embedded content: from anomaly to fix · 7 steps, 2 decisions\]

Authority is a policy for each project and each class of action.

| Action class | Default authority |
| --- | --- |
| Investigate, read evidence, draft an issue or a PR | Automatic, within access and spend limits |
| Run a known mitigation, for example turn off a flag | Automatic when predefined conditions are true |
| Ship a fix | By the permitted change classes, checks and release policy of the project |
| Send a message | By the approved purpose, audience, template and volume |
| Change a price, set a hard minimum version, retire services | My explicit approval, unless a specific policy covers it |

Credentials, APIs and deployment controls enforce these limits. Instructions to the agent are not sufficient. Amp's default workflow can push to the shared branch after its checks, so each project states its release policy explicitly.

For an operation that got slower, the workflow is:

1. Confirm that the data is fresh and that the change is real.
2. Group related alerts into one incident.
3. Keep the baseline, the affected population, the release and the diagnostic evidence.
4. Start an Amp investigation with a scope, a budget and stop conditions.
5. Apply a permitted mitigation, or prepare a fix.
6. Release through the policy of the project.
7. Measure the recovery and check for new regressions.
8. Close the incident, continue the investigation, or escalate to me.

A finished agent run is not a verified improvement. Cluenori stores run completion and outcome verification as separate states.

**Connection to Amp Orbs.** A webhook wakes a paused Orb. Delivery is at least once and can arrive out of order, and Amp accepts a webhook before the work is done. Thus Cluenori owns durable run records, removes duplicate events by ID, and waits for an explicit completion receipt. The Orb reads Cluenori through MCP and the API with an OIDC token or a scoped key, because Orbs do not support OAuth for MCP yet. These details come from a [third-party summary](https://mer.vin/2026/08/agent-harnesses-vs-orbs-why-remote-sandboxes-beat-local-agent-loops/) of August 2026; check them in the Amp docs.

**Guardrails:**

- **Scope:** each run gets access to one project, read-only by default.
- **Budget:** a spend limit for each run, each project and each day.
- **Untrusted text:** logs, feedback, reviews and webhook text are evidence, never instructions. A run that reads this text gets only read and draft tools.
- **Audit:** each action stores its evidence, its run and its outcome. One switch stops all automation.

I measure automation by successful interventions, regressions introduced, cost and attention saved, not by the number of PRs.

## The factory contract

Agents already help me create each project, so project creation is where observability and operations start. Each new project inherits:

- registration in Cluenori, with project, component, environment and release identities,
- a first feature catalog and defined core value events,
- request, error and performance instrumentation,
- cost hooks for runtime AI and other variable costs,
- health checks for critical journeys and scheduled jobs,
- links to the repository and the deployed resources,
- safe defaults for flags and remote config,
- the client kit: update gate, kill switches, What's new, feedback form and consent,
- default messages: welcome, trial ending, What's new and failed payment,
- public pages: changelog, ideas board, status, privacy, terms and support,
- a sending domain, and a subdomain for marketing mail,
- a declared automation policy and release policy.

A blueprint holds this contract as code (Foundation). `npx cluenori project create notes --blueprint subscription-app` registers the project and applies the blueprint. Agents add the mechanics, but I define value. An SDK cannot know that "export completed" matters more than "export button clicked".

A contract check then verifies that the expected events and the release identity actually arrive. Without this check, hundreds of repositories can contain the SDK while the portfolio stays mostly invisible. A project without data for 7 days shows as "not reporting", never as "no users".

## Quality: worse than usual

One latency limit cannot fit an upload, a search and a background export, and a limit that someone sets once goes stale. So Cluenori sets no limits and asks for none. It compares each measure with its own usual and says when it got worse. An export that always takes 4 s is not news. A feed that went from 180 ms to 420 ms is.

| Measure | Worse than usual when |
| --- | --- |
| The latency of an operation, a screen or an app start | Its p95 over the last day is at least 1.5 times its p95 over the 7 days before, and at least 100 ms more |
| Crash-free sessions, critical journey success, error rate | To decide; the same idea, a drop against the 7 days before that is large enough to matter |

A measure with no usual yet, such as a new operation, is shown without a verdict. Each release is also compared with the previous one, with the sample size. A worse result with enough data opens an incident.

## What we will not build

Each exclusion keeps Cluenori small. The right column shows what founders use instead.

| Not in Cluenori | Instead |
| --- | --- |
| Query builder and dashboard builder | Edit the code of the view, or tell an agent to edit it |
| Video session replay | The list of events before each error |
| Live chat, and a helpdesk with response-time targets | Replies to feedback in the app inbox or by email. Conversations from another tool appear in the customer timeline. |
| Drag-and-drop journey canvas and visual email designer | Journeys as step lists or code. Emails from Markdown templates with the brand of each project. |
| Project management (sprints, boards) | The small issue tracker |
| Ad campaign management | Acquisition channels in Analytics; agents write launch posts as tasks |

## Roadmap

I prove Cluenori on three real projects first: an active mobile product, an active web or backend product, and a quiet project with continuing costs. Each phase starts only when the evidence gate before it is met.

&#91;embedded content: roadmap · 3 phases, 2 gates\]

Modules sets the phase of each module, and its table is the only list of phases. Version 1 builds the foundation and the modules marked v1, including costs, revenue and distribution, because they are central to the problem. Its SDK is complete from the first release, because shipped builds live for years. Engines can ship before their pages, and a Today item appears only when the module behind its action ships. Automatic mitigations come in version 3, as a part of Incidents.

## Still open

- [ ] Write the operating profile and the core value event for the first three projects.
- [ ] Name the first feature catalog and its tagging rules for the three projects.
- [ ] Decide the "worse than usual" rules for rates (crash-free sessions, journey success, error rate), and name the critical journeys of the first three projects.
- [ ] Define version 1 of the manifest schema, the version header, and the offline behavior of the update gate.
- [ ] Confirm that a Worker can send to APNs over HTTP/2 (reports say it works in production but not in local development on macOS), and measure the fan-out cost of a large push.
- [ ] Choose the email providers for transactional and marketing mail, and set up the sending domains.
- [ ] Check the limits of Cloudflare Email Sending, and whether its terms allow marketing mail.
- [ ] Check the Amp details in the Amp docs: webhooks, OIDC tokens, the thread usage window and the default push behavior.
- [ ] Decide the release policy and the permitted change classes for agent fixes.
- [ ] Cross-project identity: the verification method and the consent text for each purpose.
- [ ] Measure the cost of Cluenori itself. The $5 Workers Paid minimum is a starting point, not a promise.
- [ ] Do a trademark search for Cluenori (USPTO, EUIPO) and register the domains.
- [ ] Make sure that Pipelines and Data Catalog work with EU jurisdiction buckets.
- [ ] Later: the CLA tool, plans and official hosting.
