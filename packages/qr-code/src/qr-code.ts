import { Result } from "effect"

import { maskPenaltyOf } from "./mask-penalty.ts"
import { QrCodeTooLong } from "./qr-code-too-long.ts"
import { errorCorrectionOf } from "./reed-solomon.ts"

/**
 * A QR code as plain data: `size` by `size` modules, the standard's word for its squares. Holds no
 * quiet zone; whoever draws it leaves 4 light modules on every side.
 */
export interface QrCode {
  /** Modules on each side: 21 at version 1, and 4 more for each version up to 57 at version 10. */
  readonly size: number
  /** `size * size` modules, row by row from the top left, `true` for a dark one. */
  readonly modules: ReadonlyArray<boolean>
}

// A version at level M: its error correction (ISO/IEC 18004:2015, Table 9) and the rows and columns
// its alignment patterns are centered on (Annex E).
interface Version {
  readonly number: number
  readonly correctionPerBlock: number
  // The data codewords of each block, in the order data fills them.
  readonly blocks: ReadonlyArray<number>
  readonly alignmentCenters: ReadonlyArray<number>
}

const versions: ReadonlyArray<Version> = [
  { number: 1, correctionPerBlock: 10, blocks: [16], alignmentCenters: [] },
  { number: 2, correctionPerBlock: 16, blocks: [28], alignmentCenters: [6, 18] },
  { number: 3, correctionPerBlock: 26, blocks: [44], alignmentCenters: [6, 22] },
  { number: 4, correctionPerBlock: 18, blocks: [32, 32], alignmentCenters: [6, 26] },
  { number: 5, correctionPerBlock: 24, blocks: [43, 43], alignmentCenters: [6, 30] },
  { number: 6, correctionPerBlock: 16, blocks: [27, 27, 27, 27], alignmentCenters: [6, 34] },
  { number: 7, correctionPerBlock: 18, blocks: [31, 31, 31, 31], alignmentCenters: [6, 22, 38] },
  { number: 8, correctionPerBlock: 22, blocks: [38, 38, 39, 39], alignmentCenters: [6, 24, 42] },
  { number: 9, correctionPerBlock: 22, blocks: [36, 36, 36, 37, 37], alignmentCenters: [6, 26, 46] },
  { number: 10, correctionPerBlock: 26, blocks: [43, 43, 43, 43, 44], alignmentCenters: [6, 28, 50] },
]

// Byte mode: its indicator, and the width of its character count, which grows at version 10.
const byteMode = 0b0100
const countBitsOf = (version: Version): number => (version.number < 10 ? 8 : 16)

const sum = (values: ReadonlyArray<number>): number => values.reduce((total, value) => total + value, 0)

// The bytes of text a version holds: its data bits, less the mode indicator and the count.
const byteCapacityOf = (version: Version): number =>
  Math.floor((sum(version.blocks) * 8 - 4 - countBitsOf(version)) / 8)

const byteLimit = Math.max(...versions.map(byteCapacityOf))

// UTF-8, written here because the platforms this runs on don't all type TextEncoder. A lone
// surrogate, which UTF-8 can't hold, becomes U+FFFD first, as TextEncoder does.
const utf8Of = (text: string): ReadonlyArray<number> => {
  const bytes: Array<number> = []
  for (const character of text.toWellFormed()) {
    const point = character.codePointAt(0) ?? 0
    if (point < 0x80) {
      bytes.push(point)
    } else if (point < 0x800) {
      bytes.push(0xc0 | (point >>> 6), 0x80 | (point & 0x3f))
    } else if (point < 0x1_00_00) {
      bytes.push(0xe0 | (point >>> 12), 0x80 | ((point >>> 6) & 0x3f), 0x80 | (point & 0x3f))
    } else {
      bytes.push(
        0xf0 | (point >>> 18),
        0x80 | ((point >>> 12) & 0x3f),
        0x80 | ((point >>> 6) & 0x3f),
        0x80 | (point & 0x3f),
      )
    }
  }
  return bytes
}

// `value` as `length` bits, the most significant first.
const bitsOf = (value: number, length: number): ReadonlyArray<number> =>
  Array.from({ length }, (_, index) => (value >>> (length - 1 - index)) & 1)

const byteOf = (bits: ReadonlyArray<number>): number => bits.reduce((value, bit) => (value << 1) | bit, 0)

// The data codewords (7.4): mode, count, the bytes, the terminator, then the two pad codewords in
// turn until the version is full.
const dataCodewordsOf = (version: Version, bytes: ReadonlyArray<number>): ReadonlyArray<number> => {
  // Mode and count take 12 or 20 bits, so after the bytes 4 bits are left to a whole byte, and a
  // version that holds the bytes always has room for them: the 4 zero bits of the terminator.
  const bits = [
    ...bitsOf(byteMode, 4),
    ...bitsOf(bytes.length, countBitsOf(version)),
    ...bytes.flatMap((byte) => bitsOf(byte, 8)),
    ...bitsOf(0, 4),
  ]
  const written = Array.from({ length: bits.length / 8 }, (_, index) => byteOf(bits.slice(index * 8, index * 8 + 8)))
  const padding = Array.from({ length: sum(version.blocks) - written.length }, (_, index) =>
    index % 2 === 0 ? 0xec : 0x11,
  )
  return [...written, ...padding]
}

// One codeword from each block in turn, until every block is used up (7.6).
const interleave = (blocks: ReadonlyArray<ReadonlyArray<number>>): ReadonlyArray<number> => {
  const longest = Math.max(...blocks.map((block) => block.length))
  return Array.from({ length: longest }, (_, index) => blocks.flatMap((block) => block.slice(index, index + 1))).flat()
}

// Every codeword in the order it is placed: the data split into blocks, then each block's error
// correction, both interleaved.
const codewordsOf = (version: Version, bytes: ReadonlyArray<number>): ReadonlyArray<number> => {
  const data = dataCodewordsOf(version, bytes)
  const blocks = version.blocks.map((length, index) => {
    const start = sum(version.blocks.slice(0, index))
    return data.slice(start, start + length)
  })
  const corrections = blocks.map((block) => errorCorrectionOf(block, version.correctionPerBlock))
  return [...interleave(blocks), ...interleave(corrections)]
}

// The symbol while it is drawn: which modules are dark, and which belong to function patterns,
// which data never takes and masks never change.
interface Canvas {
  readonly size: number
  readonly dark: Array<boolean>
  readonly reserved: Array<boolean>
}

type Position = readonly [row: number, column: number]

const drawFunction = (canvas: Canvas, [row, column]: Position, isDark: boolean): void => {
  canvas.dark[row * canvas.size + column] = isDark
  canvas.reserved[row * canvas.size + column] = true
}

// A finder pattern with its top left corner at `top`, `left`, and its light separator around it,
// where that is inside the symbol: rings of 7, 5, and 3 modules, dark, light, and dark.
const drawFinder = (canvas: Canvas, top: number, left: number): void => {
  for (let row = top - 1; row <= top + 7; row += 1) {
    for (let column = left - 1; column <= left + 7; column += 1) {
      const inside = row >= 0 && row < canvas.size && column >= 0 && column < canvas.size
      const ring = Math.max(Math.abs(row - top - 3), Math.abs(column - left - 3))
      if (inside) {
        drawFunction(canvas, [row, column], ring !== 2 && ring !== 4)
      }
    }
  }
}

// An alignment pattern centered on `center`: rings of 5 and 3 modules, dark and light, around a
// dark module.
const drawAlignment = (canvas: Canvas, [centerRow, centerColumn]: Position): void => {
  for (let row = centerRow - 2; row <= centerRow + 2; row += 1) {
    for (let column = centerColumn - 2; column <= centerColumn + 2; column += 1) {
      const ring = Math.max(Math.abs(row - centerRow), Math.abs(column - centerColumn))
      drawFunction(canvas, [row, column], ring !== 1)
    }
  }
}

// The check bits of a BCH code: `data` times x^degree modulo `generator`, over GF(2).
const bchCheckBits = (data: number, generator: number, degree: number): number => {
  let remainder = data
  for (let step = 0; step < degree; step += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> (degree - 1)) * generator)
  }
  return remainder
}

// The 15 bits of format information for level M, whose 2 bits are 00, and `mask` (7.9.1).
const formatBitsOf = (mask: number): number => ((mask << 10) | bchCheckBits(mask, 0x537, 10)) ^ 0x5412

// Where each bit of the format information goes, bit 0 first, in each of its two copies (7.9.1).
// One runs down column 8 beside the top-left finder and back along row 8 under it; the other runs
// along row 8 under the top-right finder from the right edge, then down column 8 beside the
// bottom-left finder to the bottom edge.
const formatPositionsOf = (size: number): ReadonlyArray<ReadonlyArray<Position>> => [
  [
    ...[0, 1, 2, 3, 4, 5, 7, 8].map((row): Position => [row, 8]),
    ...[7, 5, 4, 3, 2, 1, 0].map((column): Position => [8, column]),
  ],
  [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((fromEnd): Position => [8, size - fromEnd]),
    ...[7, 6, 5, 4, 3, 2, 1].map((fromEnd): Position => [size - fromEnd, 8]),
  ],
]

// The 18 bits of version information, for versions 7 and up (7.10).
const versionBitsOf = (version: Version): number => (version.number << 12) | bchCheckBits(version.number, 0x1f25, 12)

const drawFunctionPatterns = (canvas: Canvas, version: Version): void => {
  const { size } = canvas
  // Timing patterns along row 6 and column 6, dark on even positions; the finders draw over their ends.
  for (let index = 0; index < size; index += 1) {
    drawFunction(canvas, [6, index], index % 2 === 0)
    drawFunction(canvas, [index, 6], index % 2 === 0)
  }
  drawFinder(canvas, 0, 0)
  drawFinder(canvas, 0, size - 7)
  drawFinder(canvas, size - 7, 0)
  // An alignment pattern on every pair of centers, except the three corners the finders take.
  const centers = version.alignmentCenters
  const first = centers.at(0)
  const last = centers.at(-1)
  for (const row of centers) {
    for (const column of centers) {
      const onFinder =
        (row === first && column === first) || (row === first && column === last) || (row === last && column === first)
      if (!onFinder) {
        drawAlignment(canvas, [row, column])
      }
    }
  }
  // Format information depends on the mask, so it is written with each mask; its modules are
  // reserved here. Beside it, the module that is always dark.
  for (const copy of formatPositionsOf(size)) {
    for (const position of copy) {
      drawFunction(canvas, position, false)
    }
  }
  drawFunction(canvas, [size - 8, 8], true)
  // Version information: two blocks of 6 by 3, above the bottom-left finder and left of the top-right one.
  if (version.number >= 7) {
    const bits = versionBitsOf(version)
    for (let bit = 0; bit < 18; bit += 1) {
      const isDark = ((bits >>> bit) & 1) === 1
      const across = Math.floor(bit / 3)
      const along = size - 11 + (bit % 3)
      drawFunction(canvas, [along, across], isDark)
      drawFunction(canvas, [across, along], isDark)
    }
  }
}

// The modules data fills, in order (7.7.3): from the bottom right, up and down two columns at a
// time, right column first, skipping the vertical timing pattern's column and every function module.
const placementOrderOf = (canvas: Canvas): ReadonlyArray<number> => {
  const { size } = canvas
  const columns = Array.from({ length: size }, (_, index) => size - 1 - index).filter((column) => column !== 6)
  const order: Array<number> = []
  for (let pair = 0; pair * 2 < columns.length; pair += 1) {
    const pairColumns = columns.slice(pair * 2, pair * 2 + 2)
    for (let step = 0; step < size; step += 1) {
      const row = pair % 2 === 0 ? size - 1 - step : step
      for (const column of pairColumns) {
        const index = row * size + column
        if (canvas.reserved[index] !== true) {
          order.push(index)
        }
      }
    }
  }
  return order
}

// The eight masks (Table 10): a data module is inverted where its mask's condition holds.
const masks: ReadonlyArray<(row: number, column: number) => boolean> = [
  (row, column) => (row + column) % 2 === 0,
  (row) => row % 2 === 0,
  (_row, column) => column % 3 === 0,
  (row, column) => (row + column) % 3 === 0,
  (row, column) => (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0,
  (row, column) => ((row * column) % 2) + ((row * column) % 3) === 0,
  (row, column) => (((row * column) % 2) + ((row * column) % 3)) % 2 === 0,
  (row, column) => (((row + column) % 2) + ((row * column) % 3)) % 2 === 0,
]

// The finished symbol with mask number `mask`: its data modules masked, its format information written.
const maskedModulesOf = (
  canvas: Canvas,
  mask: number,
  condition: (row: number, column: number) => boolean,
): ReadonlyArray<boolean> => {
  const { size } = canvas
  const modules = canvas.dark.map((isDark, index) =>
    canvas.reserved[index] === true ? isDark : isDark !== condition(Math.floor(index / size), index % size),
  )
  const format = formatBitsOf(mask)
  for (const copy of formatPositionsOf(size)) {
    for (const [bit, [row, column]] of copy.entries()) {
      modules[row * size + column] = ((format >>> bit) & 1) === 1
    }
  }
  return modules
}

// The symbol of `codewords` at `version`, with the mask of the lowest penalty; on a tie, the lowest mask number.
const symbolOf = (version: Version, codewords: ReadonlyArray<number>): QrCode => {
  const size = 17 + 4 * version.number
  const canvas: Canvas = {
    size,
    dark: Array.from({ length: size * size }, () => false),
    reserved: Array.from({ length: size * size }, () => false),
  }
  drawFunctionPatterns(canvas, version)
  const bits = codewords.flatMap((codeword) => bitsOf(codeword, 8))
  for (const [position, index] of placementOrderOf(canvas).entries()) {
    // Modules past the last codeword are the remainder bits, which stay light.
    canvas.dark[index] = bits[position] === 1
  }
  const candidates = masks.map((condition, mask) => {
    const modules = maskedModulesOf(canvas, mask, condition)
    return { modules, penalty: maskPenaltyOf(modules, size) }
  })
  const chosen = candidates.reduce((best, candidate) => (candidate.penalty < best.penalty ? candidate : best))
  return { size, modules: chosen.modules }
}

/**
 * Encodes `text` as a QR code: its UTF-8 bytes in byte mode, at error correction level M, which
 * survives about 15% of the code being unreadable, in the smallest version from 1 to 10 that holds
 * them. The mask is chosen by the standard's penalty rules (ISO/IEC 18004:2015). Pure, and the same
 * text always gives the same code.
 *
 * Fails with `QrCodeTooLong` when the text takes more than 213 bytes of UTF-8, what version 10 holds
 * at level M. No other modes, levels, or versions are made.
 */
export const encodeQrCode = (text: string): Result.Result<QrCode, QrCodeTooLong> => {
  const bytes = utf8Of(text)
  const version = versions.find((candidate) => bytes.length <= byteCapacityOf(candidate))
  if (version === undefined) {
    return Result.fail(new QrCodeTooLong({ byteLength: bytes.length, limit: byteLimit }))
  }
  const codewords = codewordsOf(version, bytes)
  return Result.succeed(symbolOf(version, codewords))
}
