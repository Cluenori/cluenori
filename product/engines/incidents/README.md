# @cluenori/incidents

A project's incidents: detectors and the monitors someone set up, looked at every minute against its
counts and URLs, open an incident for each problem and resolve it once the problem is gone; and
quiet hints, guesses that never open one.

## Use it

```ts
const incidents = yield* Incidents

// Every minute, on the project's object's alarm: look, and say what changed.
const changes = yield* incidents.check
// [{ change: "opened", incident: { title: "POST /api/export: 18% failed, usually 0.1%", ... } }]

// A component's health endpoint, fetched every minute from the next check on: an alarm when it is down.
yield* incidents.addMonitor(actor, {
  component: ComponentKey.make("notes-api"),
  condition: { _tag: "noAnswer", subject: { _tag: "url", url } },
  level: "alarm",
})
// A job: "notes-api · cleanup.run hasn't run for 30 minutes", time-sensitive.
yield* incidents.addMonitor(actor, {
  component: ComponentKey.make("notes-api"),
  condition: { _tag: "nothingFor", subject: { _tag: "operation", operation: "cleanup.run" }, minutes: 30 },
  level: "timeSensitive",
})
// The 31st fails with MonitorLimitReached; the same one twice with MonitorExists; a component the
// project lacks with ComponentNotFound.

// quiet: operations that usually run about every N minutes, a guess, and haven't for a while.
const { open, resolved, checkedAt, quiet } = yield* incidents.incidents
yield* incidents.acknowledge(actor, open[0].id) // stops its notifications

// One incident, whatever any period: its life, and the release that ran when it opened.
const { updates, releases } = yield* incidents.incident(open[0].id)
// updates: [{ change: "opened", at, title: "POST /api/export: 18% failed, usually 0.1%" },
//           { change: "acknowledged", at }, ...]; releases: [{ environment: "prod", release: "2.4.0+312" }]

// One monitor: how it is now and since when, its days, its last 24 hours, its failed checks, its incidents.
const { state, recent, failures } = yield* incidents.monitor(monitorId)
// state: { lastCheck: { at, status: 200, ms: 84 }, since, days: [{ day: "2026-10-21", checks: 1440, failed: 2, averageMs: 91 }] }
```

An unknown incident fails with `IncidentNotFound`, an unknown monitor with `MonitorNotFound`.

## Owns

- **Rules:** the detectors, each against its own usual, with nothing to set:
  - **Down:** a monitor's URL failed two checks in a row; a check passes with a status below 400
    within 10 seconds.
  - **Failing:** over the last 15 minutes, an operation failed at least 5 times, at least 2% of the
    time, and at least three times its usual rate, the 7 days up to an hour before.
  - **Stopped:** none open now. No operation is taken for a job from how it ran (see "Decisions
    and constraints"); stopped incidents opened before stay readable.
  - **Monitor:** a monitor someone set up whose condition holds: no answer (Down, above), nothing
    for N minutes (not judged until N minutes after it was added), more than N in M minutes, p95
    above X ms or more than X% failed over M minutes (each judged on at least 5 runs). Its incident
    is keyed by the monitor, carries its level, and its title names the subject and the numbers:
    "cleanup.run hasn't run for 30 minutes", "GET /api/card p95 820 ms, above 500 ms". Thresholds
    and windows are bounded by the schema (1 minute to 7 days for nothing-for, 1 day for a window,
    10 minutes for a p95, a count up to a million); at most 30 monitors a project.
  - **Quiet hints:** how often each sparse operation usually runs, guessed hourly from its last
    days, and those that haven't run for well over that. Kept as hints only: no incident, no
    activity, no push.
  - An incident's life: one open for each detector and subject; resolved after 10 minutes without
    the problem; reopened by a problem back within 30 minutes of that; worse at a failure rate twice
    what was last told. Its title, which names no time, since times depend on who reads them.
  - **An incident's life:** each change kept as an update, with the title it said when it opened,
    reopened or got worse. **The release that ran:** the latest release of its component that ran
    in the hour before it opened, in its environment, or, for a monitor's, in each.
  - **A monitor's history:** every check 7 days (its status and how long the answer took, to its
    status and headers), each UTC day's checks, failures and average time 90 days, and since when
    it has passed or failed as it does now. A check failed counts against its day, even when it
    didn't open an incident.
- **Data:** incidents (`incidents_incidents`), when each open one's detector last saw its problem
  (`incidents_firing`), each incident's life (`incidents_updates`), monitors (`incidents_monitors`,
  their condition as JSON), what each monitor of counts measured last (`incidents_monitor_measures`,
  one row each), URL monitors' last checks (`incidents_monitor_checks`), the guessed rhythms of
  quiet hints (`incidents_rhythms`), every check (`incidents_check_history`) and each
  day's (`incidents_check_days`), what the detectors learned hourly (`incidents_baselines`), and
  when they last learned and looked (`incidents_state`).

## Does not own

- **The counts the detectors read:** `@cluenori/signals`.
- **Telling anyone:** `check` returns its changes, and their activity is kept; who is told, and
  how, belongs to the notifications that will react to that activity.

## Contract

`src/index.ts`. The host runs `check` every minute and serves the questions and actions;
`IncidentsGroup` is the API's part.

## Depends on

- `@cluenori/signals`, for the counts: the last 15 minutes, 7 days, the minutes each sparse
  operation ran in, and for monitors an operation's runs, an error's or log message's count, and
  how many of an event arrived (`AppSignals.eventCount`).
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
project exists. It fetches every URL monitor, ten at a time, without trace headers, so a health
check starts no trace in the service it checks; then reads each monitor of counts.

## Decisions and constraints

- **What changes every minute isn't a record.** Monitors' last checks, when a detector last saw a
  problem, and what was learned are kept apart from incidents and monitors, without activity; an
  incident changes only when it opens, reopens, worsens, resolves, or is acknowledged.
- **Every alert is real: nothing is guessed.** An incident opens only for a problem that is there:
  a URL an owner asked to watch that doesn't answer, or failures that happened. Schedules were
  learned from how operations ran until 2026-10-26, when an endpoint an app called about every 31
  minutes was taken for a job and alerted as stopped; a job that stopped is told only once jobs are
  declared, never guessed.
- **A monitor's history is counts, not records.** Its checks and days are kept like its last check,
  without activity; old ones are removed hourly. Every check of 30 URL monitors for 7 days is at most
  302,400 rows; a monitor's page reads at most its last day of them.
- **The release that ran comes from Signals, not Releases,** which depends on this engine: the
  spans of the releases whose operations ran, as Releases' "incidents while it ran" reads them.
- **Learned hourly, looked every minute.** Usual error rates come from a week of counts once an
  hour, so each minute reads only the last 15 minutes.
- **A check costs one object wake-up a minute per project,** a small share of what the paid plan
  includes. A monitor of counts adds one indexed read of counts Signals already keeps (an event's
  through a partial index on its timeline), so at most 30 reads a minute, and overwrites its one
  `incidents_monitor_measures` row: no new per-minute storage.
- **A monitor is set up, never guessed; a guess is a hint.** Notifications send nothing for a
  `stopped` incident, all of which were guesses; a monitor's incident (detector `monitor`) carries
  the level its owner chose. A quiet hint offers "Monitor this", which declares it.
- **Any member who sees the project may add or remove its monitors,** as they may acknowledge its
  incidents (the API's `MemberProjects`); not owner-only.
- **Existing URL monitors became `noAnswer` monitors at `alarm`** (migration `0005_monitors`), so
  they ring as before.
