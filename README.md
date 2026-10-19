# Cluenori

The control room for a software factory: one founder, many projects, running in your own Cloudflare
account. The product is described in `concept/`; it is at its first step, so today Cluenori serves
its API's health check and OpenAPI document, and nothing more yet.

## Run it

You need [Nix](https://nixos.org/download/). Everything else (Bun, Node, Wrangler) comes pinned
with the repository.

```sh
./run
```

Cluenori starts on http://localhost:8787, with local storage in `apps/worker/.wrangler/state`.
`/api/health` answers 204, and `/api/openapi.json` describes the API.

## Deploy it to your Cloudflare account

You need a Cloudflare account on Workers Paid.

```sh
./setup
```

Wrangler signs you in through the browser, then deploys Cluenori to
`https://cluenori.<your subdomain>.workers.dev`. To install a new version later:

```sh
./update
```

## Work on it

`./dev` opens a shell with the pinned toolchain. Start with `AGENTS.md` (how we build), then
`ARCHITECTURE.md` (the parts), `PATTERNS.md` (how each recurring problem is solved), and
`GLOSSARY.md` (the words).

```sh
bun run check   # types and Effect diagnostics, lint, format, dependency rules
bun run test    # every test, journeys included
```
