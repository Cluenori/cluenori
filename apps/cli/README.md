# @cluenori/cli

`cluenori`: runs Cluenori on this computer, deploys and updates it, and checks this repository.

## Use it

```
./run              cluenori run       wrangler dev, with local storage in apps/worker/.wrangler/state
./setup            cluenori setup     wrangler deploy, signing in to Cloudflare first if needed
./update           cluenori update    git pull --ff-only, bun install, wrangler deploy
bun run check      … cluenori check   dependency rules, suppression comments, generated files
bun run generate   cluenori generate  rewrites apps/worker/openapi.json
```

A check that fails prints each problem with its fix, and exits with code 1:

```
packages/money: May not depend on @cluenori/worker (apps/worker). packages/* may use packages/*.
apps/worker/openapi.json: is out of date with the API definition. Run `bun run generate`.

2 problems.
```

## Owns

- **The steps** of run, setup, and update.
- **Cluenori's dependency rules,** `src/dependency-rules.ts`: the table in ARCHITECTURE.md as data.
- **The repository checks** that the compiler and the linter can't make.

## Does not own

- **How dependency rules are checked:** `@bagatka/workspace-rules`.
- **Signing in, prompts, and deploying:** Wrangler. The CLI runs it attached to the terminal.

## Depends on

- `@bagatka/workspace-rules`, to check the dependency rules.
- `@cluenori/worker`, for the API definition the OpenAPI document is generated from.
- `effect/cli` for commands, and `@effect/platform-bun` for the file system and child processes.

## Decisions and constraints

- **Runs from the repository's root,** as the entry scripts and the root `package.json` scripts do.
- **Runs in Bun and is never deployed.** Programs it starts run attached to this terminal, in its
  process group, so Wrangler can prompt and Ctrl+C reaches it.
- **Failures.** An expected failure prints what went wrong and exits with code 1; a defect prints
  its full cause.
