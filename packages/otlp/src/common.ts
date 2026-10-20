import type { Reader } from "./protobuf-reader.ts"
import {
  fail,
  readBytes,
  readDouble,
  readMessage,
  readString,
  readTag,
  readVarintBigInt,
  skip,
} from "./protobuf-reader.ts"

// The messages traces, logs and metrics share: attributes, resources, and instrumentation scopes.

/**
 * An attribute's value. Integers and doubles are both numbers; an integer beyond 2^53 loses
 * precision. `null` is OTLP's empty value.
 */
export type AnyValue =
  | string
  | boolean
  | number
  | Uint8Array
  | null
  | ReadonlyArray<AnyValue>
  | ReadonlyMap<string, AnyValue>

/** Attributes by key; the last of two with the same key wins. A map, so no key can be a prototype's. */
export type Attributes = ReadonlyMap<string, AnyValue>

export interface InstrumentationScope {
  readonly name: string
  readonly version: string
}

// Arrays and key-value lists may nest; past this depth a message is refused rather than walked.
const maxValueDepth = 16

export const readAnyValue = (reader: Reader, depth: number): AnyValue => {
  if (depth > maxValueDepth) {
    fail(reader, `Attribute values nest deeper than ${maxValueDepth} levels`)
    return null
  }
  let value: AnyValue = null
  for (let tag = readTag(reader); tag !== undefined; tag = readTag(reader)) {
    if (tag.field === 1 && tag.wireType === 2) {
      value = readString(reader)
    } else if (tag.field === 2 && tag.wireType === 0) {
      value = readVarintBigInt(reader) !== 0n
    } else if (tag.field === 3 && tag.wireType === 0) {
      value = Number(BigInt.asIntN(64, readVarintBigInt(reader)))
    } else if (tag.field === 4 && tag.wireType === 1) {
      value = readDouble(reader)
    } else if (tag.field === 5 && tag.wireType === 2) {
      value = readMessage(reader, (inner) => readValues(inner, depth + 1))
    } else if (tag.field === 6 && tag.wireType === 2) {
      value = readMessage(reader, (inner) => readAttributeList(inner, depth + 1))
    } else if (tag.field === 7 && tag.wireType === 2) {
      value = readBytes(reader).slice()
    } else {
      skip(reader, tag.wireType)
    }
  }
  return value
}

// ArrayValue: repeated AnyValue values = 1.
const readValues = (reader: Reader, depth: number): ReadonlyArray<AnyValue> => {
  const values: Array<AnyValue> = []
  for (let tag = readTag(reader); tag !== undefined; tag = readTag(reader)) {
    if (tag.field === 1 && tag.wireType === 2) {
      values.push(readMessage(reader, (inner) => readAnyValue(inner, depth)))
    } else {
      skip(reader, tag.wireType)
    }
  }
  return values
}

// KeyValue: string key = 1; AnyValue value = 2.
export const readKeyValue = (reader: Reader, depth: number, into: Map<string, AnyValue>) => {
  let key = ""
  let value: AnyValue = null
  for (let tag = readTag(reader); tag !== undefined; tag = readTag(reader)) {
    if (tag.field === 1 && tag.wireType === 2) {
      key = readString(reader)
    } else if (tag.field === 2 && tag.wireType === 2) {
      value = readMessage(reader, (inner) => readAnyValue(inner, depth))
    } else {
      skip(reader, tag.wireType)
    }
  }
  into.set(key, value)
}

// KeyValueList: repeated KeyValue values = 1.
export const readAttributeList = (reader: Reader, depth: number): Attributes => {
  const attributes = new Map<string, AnyValue>()
  for (let tag = readTag(reader); tag !== undefined; tag = readTag(reader)) {
    if (tag.field === 1 && tag.wireType === 2) {
      readMessage(reader, (inner) => readKeyValue(inner, depth, attributes))
    } else {
      skip(reader, tag.wireType)
    }
  }
  return attributes
}

// InstrumentationScope: string name = 1; string version = 2.
export const readScope = (reader: Reader): InstrumentationScope => {
  let name = ""
  let version = ""
  for (let tag = readTag(reader); tag !== undefined; tag = readTag(reader)) {
    if (tag.field === 1 && tag.wireType === 2) {
      name = readString(reader)
    } else if (tag.field === 2 && tag.wireType === 2) {
      version = readString(reader)
    } else {
      skip(reader, tag.wireType)
    }
  }
  return { name, version }
}

// Resource: repeated KeyValue attributes = 1.
export const readResource = (reader: Reader): Attributes => readAttributeList(reader, 0)
