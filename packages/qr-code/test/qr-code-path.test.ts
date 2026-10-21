import { assert, describe, it } from "@effect/vitest"
import { Result } from "effect"

import type { QrCode } from "../src/index.ts"
import { encodeQrCode, qrCodePath } from "../src/index.ts"
import { pairingLink } from "./fixtures/pairing-link.ts"

const linkCode: QrCode = Result.match(encodeQrCode(pairingLink.text), {
  onSuccess: (encoded) => encoded,
  onFailure: (error) => assert.fail(error._tag),
})

const rectangle = /M(\d+) (\d+)h(\d+)v1h-\3z/g

const rectanglesOf = (path: string) =>
  [...path.matchAll(rectangle)].map((match) => ({
    column: Number(match[1]),
    row: Number(match[2]),
    width: Number(match[3]),
  }))

// Runs of dark modules along the rows, which the path draws one rectangle each.
const runsOf = (code: QrCode): number =>
  code.modules.filter((isDark, index) => {
    const startsRow = index % code.size === 0
    return isDark && (startsRow || code.modules[index - 1] === false)
  }).length

describe("qrCodePath", () => {
  it("draws every dark module once, and no light one", () => {
    const path = qrCodePath(linkCode)
    const covered = linkCode.modules.map(() => 0)
    for (const { column, row, width } of rectanglesOf(path)) {
      for (let offset = 0; offset < width; offset += 1) {
        covered[row * linkCode.size + column + offset] = (covered[row * linkCode.size + column + offset] ?? 0) + 1
      }
    }
    assert.deepStrictEqual(
      covered,
      linkCode.modules.map((isDark) => Number(isDark)),
    )
  })

  it("draws each run of dark modules along a row as one rectangle, and nothing else", () => {
    const path = qrCodePath(linkCode)
    assert.strictEqual(path.replaceAll(rectangle, ""), "")
    assert.strictEqual(rectanglesOf(path).length, runsOf(linkCode))
    // The top row begins with the top-left finder's 7 modules, then runs of 3 and 2.
    assert.isTrue(path.startsWith("M0 0h7v1h-7zM12 0h3v1h-3zM18 0h2v1h-2z"), path.slice(0, 60))
  })
})
