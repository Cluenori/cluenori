import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Path } from "effect"

import { checkWorkspace } from "../src/index.ts"
import type { PackageRule } from "../src/index.ts"
import { memoryFileSystem } from "./memory-file-system.ts"

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

const root = `{
  "name": "acme",
  "workspaces": {
    "packages": ["packages/*", "apps/*"],
    "catalog": { "effect": "4.0.5", "vitest": "5.0.5" }
  }
}`

// A capability with a contract, and an app that uses it: together they follow the rules.
const money = {
  "/repo/packages/money/package.json": `{
    "name": "@acme/money",
    "exports": { ".": "./src/index.ts" },
    "dependencies": { "effect": "catalog:" },
    "devDependencies": { "vitest": "catalog:" }
  }`,
  "/repo/packages/money/src/index.ts": `import { Schema } from "effect"\nexport const Cents = Schema.Int\n`,
  "/repo/packages/money/test/cents.test.ts": `import { expect, it } from "vitest"\n`,
}
const shop = {
  "/repo/apps/shop/package.json": `{
    "name": "@acme/shop",
    "dependencies": { "@acme/money": "workspace:*", "effect": "catalog:" }
  }`,
  "/repo/apps/shop/src/main.ts": `import { Cents } from "@acme/money"\nimport { Effect } from "effect"\nimport { HttpRouter } from "effect/http"\n`,
}

const check = (files: Readonly<Record<string, string>>) =>
  checkWorkspace("/repo", rules).pipe(
    Effect.map((violations) => violations.map((violation) => [violation.folder, violation.check])),
    Effect.provide(Layer.mergeAll(memoryFileSystem({ "/repo/package.json": root, ...files }), Path.layer)),
  )

describe("checkWorkspace", () => {
  it.effect("accepts a workspace that follows its rules", () =>
    Effect.gen(function* () {
      const violations = yield* check({ ...money, ...shop })
      assert.deepStrictEqual(violations, [])
    }),
  )

  it.effect("rejects a dependency its folder may not use, and the cycle it makes", () =>
    Effect.gen(function* () {
      const violations = yield* check({
        ...money,
        ...shop,
        "/repo/packages/money/package.json": `{
          "name": "@acme/money",
          "exports": { ".": "./src/index.ts" },
          "dependencies": { "@acme/shop": "workspace:*", "effect": "catalog:" }
        }`,
      })
      assert.deepStrictEqual(violations, [
        ["apps/shop", "cycle"],
        ["packages/money", "dependency"],
      ])
    }),
  )

  it.effect("requires exact versions in the catalog and the catalog for npm packages", () =>
    Effect.gen(function* () {
      const violations = yield* check({
        ...money,
        ...shop,
        "/repo/package.json": root.replace(`"effect": "4.0.5"`, `"effect": "^4.0.5"`),
        "/repo/apps/shop/package.json": `{
          "name": "@acme/shop",
          "dependencies": { "@acme/money": "*", "effect": "4.0.5" }
        }`,
      })
      assert.deepStrictEqual(violations, [
        [".", "version"],
        ["apps/shop", "version"],
        ["apps/shop", "version"],
      ])
    }),
  )

  it.effect("requires the folder's name, and exports only for packages with a contract", () =>
    Effect.gen(function* () {
      const violations = yield* check({
        ...money,
        ...shop,
        "/repo/packages/tax/package.json": `{ "name": "tax", "dependencies": { "effect": "catalog:" } }`,
        "/repo/packages/tax/src/index.ts": `import { Schema } from "effect"\n`,
        "/repo/apps/shop/package.json": `{
          "name": "@acme/shop",
          "exports": { ".": "./src/main.ts" },
          "dependencies": { "@acme/money": "workspace:*", "effect": "catalog:" }
        }`,
      })
      assert.deepStrictEqual(violations, [
        ["apps/shop", "contract"],
        ["packages/tax", "contract"],
        ["packages/tax", "name"],
      ])
    }),
  )

  it.effect("reports a package no rule covers", () =>
    Effect.gen(function* () {
      const violations = yield* check({
        ...money,
        "/repo/package.json": root.replace(`"apps/*"`, `"apps/*", "tools/*"`),
        "/repo/tools/release/package.json": `{ "name": "@acme/release" }`,
      })
      assert.deepStrictEqual(violations, [["tools/release", "rule"]])
    }),
  )

  it.effect("fails on a malformed package.json, naming the file", () =>
    Effect.gen(function* () {
      const error = yield* check({ ...money, "/repo/packages/money/package.json": `{ "name": ` }).pipe(Effect.flip)
      assert.strictEqual(error._tag, "WorkspaceUnreadable")
      assert.strictEqual(error.path, "packages/money/package.json")
    }),
  )
})
