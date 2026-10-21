// The four penalty rules of ISO/IEC 18004:2015, 7.8.3, which score how much a masked symbol could
// confuse a reader. Their weights are the standard's N1 to N4.

// Rule 1: each run of 5 or more modules of one color in a row or a column, 3 plus 1 for each module
// beyond 5.
const runPenaltyOf = (line: ReadonlyArray<boolean>): number =>
  runLengthsOf(line)
    .filter((length) => length >= 5)
    .reduce((total, length) => total + 3 + (length - 5), 0)

// Rule 3: each pattern that looks like a finder, dark, light, dark, light, dark in widths 1:1:3:1:1,
// with 4 light modules on one side, 40; with 4 on both sides it counts twice. Read as Apple's
// encoder reads it: 11 modules in a row or a column, all inside the symbol.
const finderThenLight = [true, false, true, true, true, false, true, false, false, false, false]
const lightThenFinder = finderThenLight.toReversed()

const finderLikePenaltyOf = (line: ReadonlyArray<boolean>): number => {
  let patterns = 0
  for (let start = 0; start + 11 <= line.length; start += 1) {
    const window = line.slice(start, start + 11)
    const finderFirst = window.every((isDark, index) => isDark === finderThenLight[index])
    const lightFirst = window.every((isDark, index) => isDark === lightThenFinder[index])
    patterns += Number(finderFirst) + Number(lightFirst)
  }
  return 40 * patterns
}

// Rule 2: each 2 by 2 block of one color, 3. A larger block of one color counts as every 2 by 2
// block in it, which is what the standard's 3 * (m - 1) * (n - 1) for an m by n block comes to.
const blockPenaltyOf = (modules: ReadonlyArray<boolean>, size: number): number => {
  let blocks = 0
  for (let row = 0; row + 1 < size; row += 1) {
    for (let column = 0; column + 1 < size; column += 1) {
      const color = modules[row * size + column]
      const oneColor =
        modules[row * size + column + 1] === color &&
        modules[(row + 1) * size + column] === color &&
        modules[(row + 1) * size + column + 1] === color
      blocks += Number(oneColor)
    }
  }
  return 3 * blocks
}

// Rule 4: 10 for each step of 5% the share of dark modules lies outside 45% to 55%: 0 within it, 10
// from 40% to 45% or 55% to 60%, and so on. The symbol has an odd number of modules, so its share is
// never exactly on a step.
const balancePenaltyOf = (modules: ReadonlyArray<boolean>): number => {
  const dark = modules.filter((isDark) => isDark).length
  const total = modules.length
  const steps = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
  return 10 * steps
}

// The lengths of the runs of one color along a line, in order.
const runLengthsOf = (line: ReadonlyArray<boolean>): ReadonlyArray<number> => {
  const lengths: Array<number> = []
  let length = 0
  for (const [index, isDark] of line.entries()) {
    const continues = index > 0 && line[index - 1] === isDark
    if (!continues && length > 0) {
      lengths.push(length)
      length = 0
    }
    length += 1
  }
  if (length > 0) {
    lengths.push(length)
  }
  return lengths
}

/**
 * The penalty of a masked symbol, `size` by `size` modules row by row, by the standard's four rules:
 * long runs, 2 by 2 blocks, finder-like patterns, and an unbalanced share of dark modules. The mask
 * whose symbol scores lowest is the one used.
 */
export const maskPenaltyOf = (modules: ReadonlyArray<boolean>, size: number): number => {
  const rows = Array.from({ length: size }, (_, row) => modules.slice(row * size, row * size + size))
  const columns = Array.from({ length: size }, (_, column) => rows.map((row) => row[column] === true))
  const linePenalty = [...rows, ...columns].reduce(
    (total, line) => total + runPenaltyOf(line) + finderLikePenaltyOf(line),
    0,
  )
  return linePenalty + blockPenaltyOf(modules, size) + balancePenaltyOf(modules)
}
