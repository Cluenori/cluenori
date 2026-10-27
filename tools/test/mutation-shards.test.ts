import { assert, describe, it } from "@effect/vitest"

import { shardsOf, testedPaths } from "../src/mutation-shards.ts"

describe("shardsOf", () => {
  it("keeps a package under the budget in one shard, its paths sorted", () => {
    const shards = shardsOf(
      [
        { path: "src/records.ts", lines: 300, tested: true },
        { path: "src/index.ts", lines: 20, tested: true },
        { path: "src/promote.ts", lines: 500, tested: true },
      ],
      1_200,
    )
    assert.deepStrictEqual(shards, [["src/index.ts", "src/promote.ts", "src/records.ts"]])
  })

  it("makes the fewest shards the budget allows, balanced by lines, longest file first", () => {
    const shards = shardsOf(
      [
        { path: "src/a.ts", lines: 900, tested: true },
        { path: "src/b.ts", lines: 700, tested: true },
        { path: "src/c.ts", lines: 500, tested: true },
        { path: "src/d.ts", lines: 300, tested: true },
      ],
      1_200,
    )
    // 2,400 lines make two shards: 900 then 700 go apart, 500 joins 700, and 300 joins 900.
    assert.deepStrictEqual(shards, [
      ["src/a.ts", "src/d.ts"],
      ["src/b.ts", "src/c.ts"],
    ])
  })

  it("makes the same shards whatever order the files come in", () => {
    const files = [
      { path: "src/a.ts", lines: 400, tested: true },
      { path: "src/b.ts", lines: 400, tested: true },
      { path: "src/c.ts", lines: 400, tested: true },
      { path: "src/d.ts", lines: 400, tested: true },
    ]
    assert.deepStrictEqual(shardsOf(files.toReversed(), 1_000), shardsOf(files, 1_000))
    // 1,600 lines make two shards; on a tie, a file goes to the first of the emptiest.
    assert.deepStrictEqual(shardsOf(files, 1_000), [
      ["src/a.ts", "src/c.ts"],
      ["src/b.ts", "src/d.ts"],
    ])
  })

  it("doesn't split a file longer than the budget", () => {
    assert.deepStrictEqual(shardsOf([{ path: "src/app-store.ts", lines: 2_000, tested: true }], 1_200), [
      ["src/app-store.ts"],
    ])
  })

  it("makes no shards of no files", () => {
    assert.deepStrictEqual(shardsOf([], 1_200), [])
  })

  it("starts each shard with a file the tests load, so Stryker can tell the others aren't covered", () => {
    const shards = shardsOf(
      [
        { path: "src/setup.ts", lines: 1_000, tested: false },
        { path: "src/update.ts", lines: 900, tested: false },
        { path: "src/version-bump.ts", lines: 200, tested: true },
        { path: "src/deploy-targets.ts", lines: 100, tested: true },
      ],
      1_200,
    )
    // 2,200 lines make two shards, each started by a tested file; the untested files then join the
    // emptiest, as without tests.
    assert.deepStrictEqual(shards, [
      ["src/update.ts", "src/version-bump.ts"],
      ["src/deploy-targets.ts", "src/setup.ts"],
    ])
  })

  it("makes no more shards than files the tests load", () => {
    const shards = shardsOf(
      [
        { path: "src/a.ts", lines: 1_000, tested: false },
        { path: "src/b.ts", lines: 1_000, tested: false },
        { path: "src/c.ts", lines: 50, tested: true },
      ],
      1_200,
    )
    assert.deepStrictEqual(shards, [["src/a.ts", "src/b.ts", "src/c.ts"]])
  })

  it("keeps a package whose tests load none of its files in one shard, for Stryker to refuse", () => {
    const shards = shardsOf(
      [
        { path: "src/a.ts", lines: 1_000, tested: false },
        { path: "src/b.ts", lines: 1_000, tested: false },
      ],
      1_200,
    )
    assert.deepStrictEqual(shards, [["src/a.ts", "src/b.ts"]])
  })
})

describe("testedPaths", () => {
  it("follows what the tests import, and what that imports, by relative paths", () => {
    const texts = new Map([
      [
        "test/today.test.ts",
        'import { assert, it } from "@effect/vitest"\n\nimport { Today } from "../src/index.ts"\n',
      ],
      ["src/index.ts", 'export * from "./today.ts"\nexport { pulseOf } from "./project-pulse.ts"\n'],
      ["src/today.ts", 'import "./detectors.ts"\nconst api = await import("./today-api.ts")\nconst label = "today"\n'],
      ["src/project-pulse.ts", 'import {\n  Effect,\n  Schema,\n} from "effect"\n'],
      ["src/detectors.ts", ""],
      ["src/today-api.ts", ""],
      ["src/unused.ts", 'import { Today } from "./today.ts"\n'],
    ])
    assert.deepStrictEqual([...testedPaths(texts, ["test/today.test.ts"])].toSorted(), [
      "src/detectors.ts",
      "src/index.ts",
      "src/project-pulse.ts",
      "src/today-api.ts",
      "src/today.ts",
    ])
  })

  it("leaves out imports of types only, which the compiler removes", () => {
    const texts = new Map([
      [
        "test/links.test.ts",
        [
          'import type { LinkOptions } from "../src/options.ts"',
          'import { type Target, type Link } from "../src/targets.ts"',
          'export type { Row } from "../src/rows.ts"',
          'import { linesOf, type Line } from "../src/lines.ts"',
          'import Links, { type Link } from "../src/links.ts"',
          'import { type Target, } from "../src/targets.ts"',
          'import {} from "../src/empty.ts"',
        ].join("\n"),
      ],
      ["src/options.ts", ""],
      ["src/targets.ts", ""],
      ["src/rows.ts", ""],
      ["src/lines.ts", ""],
      ["src/links.ts", ""],
      ["src/empty.ts", ""],
    ])
    assert.deepStrictEqual([...testedPaths(texts, ["test/links.test.ts"])].toSorted(), [
      "src/empty.ts",
      "src/lines.ts",
      "src/links.ts",
    ])
  })

  it("follows helpers through cycles, but not missing files or package imports with local lookalikes", () => {
    const texts = new Map([
      [
        "test/phones.test.ts",
        'import { inWorkspace } from "./in-workspace.ts"\nimport "../../other/src/x.ts"\nimport "some-library/helpers.ts"\n',
      ],
      ["test/in-workspace.ts", 'import { Phones } from "../src/phones.ts"\nimport "./missing.ts"\n'],
      ["src/phones.ts", 'import "../test/in-workspace.ts"\nimport "./phones.ts"\n'],
      ["test/some-library/helpers.ts", ""],
    ])
    assert.deepStrictEqual([...testedPaths(texts, ["test/phones.test.ts"])].toSorted(), [
      "src/phones.ts",
      "test/in-workspace.ts",
    ])
  })

  it("resolves nested and current-folder paths without mistaking a file outside the package for its own", () => {
    const texts = new Map([
      [
        "test/nested/links.test.ts",
        [
          'import "../../src/./links.ts"',
          'import "../../../src/outside.ts"',
          'import "../../../../src/outside.ts"',
          'import "../../../other/../src/outside.ts"',
          'import "./helper.ts"',
        ].join("\n"),
      ],
      ["test/nested/helper.ts", 'export * from "../../src/links.ts"'],
      ["src/links.ts", 'import "./nested/../target.ts"'],
      ["src/target.ts", ""],
      ["src/outside.ts", 'import "./wrong.ts"'],
      ["src/wrong.ts", ""],
    ])
    assert.deepStrictEqual([...testedPaths(texts, ["test/nested/links.test.ts"])].toSorted(), [
      "src/links.ts",
      "src/target.ts",
      "test/nested/helper.ts",
    ])
  })
})
