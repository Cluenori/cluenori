// Writes protobuf's wire format: each function returns the bytes of one field, so messages are the
// concatenation of their fields. Absent and default values are left out, as protobuf 3 does.

// Every runtime this package runs on has it; declared here, in this module only, because the
// package compiles without any platform's types.
declare const TextEncoder: new () => { readonly encode: (input: string) => Uint8Array }

const utf8 = new TextEncoder()

export type Bytes = ReadonlyArray<number>

const varintOf = (value: bigint): Array<number> => {
  const bytes: Array<number> = []
  let rest = BigInt.asUintN(64, value)
  while (rest >= 0x80n) {
    bytes.push(Number(rest & 0x7fn) | 0x80)
    rest >>= 7n
  }
  bytes.push(Number(rest))
  return bytes
}

const tag = (field: number, wireType: number) => varintOf(BigInt(field * 8 + wireType))

export const varintField = (field: number, value: number | bigint): Bytes =>
  value === 0 || value === 0n ? [] : [...tag(field, 0), ...varintOf(BigInt(value))]

/** A varint written even when 0, as a `oneof` member must be to say which one it is. */
export const presentVarintField = (field: number, value: number | bigint): Bytes => [
  ...tag(field, 0),
  ...varintOf(BigInt(value)),
]

export const fixed64Field = (field: number, value: bigint): Bytes => {
  if (value === 0n) {
    return []
  }
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, value, true)
  return [...tag(field, 1), ...bytes]
}

export const doubleField = (field: number, value: number): Bytes => {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setFloat64(0, value, true)
  return [...tag(field, 1), ...bytes]
}

/** A length-delimited field, written even when empty: an empty message still says it is there. */
export const bytesField = (field: number, content: ArrayLike<number>): Bytes => [
  ...tag(field, 2),
  ...varintOf(BigInt(content.length)),
  ...Array.from(content),
]

export const textBytes = (value: string): Uint8Array => utf8.encode(value)

export const stringField = (field: number, value: string): Bytes =>
  value === "" ? [] : bytesField(field, textBytes(value))

/** Lowercase hex, as OpenTelemetry writes trace and span IDs, back to its bytes. */
export const hexBytes = (hex: string): Bytes =>
  Array.from({ length: Math.floor(hex.length / 2) }, (_, at) => Number.parseInt(hex.slice(at * 2, at * 2 + 2), 16))
