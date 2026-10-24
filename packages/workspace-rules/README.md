# @cluenori/workspace-rules

Checks that a JavaScript workspace's packages follow your rules: what each is named, whether others
may import it, and which packages it may depend on, at which versions.

## Use it

```ts
import { checkWorkspace } from "@cluenori/workspace-rules"
import type { PackageRule } from "@cluenori/workspace-rules"

const rules: ReadonlyArray<PackageRule> = [
  {
    folders: "packages/*",
    name: "@acme/*",
    contract: true,
    mayUse: ["packages/*"],
    mayInstall: ["effect"],
    mayInstallForDevelopment: ["vitest"],
  },
  {
    folders: "apps/*",
    name: "@acme/*",
    contract: false,
    mayUse: ["packages/*"],
    mayInstall: ["effect"],
    mayInstallForDevelopment: ["vitest"],
  },
]

// Needs FileSystem and Path: BunServices.layer or NodeServices.layer provides both.
const violations = yield* checkWorkspace(".", rules)
for (const violation of violations) {
  yield* Console.error(`${violation.folder}: ${violation.message}`)
}
// packages/money: May not depend on @acme/shop (apps/shop). packages/* may use packages/*.
```

A `package.json` that is missing or isn't valid JSON fails the whole check with
`WorkspaceUnreadable`, whose `path` names the file and whose `reason` says what is wrong.

## Owns

- **Rules:** what each check means:
  - a package's name comes from its folder;
  - a package with a contract exports exactly `{ ".": "./src/index.ts" }`, and one without exports
    nothing;
  - workspace dependencies are allowed by folder and written `workspace:*`;
  - npm dependencies are allowed by name and written `catalog:`;
  - the catalog holds exact versions;
  - there are no dependency cycles.

## Does not own

- **Which rules a workspace has.** The caller passes them; Cluenori's are in
  `tools/src/dependency-rules.ts`.
- **Whether imports match what `package.json` declares.** Bun's isolated installs make an undeclared
  import fail to resolve, in the type checker and at run time. Telling imports from text that only
  looks like one needs a parser, which this package doesn't take on.
- **The file system.** It reads through Effect's `FileSystem` and `Path`, which the caller provides.

## Contract

`src/index.ts`. Callers pass a workspace root and their rules, and get back every violation, sorted
by folder, as plain data to print or count.

## Depends on

`effect`.

## Decisions and constraints

- Reads every `package.json` in the workspace and changes nothing.
- Folder patterns are a folder (`product/foundation`) or a parent with one `*` in the last segment
  (`packages/*`, `packages/cloudflare-*`). A workspace pattern beyond that fails with
  `WorkspaceUnreadable` rather than being skipped, so no package goes unchecked.
- Reads the catalog in `workspaces.catalog`. Named catalogs (`catalog:<name>`) aren't supported: an
  npm dependency must be exactly `catalog:`.
- Reports at least one cycle wherever cycles exist, each once; it doesn't list every cycle of a
  tangle. Fix one and run it again.
