# @cluenori/journeys

Real flows through the public API, against the Worker running in workerd.

## Use it

```ts
layer(CluenoriClient.layer)("deployment", (it) => {
  it.effect("answers its health check", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      yield* client.health()
    }),
  )
})
```

Run them with `bun run test tests/journeys`, or one with `bun run test tests/journeys/test/<journey>`.

## Owns

- **The journeys,** one file each: `test/<journey>-journey.test.ts`, with named steps for the normal
  path, its consequential failure, and who may use it (PATTERNS.md, "Testing").
- **`CluenoriClient`:** the public API's typed client, derived from `CluenoriApi`, as the dashboard and
  the CLI use it.

## Does not own

- **The Worker.** Journeys run the one that `apps/worker/wrangler.jsonc` describes, unchanged.

## Decisions and constraints

- `@cloudflare/vitest-plugin` runs the journeys inside workerd, next to the Worker, with local
  storage of their own.
- Requests go to the Worker's default export (`exports` from `cloudflare:workers`), the entry the
  platform calls for a request from the internet; nothing listens on a port.
