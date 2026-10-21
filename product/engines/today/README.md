# @cluenori/today

Today: what needs attention now. Its detectors read each project's incidents and counts where they
are kept, in the project's Durable Object; the host asks every project and puts what they say in
one order, the most urgent first.

## Use it

```ts
// In a project's object: its items, in no order.
const items = yield* (yield* Today).items
// [{ _tag: "incident", project: "notes", incident }, { _tag: "slower", operation: "GET /api/feed", p95Ms: 590, usualP95Ms: 287, ... }]

// In the host, across projects: one order for all of them.
const today = sortToday([...notesItems, ...atlasItems])
```

A project the object doesn't have fails with `ProjectNotFound`; the host lists a project that
didn't answer in `unanswered`, never as one with nothing to do.

## Owns

- **Rules:** the detectors (`itemsOf`), each item with its evidence:
  - **An open incident,** acknowledged or not.
  - **An error new or happening now:** first seen in the last day, or seen in the last 15 minutes
    (Signals' `errorStatusOf`).
  - **A slower operation:** its p95 over the last day at least 1.5 times its p95 over the 7 days
    before, and 100 ms more (Signals' `slowerOf`).
  - **A silent project:** it has components, and sent no operation in the last day; with when it
    last did in the 8 days before.
- **Today's order** (`sortToday`): incidents not acknowledged, errors happening now, acknowledged
  incidents, new errors, slower operations, silent projects; the latest or the most slowed first
  within each.

## Does not own

- **What "slower", "new" and "ongoing" mean:** Signals' rules, which the web uses too.
- **Incidents and how they open:** `@cluenori/incidents`.
- **Telling anyone:** the notifications that will react to incidents' activity.

## Contract

`src/index.ts`. The host serves `TodayGroup` by asking each project's object for `Today.items` and
ordering the answers with `sortToday`. Items carry evidence as data, never sentences, so each
client says them in its own words and language.

## Depends on

`@cluenori/incidents` (open incidents), `@cluenori/signals` (the last day's errors, and the
operations of the last day and the 7 days before), and `@cluenori/projects` (the project and its
components).

## Decisions and constraints

- **Today asks every project, at most 8 at once:** one request to each project's object, which
  reads four answers from its own database. Money at risk and affected users, which the concept
  orders by, come with the modules that know them.
- **Only engine detectors so far.** The concept's Today has an item for each module's insight;
  each comes with its module, which adds its detector here.
- **A silent project counts operations only:** one that sends only logs or metrics looks silent.
  Not handled: telling those apart needs the last time each signal arrived, which Signals doesn't
  keep yet.
