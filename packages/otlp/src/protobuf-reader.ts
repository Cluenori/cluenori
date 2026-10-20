// Reads protobuf's wire format (https://protobuf.dev/programming-guides/encoding/) from untrusted
// bytes, without throwing: the first problem is recorded and moves the position to the end, so every
// loop over fields stops and later reads return empty values. The caller checks `problem` once.

// Every runtime this package runs on (Workers, browsers, Bun, Node) has it; declared here, in this
// module only, because the package compiles without any platform's types.
declare const TextDecoder: new (label: "utf-8") => { readonly decode: (input: Uint8Array) => string }

const utf8 = new TextDecoder("utf-8")

export interface Reader {
  readonly bytes: Uint8Array
  readonly view: DataView
  readonly end: number
  position: number
  problem: string | undefined
}

export const readerOf = (bytes: Uint8Array): Reader => ({
  bytes,
  view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  end: bytes.length,
  position: 0,
  problem: undefined,
})

export const fail = (reader: Reader, problem: string) => {
  reader.problem ??= `${problem}, at byte ${reader.position}`
  reader.position = reader.end
}

const need = (reader: Reader, size: number) => {
  if (reader.end - reader.position < size) {
    fail(reader, `The message ends ${size - (reader.end - reader.position)} bytes too early`)
    return false
  }
  return true
}

/** A varint as a bigint, for 64-bit integers: 10 bytes at most. */
export const readVarintBigInt = (reader: Reader): bigint => {
  let value = 0n
  for (let shift = 0n; shift < 70n; shift += 7n) {
    if (!need(reader, 1)) {
      return 0n
    }
    const byte = reader.bytes[reader.position] ?? 0
    reader.position += 1
    value |= BigInt(byte & 0x7f) << shift
    if (byte < 0x80) {
      return BigInt.asUintN(64, value)
    }
  }
  fail(reader, "A varint is longer than 10 bytes")
  return 0n
}

/** A varint that fits a number: a field tag, a length, an enum, a count. */
export const readVarint = (reader: Reader): number => {
  const value = readVarintBigInt(reader)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail(reader, "A length or tag is too large")
    return 0
  }
  return Number(value)
}

export const readFixed64 = (reader: Reader): bigint => {
  if (!need(reader, 8)) {
    return 0n
  }
  const value = reader.view.getBigUint64(reader.position, true)
  reader.position += 8
  return value
}

export const readFixed32 = (reader: Reader): number => {
  if (!need(reader, 4)) {
    return 0
  }
  const value = reader.view.getUint32(reader.position, true)
  reader.position += 4
  return value
}

export const readDouble = (reader: Reader): number => {
  if (!need(reader, 8)) {
    return 0
  }
  const value = reader.view.getFloat64(reader.position, true)
  reader.position += 8
  return value
}

/** A length-delimited field's bytes: a view into the message, not a copy. */
export const readBytes = (reader: Reader): Uint8Array => {
  const length = readVarint(reader)
  if (!need(reader, length)) {
    return new Uint8Array(0)
  }
  const bytes = reader.bytes.subarray(reader.position, reader.position + length)
  reader.position += length
  return bytes
}

/** A string field. Invalid UTF-8 becomes U+FFFD, rather than losing the whole message over a byte. */
export const readString = (reader: Reader): string => utf8.decode(readBytes(reader))

/** Reads an embedded message with `read`, within its length; a problem inside is the parent's. */
export const readMessage = <A>(reader: Reader, read: (inner: Reader) => A): A => {
  const length = readVarint(reader)
  const available = need(reader, length)
  const inner: Reader = {
    bytes: reader.bytes,
    view: reader.view,
    end: available ? reader.position + length : reader.position,
    position: reader.position,
    problem: undefined,
  }
  const message = read(inner)
  if (inner.problem !== undefined) {
    reader.problem ??= inner.problem
    reader.position = reader.end
    return message
  }
  reader.position = inner.end
  return message
}

export interface Tag {
  readonly field: number
  readonly wireType: number
}

/** The next field's number and wire type, or undefined at the end of the message. */
export const readTag = (reader: Reader): Tag | undefined => {
  if (reader.position >= reader.end) {
    return undefined
  }
  const key = readVarint(reader)
  return { field: Math.floor(key / 8), wireType: key % 8 }
}

/** Skips a field this decoder doesn't read, as protobuf requires of fields added later. */
export const skip = (reader: Reader, wireType: number) => {
  switch (wireType) {
    case 0:
      readVarintBigInt(reader)
      return
    case 1:
      readFixed64(reader)
      return
    case 2:
      readBytes(reader)
      return
    case 5:
      readFixed32(reader)
      return
    default:
      fail(reader, `Wire type ${wireType} isn't one protobuf 3 uses`)
  }
}

const hexDigits = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, "0"))

/** Bytes as lowercase hex, as OpenTelemetry writes trace and span IDs. */
export const hexOf = (bytes: Uint8Array): string => Array.from(bytes, (byte) => hexDigits[byte] ?? "").join("")
