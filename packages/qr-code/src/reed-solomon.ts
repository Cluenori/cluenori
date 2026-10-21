// Reed-Solomon error correction as QR codes use it (ISO/IEC 18004:2015, 7.5.2): codewords are
// elements of GF(256) with the field polynomial x^8 + x^4 + x^3 + x^2 + 1, and the generator
// polynomial of degree n has the roots α^0 to α^(n-1), where α is 2.

const fieldPolynomial = 0x11d

// The product of two field elements: shift and add, reducing by the field polynomial on each shift.
const multiply = (left: number, right: number): number => {
  let product = 0
  for (let bit = 7; bit >= 0; bit -= 1) {
    product = (product << 1) ^ ((product >>> 7) * fieldPolynomial)
    product ^= ((right >>> bit) & 1) * left
  }
  return product
}

// The generator polynomial of `degree`, coefficients from x^(degree-1) down to x^0; its leading
// coefficient, 1, is left out. Built as the product of (x - α^i) for i from 0 to degree - 1.
const generatorOf = (degree: number): ReadonlyArray<number> => {
  const coefficients = Array.from({ length: degree }, (_, index): number => (index === degree - 1 ? 1 : 0))
  let root = 1
  for (let factor = 0; factor < degree; factor += 1) {
    for (const index of coefficients.keys()) {
      // Reads the next coefficient before it is updated; past the end, the coefficient is 0.
      coefficients[index] = multiply(coefficients[index] ?? 0, root) ^ (coefficients[index + 1] ?? 0)
    }
    root = multiply(root, 2)
  }
  return coefficients
}

/** The `degree` error correction codewords of a block of data codewords, in order. */
export const errorCorrectionOf = (data: ReadonlyArray<number>, degree: number): ReadonlyArray<number> => {
  const generator = generatorOf(degree)
  // The remainder of the data polynomial times x^degree, divided by the generator.
  let remainder = generator.map(() => 0)
  for (const codeword of data) {
    const factor = codeword ^ (remainder[0] ?? 0)
    const shifted = [...remainder.slice(1), 0]
    remainder = shifted.map((coefficient, index) => coefficient ^ multiply(generator[index] ?? 0, factor))
  }
  return remainder
}
