import { assert, describe, it } from "@effect/vitest"
import { DateTime } from "effect"

import {
  columns,
  count,
  milliseconds,
  minutesWords,
  printable,
  share,
  span,
  uptime,
  utcClock,
  utcMinute,
  utcSecond,
} from "../src/terminal-text.ts"

describe("terminal text", () => {
  it("writes out what a terminal would act on, and keeps lines, tabs and every other character", () => {
    // Clear the screen, set the clipboard (OSC 52, ended by BEL), go back to the line's start, a
    // C1 CSI, and a right-to-left override.
    const hostile = "Sign\u001b[2J\u001b[Hups\u001b]52;c;dG9rZW4=\u0007\rFake\u009b31m \u202Etxt.exe"
    assert.strictEqual(
      printable(hostile),
      String.raw`Sign\u001b[2J\u001b[Hups\u001b]52;c;dG9rZW4=\u0007\u000dFake\u009b31m \u202etxt.exe`,
    )
    assert.strictEqual(printable("Café ✓ 注册\n\tuser-1842"), "Café ✓ 注册\n\tuser-1842")
    // Both ends of every recognized range, the isolated marks, and their printable neighbors.
    const cases = [
      ["\u001f", String.raw`\u001f`],
      [" ", " "],
      ["\u007e", "~"],
      ["\u007f", String.raw`\u007f`],
      ["\u009f", String.raw`\u009f`],
      ["\u00a0", "\u00a0"],
      ["\u061b", "\u061b"],
      ["\u061c", String.raw`\u061c`],
      ["\u061d", "\u061d"],
      ["\u200d", "\u200d"],
      ["\u200e", String.raw`\u200e`],
      ["\u200f", String.raw`\u200f`],
      ["\u2010", "\u2010"],
      ["\u2027", "\u2027"],
      ["\u2028", String.raw`\u2028`],
      ["\u202e", String.raw`\u202e`],
      ["\u202f", "\u202f"],
      ["\u2065", "\u2065"],
      ["\u2066", String.raw`\u2066`],
      ["\u2069", String.raw`\u2069`],
      ["\u206a", "\u206a"],
      ["📝", "📝"],
    ]
    for (const [input, expected] of cases) {
      assert.strictEqual(printable(`a${input}z`), `a${expected}z`)
    }
    // In columns, a cell is measured as it is printed, so the next column still lines up.
    assert.deepStrictEqual(
      columns([
        ["A\rB", "x"],
        ["C-D", "y"],
      ]),
      [String.raw`A\u000dB  x`, "C-D       y"],
    )
  })

  it("writes rounded counts and percentages independently of the machine's locale", () => {
    assert.strictEqual(count(12_408.6), "12,409")
    assert.strictEqual(share(1, 8), "12.5%")
    assert.strictEqual(share(7, 0), "0%")
    // One failed check of 14,400 is 99.993%: never read as 100%.
    assert.strictEqual(uptime(14_399, 14_400), "99.99%")
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

  it("says a window someone set exactly, in hours or days only when whole", () => {
    assert.deepStrictEqual([1, 59, 90, 150, 120, 1440, 2880, 1500].map(minutesWords), [
      "1 minute",
      "59 minutes",
      "90 minutes",
      "150 minutes",
      "2 hours",
      "1 day",
      "2 days",
      "25 hours",
    ])
  })

  it("rounds elapsed time down and changes units only at two hours and two days", () => {
    const cases = [
      [0, "1 minute"],
      [119_999, "1 minute"],
      [120_000, "2 minutes"],
      [7_199_999, "119 minutes"],
      [7_200_000, "2 hours"],
      [172_799_999, "47 hours"],
      [172_800_000, "2 days"],
      [345_599_999, "3 days"],
    ] as const
    for (const [value, expected] of cases) {
      assert.strictEqual(span(value), expected)
    }
  })
})
