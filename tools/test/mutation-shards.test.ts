import { assert, describe, it } from "@effect/vitest"

import { shardsOf } from "../src/mutation-shards.ts"

describe("shardsOf", () => {
  it("keeps a package under the budget in one shard, its paths sorted", () => {
    const shards = shardsOf(
      [
        { path: "src/records.ts", lines: 300 },
        { path: "src/index.ts", lines: 20 },
        { path: "src/promote.ts", lines: 500 },
      ],
      1_200,
    )
    assert.deepStrictEqual(shards, [["src/index.ts", "src/promote.ts", "src/records.ts"]])
  })

  it("makes the fewest shards the budget allows, balanced by lines, longest file first", () => {
    const shards = shardsOf(
      [
        { path: "src/a.ts", lines: 900 },
        { path: "src/b.ts", lines: 700 },
        { path: "src/c.ts", lines: 500 },
        { path: "src/d.ts", lines: 300 },
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
      { path: "src/a.ts", lines: 400 },
      { path: "src/b.ts", lines: 400 },
      { path: "src/c.ts", lines: 400 },
      { path: "src/d.ts", lines: 400 },
    ]
    assert.deepStrictEqual(shardsOf(files.toReversed(), 1_000), shardsOf(files, 1_000))
    // 1,600 lines make two shards; on a tie, a file goes to the first of the emptiest.
    assert.deepStrictEqual(shardsOf(files, 1_000), [
      ["src/a.ts", "src/c.ts"],
      ["src/b.ts", "src/d.ts"],
    ])
  })

  it("doesn't split a file longer than the budget", () => {
    assert.deepStrictEqual(shardsOf([{ path: "src/app-store.ts", lines: 2_000 }], 1_200), [["src/app-store.ts"]])
  })

  it("makes no shards of no files", () => {
    assert.deepStrictEqual(shardsOf([], 1_200), [])
  })
})
