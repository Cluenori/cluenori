# @cluenori/incidents

A project's incidents: detectors that look every minute at its monitors and its counts, open an
incident for each problem, and resolve it once the problem is gone.

## Use it

```ts
const incidents = yield* Incidents

// Every minute, on the project's object's alarm: look, and say what changed.
const changes = yield* incidents.check
// [{ change: "opened", incident: { title: "POST /api/export: 18% failed, usually 0.1%", ... } }]

// A component's health endpoint, fetched every minute from the next check on.
yield* incidents.addMonitor(actor, { component: ComponentKey.make("notes-api"), url })
// The 21st fails with MonitorLimitReached; a component the project lacks, with ComponentNotFound.

const { open, resolved, checkedAt } = yield* incidents.incidents
yield* incidents.acknowledge(actor, open[0].id) // stops its notifications
```

An unknown incident fails with `IncidentNotFound`, an unknown monitor with `MonitorNotFound`.

## Owns

- **Rules:** the detectors, each against its own usual, with nothing to set:
  - **Down:** a monitor's URL failed two checks in a row; a check passes with a status below 400
    within 10 seconds.
  - **Failing:** over the last 15 minutes, an operation failed at least 5 times, at least 2% of the
    time, and at least three times its usual rate, the 7 days up to an hour before.
  - **Stopped:** an operation that runs on a schedule missed twice its usual gap, and 5 minutes for
    its telemetry. A schedule is learned from the minutes it ran in over 2 days, or over 6 hours
    for one that runs every 5 to 15 minutes: at least 6 runs, at least 5 minutes apart, 80% of its
    gaps within a quarter of their median.
  - An incident's life: one open for each detector and subject; resolved after 10 minutes without
    the problem; reopened by a problem back within 30 minutes of that; worse at a failure rate twice
    what was last told. Its title, which names no time, since times depend on who reads them.
- **Data:** incidents (`incidents_incidents`), when each open one's detector last saw its problem
  (`incidents_firing`), monitors (`incidents_monitors`) and their last checks
  (`incidents_monitor_checks`), what the detectors learned hourly (`incidents_baselines`), and when
  they last learned and looked (`incidents_state`).

## Does not own

- **The counts the detectors read:** `@cluenori/signals`.
- **Telling anyone:** `check` returns its changes, and their activity is kept; who is told, and
  how, belongs to the notifications that will react to that activity.

## Contract

`src/index.ts`. The host runs `check` every minute and serves the questions and actions;
`IncidentsGroup` is the API's part.

## Depends on

- `@cluenori/signals`, for the counts: the last 15 minutes, 7 days, and the minutes each sparse
  operation ran in.
- `@cluenori/projects`, for the components a monitor belongs to.
- Foundation's `ActivityLog`, and the `HttpClient` the host provides, to fetch monitors.

## Activity

`incident.opened`, `incident.reopened`, `incident.worsened` and `incident.resolved` by the system
process `incidents.check`, all of one check in one commit, each with its environment and whether
its project calls that production (Projects' settings; unknown counts as production); `incident.acknowledged`, `monitor.added`
and `monitor.removed` by whoever acts. Removing a monitor resolves its open incident, with
`incident.resolved` in the same commit. `incident.worsened` and `incident.resolved` say
`acknowledged: true` for an incident someone is on, and `incident.acknowledged` carries its title,
so whoever tells people needs nothing more.

## Background work

`check`, which the project's object runs on its alarm every minute, from its first call after the
project exists. It fetches at most 20 monitors, ten at a time, without trace headers, so a health
check starts no trace in the service it checks.

## Decisions and constraints

- **What changes every minute isn't a record.** Monitors' last checks, when a detector last saw a
  problem, and what was learned are kept apart from incidents and monitors, without activity; an
  incident changes only when it opens, reopens, worsens, resolves, or is acknowledged.
- **Learned hourly, looked every minute.** Usual rates and schedules come from a week, two days and
  6 hours of counts once an hour, so each minute reads only the last 15 minutes, and an overdue
  operation's minutes since its last run.
- **An open stopped incident stays open until its operation runs,** even when two days pass and its
  schedule is no longer learned.
- **A check costs one object wake-up a minute per project,** a small share of what the paid plan
  includes.
