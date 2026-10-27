# Cluenori measures itself

A deployment can report itself in a project of its own, as any product would: its Worker sends
OTLP, its dashboard, CLI and iPhone app use Cluenori's SDKs. It is off until an owner turns it on.

## Turning it on and off

```sh
./cluenori self-telemetry on --project cluenori
./cluenori self-telemetry off
```

`on` makes the project (when it doesn't exist) with the components `worker`, `dashboard` and
`cli`; links the dashboard and the CLI to ship with the worker; and sets three Worker secrets:
`CLUENORI_SELF_INGEST_KEY` (the worker's ingest key) and `CLUENORI_DASHBOARD_SDK_KEY` and
`CLUENORI_CLI_SDK_KEY`. When `worker` exists but this computer doesn't have its key, `on` adds a
key named `self-telemetry`, so the old one works on until an owner revokes it. No key is ever in a
committed file. `./update` deploys with
`CLUENORI_RELEASE`, so each deploy is a release. `off` removes the secrets; people self-hosting
have the same switch.

The iPhone app is a component of its own (`cluenori-ios`). Its SDK key, issued with
`./cluenori component sdk-keys`, goes in `apps/ios/Config/Local.xcconfig` as `CLUENORI_SDK_KEY`;
without one, and in demo builds, the app measures nothing.

## What each part sends

- **Worker** (`worker`): the API's requests, the dashboard's pages served, detectors, pushes,
  releases' work, background work and queue batches, with their warnings and errors
  (`SelfTelemetry`, `@cluenori/signals`). Receiving telemetry (OTLP and apps' batches) is never
  traced, whoever sent it: its only telemetry is a count per route and status, at most once a
  minute. So N signals in make a bounded number out, which
  `product/engines/signals/test/self-telemetry.test.ts` proves.
- **Dashboard** (`dashboard`): its session, each page as a screen (by its kind, `operation`, never
  the operation), when the page showed data kept from before and when it showed fresh data, errors,
  and features. It learns its SDK key from `GET /api/client-telemetry`, which says nothing when the
  deployment doesn't measure itself; the SDK then never loads.
- **CLI** (`cli`): each command as a screen and its feature, by the command's name alone, never an
  argument; how long it took; and a failure by its kind alone. It sends only to the deployment it
  is set up for (`~/.config/cluenori/deployment.json`), says so the first time it sends and in
  `--help`, and is off with `CLUENORI_TELEMETRY=off` or `DO_NOT_TRACK=1`. `run` and `setup` are
  never measured.
- **iPhone app** (`cluenori-ios`, Swift SDK): launch to the first ready screen, each screen's
  readiness from the device's copy and from the network, hitches and hangs per screen, crashes by
  release, CPU and memory, sessions, and features.

Every client names the person signed in by their member ID, so one person counts once across
clients, and adds its component to the baggage of its requests to the deployment
(`cluenori.origin.component`), so the Worker's operations split by the client that asked.

## Features

One feature has one name in every client, so a feature's page tells its whole story and narrows to
one component.

| Feature | Dashboard pages | iPhone screens | CLI commands |
|---|---|---|---|
| `today` | now | now | `today` |
| `projects.overview` | project | project | |
| `tech` | tech | tech | |
| `tech.performance` | performance, operation | operations, operation | `operations`, `operation`, `load` |
| `tech.errors` | errors, error, occurrence | errors, error | `errors`, `error` |
| `tech.logs` | logs, log message, log line | logs, log message, log line | `logs`, `log-messages` |
| `tech.traces` | trace | trace | `trace` |
| `incidents` | incidents, incident | incidents, incident | `incidents`, `incident` |
| `incidents.acknowledge` | | | `acknowledge` |
| `uptime` | uptime, monitor | uptime, monitor | `monitors`, `monitor` |
| `releases` | releases, release | releases, release | `releases`, `release` |
| `releases.delivery` | | delivery, component | `delivery` |
| `releases.promote` | | | `promote`, `release-approved` |
| `releases.versions` | | | `version` |
| `releases.notes` | | notes, notes style | `notes`, `notes-style` |
| `analytics` | analytics | analytics | |
| `analytics.releases` | app releases, app release | app health | |
| `analytics.features` | features, feature | features, feature | `feature` |
| `analytics.people` | person | person | `person` |
| `analytics.version-policy` | | version policy | `version-policy` |
| `analytics.sdk-keys` | | SDK keys | `component sdk-keys` |
| `feeds` | feeds, feed | feeds, feed | `feeds`, `feed` |
| `settings.projects` | | | `project`, `component` |
| `settings.ingest-keys` | | ingest keys | `component ingest-keys` |
| `settings.members` | members, invite | | `members`, `member` |
| `settings.phones` | phones | pair | `phones`, `phone` |
| `settings.browsers` | browsers | | |
| `settings.github` | github | | |
| `sign-in` | sign in | | |

A new page, screen or command takes its feature from this table, or adds a row to it.

## What it can't see

A deployment that is down can't report that it is down. That needs a check from outside it.
`/api/health` is what such a check calls: unauthenticated, it answers 204 when the workspace's
Durable Object answers a read, and so does the deployment's own project's while it measures itself,
and 503 when either doesn't within 5 seconds; it says nothing else. The watcher itself isn't built
yet.
