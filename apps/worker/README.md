# @cluenori/worker

The one deployable Cloudflare Worker. It serves the public API and OTLP ingest, holds each
project's Durable Object, and composes every engine and module; it holds no rules of its own.

## Use it

Run it with `./run`, deploy it with `./setup`. Call it from TypeScript through its definition:

```ts
import { CluenoriApi } from "@cluenori/worker"
import { HttpApiClient } from "effect/http-api"

const client = yield* HttpApiClient.make(CluenoriApi, { baseUrl: "https://cluenori.example.workers.dev" })
yield* client.health()
const table = yield* client.signals.operations({ params: { project }, query: { from, to } })
```

Every group but the system's, sign-in's, passkeys', pairing's and a phone's push token's needs a
member's credential. The deployment's API token, the owner's, is one, which a client sends through
`HttpApiMiddleware.layerClient(MemberAuthorization, ...)`; a missing or wrong one answers 401. A
browser signs in with a passkey (`POST /api/sign-in/passkey`, or joining by an invitation), and
gets the sign-in cookie, or signs in with the token: `POST /api/sign-in` with the token sets an HttpOnly, Secure,
SameSite=Strict cookie for `/api`, kept 30 days, which the API accepts in its place;
`POST /api/sign-out` removes it. A paired phone sends its own key as the bearer token,
`cluenori.phone.<phone ID>.<secret>`, and acts for whoever paired it; a removed phone's key answers
401, saying to pair it again. It registers its push token with `PUT /api/phones/push`, which takes
its key only.
Services send traces, logs and metrics to `POST /otlp/v1/traces`, `/v1/logs` and `/v1/metrics` with
a component's ingest key: `Authorization: Bearer cluenori.<project>.<component>.<secret>`. An
export the archive can't take is answered 503, so the exporter sends it again.

## Owns

- **The entry the platform runs,** `src/worker.ts`: every route group and layer on a visible line,
  built once per isolate (PATTERNS.md, "The Worker entry").
- **The public API definition,** `src/cluenori-api.ts`: the engines' groups, behind
  `MemberAuthorization`, the endpoints about the deployment itself (`GET /api/health`), and signing
  a browser in and out.
- **The API token's rule,** `src/api-token.ts`: whose a presented token is, for a bearer token and
  for signing in alike; `src/member-authorization-layer.ts` lets a call through with it, with a
  phone's key, or with a browser's passkey sign-in, which the workspace's object checks, and gives
  handlers who calls and what they see (`CurrentMember`).
- **The iPhone app's association,** `src/apple-app-site.ts`: `/.well-known/apple-app-site-association`
  names the app (its team and bundle ID, from push setup) whose passkeys this site's are, so a phone
  can pair with a passkey (`POST /api/phones/passkey`, in `src/cluenori-api.ts`).
- **Access,** `src/member-projects.ts`: the public API's only way to a project's object, keeping to
  the projects the member sees; a lint rule (`.oxlintrc.json`) keeps handlers from reaching around
  it. Listing projects, Today and phones filter the same way. Where a call came from, for a phone's
  last seen, is Cloudflare's headers (`src/caller.ts`). How
  clients import the definitions is an open decision in ARCHITECTURE.md: "How clients import the
  API definition".
- **OTLP ingest,** `src/otlp-ingest.ts`: checks each export's form and key, reads it where it arrives,
  and has the project's object archive and record it.
- **The archive in R2,** `src/r2-archive.ts`: an `ArchiveStore` on the `ARCHIVE` bucket, its files
  compressed with gzip.
- **Each project's Durable Object,** `src/project-object.ts`, named `<workspace>/<project>`: the
  engines' layers built once per object, and one served call per operation (`src/project-calls.ts`).
  An object builds no database before its project is created.
- **The workspace's Durable Object,** `src/workspace-object.ts`, named `<workspace>`: the index of
  its projects, its phones, and their alerts (`src/workspace-calls.ts`). Both kinds of object are called the same way
  (`src/object-calls.ts`).
- **The activity queue,** `src/activity-queue.ts`: its messages, one activity entry each as JSON
  text. Each project's object sends its new activity on its alarm, every minute; the consumer in
  `src/worker.ts` hands each batch to the workspace's notifications, and has the queue try it all
  again, 30 seconds on, up to 10 times, when APNs may take it later.
- **Serving the dashboard,** from `wrangler.jsonc`'s `assets`: its built files, and any other path,
  so a page's address opens it; `/api/*`, `/otlp/*`, `/ingest/*` and `/.well-known/*` always reach
  the Worker.
- **`wrangler.jsonc`:** the Worker's name, compatibility date, the dashboard's files, and bindings:
  `PROJECT`, the projects' Durable Objects, `WORKSPACE`, the workspace's, `ARCHIVE`, the
  archive's bucket, and `ACTIVITY`, the activity queue, of which the Worker is also the consumer.
  Its `eu` environment is the same Worker with them in the EU, which `./setup` deploys when the data
  stays there.
- **`openapi.json`:** generated from the definition by `bun run generate`; `bun run check` fails when
  it is stale.

## Does not own

- **Product rules:** those live in engines and modules. Handlers translate a request to a service
  call and its result back.
- **Running and deploying:** `apps/cli` drives Wrangler.

## Contract

`src/index.ts` exports `CluenoriApi`, the definition of the public API. Clients and journeys import
it; nothing imports the entry.

## Settings

Read from `env` with `ConfigProvider.fromUnknown(env)` in `src/worker.ts`:

- `CLUENORI_API_TOKEN`, a secret: the token the public API requires. `./setup` makes it; `./run`
  makes one in `.dev.vars`. Without it the API refuses every call but the health check.
- `CLUENORI_OWNER`: the owner the token stands for, listed as a member when the workspace's object
  starts.
- `CLUENORI_JURISDICTION`: `eu` in the `eu` environment, so projects' Durable Objects are made in
  the EU. Absent otherwise.
- `CLUENORI_APNS_KEY` (a secret, the `.p8` key's text or its base64 alone), `CLUENORI_APNS_KEY_ID`,
  `CLUENORI_APNS_TEAM_ID`, and `CLUENORI_APNS_TOPIC`, the app's bundle ID: what alerts are pushed
  with, read in the workspace's object. `./cluenori push setup` sets them; without them nothing is
  pushed, and a test alarm answers 409. The Worker `./run` serves can't push even with them:
  workerd's `fetch` on this computer speaks HTTP/1.1, and APNs only HTTP/2, which a deployed
  Worker's `fetch` speaks.

A self-hosted deployment has one workspace, `main`.

## Decisions and constraints

- **Creating a project spans two objects,** the project's and the workspace's, with no transaction
  between them. The project's object creates it, then the index records it; a project that exists
  already is recorded too, before the create fails with `ProjectExists`. So trying again repairs a
  create that stopped between the two, and lists projects made before the index existed.
- **One credential, two ways in.** The sign-in cookie holds the API token itself, where the page's
  scripts can't read it. A new token signs every browser out; members with sessions of their own
  come with members as records.

- **Built at module scope, without I/O.** `HttpRouter.toWebHandler` builds the layers once, when the
  isolate loads the module. Workers allow no I/O outside a request, so building a layer must not
  perform any.
- **The sync scheduler.** Workers can discard timers that a request owns, which would leave work
  shared between requests suspended. Effect's guidance for Workers is `MixedScheduler("sync")`. Its
  cost: a fiber runs until it waits for I/O, so CPU-heavy work delays the isolate's other requests.
- **Generated types.** `worker-configuration.d.ts` (the Workers runtime and `Env`) is generated by
  `wrangler types` on install and on every type check, and isn't committed.
- **Size.** The bundle is about 280 KiB gzipped (`wrangler deploy --dry-run`, October 2026), far
  below the Workers limits.
