import { assert, describe, it } from "@effect/vitest"
import { DateTime } from "effect"

import { columns, count, milliseconds, share, utcClock, utcMinute, utcSecond } from "../src/terminal-text.ts"

describe("terminal text", () => {
  it("writes rounded counts and percentages independently of the machine's locale", () => {
    assert.strictEqual(count(12_408.6), "12,409")
    assert.strictEqual(share(1, 8), "12.5%")
    assert.strictEqual(share(7, 0), "0%")
  })

  it("changes duration units and precision at each boundary", () => {
    const cases = [
      [0.087, "0.09ms"],
      [0.999, "1.00ms"],
      [1, "1.0ms"],
      [4.23, "4.2ms"],
      [9.99, "10.0ms"],
      [10, "10ms"],
      [182.4, "182ms"],
      [999.9, "1000ms"],
      [1_000, "1.0s"],
      [1_234, "1.2s"],
    ] as const
    for (const [value, expected] of cases) {
      assert.strictEqual(milliseconds(value), expected)
    }
  })

  it("writes UTC at minute, second and millisecond precision", () => {
    const time = DateTime.makeUnsafe("2026-10-19T23:45:30.250-03:00")
    assert.strictEqual(utcMinute(time), "2026-10-20 02:45 UTC")
    assert.strictEqual(utcSecond(time), "2026-10-20 02:45:30 UTC")
    assert.strictEqual(utcClock(time), "02:45:30.250")
  })

  it("aligns labels left and numbers right using every row's widths, without trailing spaces", () => {
    assert.deepStrictEqual(
      columns([
        ["Operation", "Count", "Errors"],
        ["GET /notes", "12,408", "0%"],
        ["POST /export", "3", "12.5%"],
        ["Total", "12,411", ""],
      ]),
      [
        "Operation      Count  Errors",
        "GET /notes    12,408      0%",
        "POST /export       3   12.5%",
        "Total         12,411",
      ],
    )
    assert.deepStrictEqual(columns([]), [])
  })
})
