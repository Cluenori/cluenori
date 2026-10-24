# @cluenori/today

Today: what needs attention now, and how each project is going. Its detectors read each project's
incidents and counts where they are kept, in the project's Durable Object, and its pulse the
project's load and people there; the host asks every project, adds the modules' items, and puts
what they say in one order, the most urgent first.

## Use it

```ts
// In a project's object: its items, in no order, and its pulse.
const today = yield* Today
const items = yield* today.items
// [{ _tag: "incident", project: "notes", incident }, { _tag: "slower", operation: "GET /api/feed", p95Ms: 590, usualP95Ms: 287, ... }]
const pulse = yield* today.pulse
// { project: "notes", load: [{ start: "2026-10-22T11:00:00Z", count: 1204, errors: 3 }, ...],
//   people: { latest: { day: "2026-10-22", people: 310, monthPeople: 2104, ... }, weekBefore: { day: "2026-10-15", people: 284, ... } } }

// A module's detector, beside them: Releases' promotions that need a member.
const promotions = yield* promotionItems
// [{ _tag: "promotion", component: "notes-ios", release: "2.5.0+31", state: "approved", ... }]

// In the host, across projects: one order for all of them.
const sorted = sortToday([...notesItems, ...atlasItems])
```

A project the object doesn't have fails with `ProjectNotFound`; the host lists a project that
didn't answer in `unanswered`, never as one with nothing to do, and has no pulse for it.

## Owns

- **Rules:** the detectors (`itemsOf`), each item with its evidence, in the environments the
  project calls production (Projects' settings):
  - **An open incident,** acknowledged or not.
  - **An error new or happening now:** first seen in the last day, or seen in the last 15 minutes
    (Signals' `errorStatusOf`).
  - **A slower operation:** its p95 over the last day at least 1.5 times its p95 over the 7 days
    before, and 100 ms more (Signals' `slowerOf`).
  - **A silent project:** it has components, and sent no operation in the last day; with when it
    last did in the 8 days before.
- **The promotion item's shape** (`PromotionItem`); the Releases module's detector decides which
  promotions need a member.
- **Today's order** (`sortToday`): incidents not acknowledged, errors happening now, acknowledged
  incidents, new errors, slower operations, promotions that need a member, silent projects; the
  latest or the most slowed first within each, a promotion by when it ended, else when it started.
- **The pulse** (`pulseOf`), in the environments the project calls production:
  - **Load:** Signals' load by the hour over the current hour so far and the 23 before it, of each
    production environment the telemetry of those hours named, or of all of it when it named none
    (telemetry without an environment is production by rule); summed by the hour, counts and
    errors only. An hour not listed had nothing reported.
  - **People:** Signals' apps' usage on the latest whole UTC day and the same day a week before, in
    each production environment; the days counted summed, a week's or month's people only when
    every summed day has them. Absent when no environment counts the latest day; the week before
    absent when none counts it.
  - **Cost:** the pulse about doubles the work each project's object does for Today; not yet
    measured with hundreds of projects.

## Does not own

- **What "slower", "new" and "ongoing" mean:** Signals' rules, which the web uses too.
- **Incidents and how they open:** `@cluenori/incidents`.
- **Which promotions need a member:** `@cluenori/releases`' `promotionItems`, which the host
  composes beside `Today.items`.
- **Load and people:** Signals' counts; the pulse only sums them.
- **Telling anyone:** the notifications that will react to incidents' activity.

## Contract

`src/index.ts`. The host serves `TodayGroup` by asking each project's object for `ProjectToday`
(`Today.items` and the modules' items, and `Today.pulse`), ordering the items with `sortToday` and
listing the pulses in the projects' order. Items and pulses carry evidence as data, never
sentences, so each client says them in its own words and language.

## Depends on

`@cluenori/incidents` (open incidents), `@cluenori/signals` (the last day's errors, the operations
of the last day and the 7 days before, the load of the last 24 hours, and apps' usage by day), and
`@cluenori/projects` (the project, its components and its production environments).

## Decisions and constraints

- **Today asks every project, at most 8 at once:** one request to each project's object, which
  answers its items and its pulse from its own database. Money at risk and affected users, which
  the concept orders by, come with the modules that know them.
- **The pulse comes with Today,** so the phone's Now is one request and one fan-out, not one
  request per project per question. It reads, per project: the environments of the last 24
  hours' hour counts, one load series per production environment named, and two one-day usage
  questions per production environment (at most 20).
- **Hours start on the hour:** the current hour so far and the 23 before it, so at most 24 points,
  each a whole hour but the last.
- **Modules' detectors are composed by the host** beside the engines' items, one line each, until
  the module contract has its `today` part. The first is Releases' promotions that need a member.
- **A silent project counts operations only:** one that sends only logs or metrics looks silent.
  Not handled: telling those apart needs the last time each signal arrived, which Signals doesn't
  keep yet.
- **Not handled:**
  - telemetry with and without an environment in the same hours: the part without one is left out
    of the load; counting it takes load that filters by "no environment";
  - a person active in two production environments on a day counts in each; counting them once
    takes usage across several environments.
