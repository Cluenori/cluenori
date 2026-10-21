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

Every group but the system's and sign-in's needs the deployment's API token, which a client sends
through `HttpApiMiddleware.layerClient(MemberAuthorization, ...)`; a missing or wrong token answers
401. A browser signs in instead: `POST /api/sign-in` with the token sets an HttpOnly, Secure,
SameSite=Strict cookie for `/api`, kept 30 days, which the API accepts in its place;
`POST /api/sign-out` removes it.
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
  for signing in alike; `src/member-authorization-layer.ts` lets a call through with either. How
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
  its projects (`src/workspace-calls.ts`). Both kinds of object are called the same way
  (`src/object-calls.ts`).
- **Serving the dashboard,** from `wrangler.jsonc`'s `assets`: its built files, and any other path,
  so a page's address opens it; `/api/*` and `/otlp/*` always reach the Worker.
- **`wrangler.jsonc`:** the Worker's name, compatibility date, the dashboard's files, and bindings:
  `PROJECT`, the projects' Durable Objects, `WORKSPACE`, the workspace's, and `ARCHIVE`, the
  archive's bucket. Its `eu` environment is the same
  Worker with both in the EU, which `./setup` deploys when the data stays there.
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
- `CLUENORI_OWNER`: the member the token stands for, until members are records.
- `CLUENORI_JURISDICTION`: `eu` in the `eu` environment, so projects' Durable Objects are made in
  the EU. Absent otherwise.

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
