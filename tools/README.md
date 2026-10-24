# @cluenori/tools

The repository's program: the checks `bun run check` adds to the compiler and the linter, and the
files `bun run generate` writes from code. Nothing of it ships; Cluenori's own command is
`apps/cli`.

## Use it

```
bun run check                  … tools check          dependency rules, suppression comments, generated files
bun run generate               tools generate         the OpenAPI documents and the Swift clients of the API and the ingest API
bun run generate:apple-models  tools apple-models     phones' table of Apple's model names, on a Mac with Xcode
```

When something is off, it says what and how to fix it, and exits with code 1:

```
$ bun run check
apps/worker/openapi.json: is out of date with the API definition. Run `bun run generate`.

1 problem.
```

## Owns

- **Cluenori's dependency rules,** `src/dependency-rules.ts`: the table in ARCHITECTURE.md as data.
- **The repository checks** the compiler and the linter can't make: the dependency rules, comments
  that silence a check, and generated files that are out of date.
- **What is generated from code,** `src/generated-files.ts`: the OpenAPI documents of the API and
  the ingest API, and their Swift clients, for the iPhone app and the Swift SDK.

## Does not own

- **How dependency rules are checked:** `@cluenori/workspace-rules`.
- **Cluenori's own command:** `apps/cli`.

## Depends on

- `@cluenori/workspace-rules`, to check the dependency rules.
- `@cluenori/worker`, for the API definitions the OpenAPI documents are generated from.
- `@cluenori/openapi-swift`, for the Swift clients generated from them.
- `effect/cli` for commands, and `@effect/platform-bun` for the file system and child processes.

## Decisions and constraints

- **What it trusts:** this repository's files, and what the programs it starts print (`git`,
  `xcrun`). It reads nothing others send.
- **Runs from the repository's root,** as the root `package.json` scripts do, in Bun, and is never
  deployed.
