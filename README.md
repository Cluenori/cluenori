# Cluenori

The control room for a software factory: one founder, many projects, running in your own Cloudflare
account. The product is described in `concept/`; it is at its first step, so today Cluenori watches
your services: they send OpenTelemetry traces, and Cluenori shows each operation's load, errors,
and p50 to p99 durations.

## Run it

You need [Nix](https://nixos.org/download/). Everything else (Bun, Node, Wrangler) comes pinned
with the repository.

```sh
./run
```

Cluenori starts on http://localhost:8787, with local storage in `apps/worker/.wrangler/state`.
`/api/health` answers 204, and `/api/openapi.json` describes the API. The first run makes an API
token in `apps/worker/.dev.vars`, which `./cluenori` uses.

## Deploy it to your Cloudflare account

You need a Cloudflare account on Workers Paid.

```sh
./setup
```

Wrangler signs you in through the browser, then deploys Cluenori to
`https://cluenori.<your subdomain>.workers.dev`. The first time, setup gives it an API token and
saves it for this computer, so `./cluenori` asks the deployment from then on. To install a new
version later:

```sh
./update
```

## See your services' operations

```sh
./cluenori project create notes --name Notes
./cluenori component add notes notes-api --name "Notes API"   # prints its ingest key, once
```

Point the service's OpenTelemetry exporter at Cluenori, over HTTP with protobuf: endpoint
`<your Cluenori>/otlp/v1/traces`, header `Authorization: Bearer <ingest key>`. In .NET, that is
`AddOtlpExporter` with `OtlpExportProtocol.HttpProtobuf`, next to any exporter you already have. Then:

```sh
./cluenori operations notes --last 24h  # count, errors, avg, p50, p80, p95, p99 by operation
./cluenori load notes --last 24h        # the load over time
```

An operation is what a service does, by name: an HTTP route it answers (`GET /api/notes/{id}`), a
message it processes, or a job it starts. Cluenori counts each time one runs.

Send its logs too, to `<your Cluenori>/otlp/v1/logs` with the same header, and investigate:

```sh
./cluenori errors notes                 # errors grouped by type and stack, most frequent first
./cluenori error notes <ID>             # its stack, where it happens, and its latest occurrences
./cluenori trace notes <trace ID>       # that trace's spans and every log line, from the archive
./cluenori logs notes --search timeout  # warnings and errors, searchable
```

Every export is kept 90 days, with emails, tokens and card numbers removed. Add `--local` to ask
the Cluenori `./run` serves instead of the deployment.

## Work on it

`./dev` opens a shell with the pinned toolchain. Start with `AGENTS.md` (how we build), then
`ARCHITECTURE.md` (the parts), `PATTERNS.md` (how each recurring problem is solved), and
`GLOSSARY.md` (the words).

```sh
bun run check   # types and Effect diagnostics, lint, format, dependency rules
bun run test    # every test, journeys included
```
