import { assert, describe, it } from "@effect/vitest"
import { Result } from "effect"

import type { QrCode } from "../src/index.ts"
import { encodeQrCode } from "../src/index.ts"
import { hello } from "./fixtures/hello.ts"
import { pairingLink } from "./fixtures/pairing-link.ts"

type Position = readonly [row: number, column: number]

// The bytes level M holds in byte mode at versions 1 to 10 (ISO/IEC 18004:2015, Table 7).
const byteCapacities = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]

// Format information for level M and masks 0 to 7 (ISO/IEC 18004:2015, Table C.1).
const levelMFormats = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0] as const

// Version information for versions 7 and 10 (ISO/IEC 18004:2015, Table D.1).
const version7Information = 0x07c94
const version10Information = 0x0a4d3

const encoded = (text: string): QrCode =>
  Result.match(encodeQrCode(text), {
    onSuccess: (code) => code,
    onFailure: (error) => assert.fail(`${error._tag}: ${error.byteLength} bytes`),
  })

const isDark = (code: QrCode, [row, column]: Position): boolean => code.modules[row * code.size + column] === true

const rowsOf = (code: QrCode): ReadonlyArray<string> =>
  range(0, code.size - 1).map((row) =>
    range(0, code.size - 1)
      .map((column) => (isDark(code, [row, column]) ? "#" : "."))
      .join(""),
  )

// The bits at `positions`, the first the most significant.
const bitsAt = (code: QrCode, positions: ReadonlyArray<Position>): number =>
  positions.reduce((value, position) => (value << 1) | Number(isDark(code, position)), 0)

const range = (from: number, to: number): ReadonlyArray<number> =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index)

// The two copies of the format information, bit 14 first (ISO/IEC 18004:2015, Figure 25): along row
// 8 from the left edge, then up column 8, skipping the timing pattern; and up column 8 from the
// bottom edge, then along row 8 to the right edge.
const formatCopiesOf = (code: QrCode): readonly [number, number] => {
  const last = code.size - 1
  const first = [
    ...[0, 1, 2, 3, 4, 5, 7, 8].map((column): Position => [8, column]),
    ...[7, 5, 4, 3, 2, 1, 0].map((row): Position => [row, 8]),
  ]
  const second = [
    ...range(last - 6, last)
      .toReversed()
      .map((row): Position => [row, 8]),
    ...range(last - 7, last).map((column): Position => [8, column]),
  ]
  return [bitsAt(code, first), bitsAt(code, second)]
}

// The two copies of the version information, bit 17 first (ISO/IEC 18004:2015, Figure 27): a block
// 6 wide and 3 high above the bottom-left finder, read from its bottom right, and its mirror left of
// the top-right finder.
const versionCopiesOf = (code: QrCode): readonly [number, number] => {
  const order = range(0, 17).toReversed()
  const bottomLeft = order.map((bit): Position => [code.size - 11 + (bit % 3), Math.floor(bit / 3)])
  const topRight = order.map((bit): Position => [Math.floor(bit / 3), code.size - 11 + (bit % 3)])
  return [bitsAt(code, bottomLeft), bitsAt(code, topRight)]
}

const assertFinderAt = (code: QrCode, top: number, left: number) => {
  for (const row of range(top - 1, top + 7)) {
    for (const column of range(left - 1, left + 7)) {
      const inside = row >= 0 && row < code.size && column >= 0 && column < code.size
      // Rings of 7, 5, and 3 modules around the center, dark, light, and dark; the separator, light.
      const ring = Math.max(Math.abs(row - top - 3), Math.abs(column - left - 3))
      if (inside) {
        assert.strictEqual(isDark(code, [row, column]), ring !== 2 && ring !== 4, `module ${row}, ${column}`)
      }
    }
  }
}

describe("encodeQrCode", () => {
  it("chooses the smallest version that holds the text: 21 modules at version 1, 4 more each version", () => {
    for (const [index, capacity] of byteCapacities.entries()) {
      const size = 21 + 4 * index
      const full = encoded("a".repeat(capacity))
      assert.strictEqual(full.size, size, `${capacity} bytes`)
      assert.strictEqual(full.modules.length, size * size)
      if (index < byteCapacities.length - 1) {
        assert.strictEqual(encoded("a".repeat(capacity + 1)).size, size + 4, `${capacity + 1} bytes`)
      }
    }
  })

  it("draws the finder patterns, their separators, the timing patterns, and the dark module", () => {
    for (const code of [encoded(hello.text), encoded(pairingLink.text), encoded("a".repeat(213))]) {
      const last = code.size - 1
      assertFinderAt(code, 0, 0)
      assertFinderAt(code, 0, code.size - 7)
      assertFinderAt(code, code.size - 7, 0)
      for (const index of range(8, last - 8)) {
        assert.strictEqual(isDark(code, [6, index]), index % 2 === 0, `row 6, column ${index}`)
        assert.strictEqual(isDark(code, [index, 6]), index % 2 === 0, `row ${index}, column 6`)
      }
      assert.isTrue(isDark(code, [code.size - 8, 8]))
    }
  })

  it("writes the format information twice, for level M and the mask it chose", () => {
    // Masks 4 and 7 score lowest for these texts; for the pairing link, Apple's encoder chooses 7 too.
    assert.deepStrictEqual(formatCopiesOf(encoded(hello.text)), [levelMFormats[4], levelMFormats[4]])
    assert.deepStrictEqual(formatCopiesOf(encoded(pairingLink.text)), [levelMFormats[7], levelMFormats[7]])
  })

  it("writes the version information twice from version 7 on", () => {
    assert.deepStrictEqual(versionCopiesOf(encoded("a".repeat(122))), [version7Information, version7Information])
    assert.deepStrictEqual(versionCopiesOf(encoded("a".repeat(213))), [version10Information, version10Information])
  })

  it("holds 213 bytes in version 10, and refuses 214 with QrCodeTooLong", () => {
    assert.strictEqual(encoded("a".repeat(213)).size, 57)
    const refused = encodeQrCode("a".repeat(214))
    assert.isTrue(Result.isFailure(refused))
    if (Result.isFailure(refused)) {
      assert.strictEqual(refused.failure._tag, "QrCodeTooLong")
      assert.strictEqual(refused.failure.byteLength, 214)
      assert.strictEqual(refused.failure.limit, 213)
    }
  })

  it("counts the text's UTF-8 bytes, not its characters", () => {
    // "é" takes 2 bytes, and "😀" takes 4, though it is 2 characters of a JavaScript string.
    assert.strictEqual(encoded(`${"é".repeat(106)}a`).size, 57)
    const refusals = [encodeQrCode("é".repeat(107)), encodeQrCode("😀".repeat(54))]
    const lengths = refusals.map((refused) => (Result.isFailure(refused) ? refused.failure.byteLength : 0))
    assert.deepStrictEqual(lengths, [214, 216])
  })

  it("encodes a short text as the code Apple's Vision decodes", () => {
    assert.deepStrictEqual(rowsOf(encoded(hello.text)), hello.rows)
  })

  it("encodes a pairing link as the code Apple's Vision decodes and Apple's encoder makes", () => {
    assert.deepStrictEqual(rowsOf(encoded(pairingLink.text)), pairingLink.rows)
  })
})
