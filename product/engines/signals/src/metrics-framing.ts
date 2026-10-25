import { OtlpInvalid } from "@bagatka/otlp-protobuf"
import { Effect } from "effect"

// A varint at `at`: its value, and where what follows it starts; undefined when it runs past the
// body or is longer than 10 bytes, the most a 64-bit varint takes.
const varintAt = (body: Uint8Array, at: number): { readonly value: number; readonly next: number } | undefined => {
  let value = 0
  let scale = 1
  for (let index = at; index < Math.min(at + 10, body.length); index += 1) {
    const byte = body[index] ?? 0
    value += (byte % 0x80) * scale
    scale *= 0x80
    if (byte < 0x80) {
      return { value, next: index + 1 }
    }
  }
  return undefined
}

const refuse = (reason: string) => Effect.fail(new OtlpInvalid({ reason }))

/**
 * How many resources an OTLP/HTTP metrics export holds (`resource_metrics`, field 1), checking only
 * that its top level is well-formed protobuf: every field's tag, and its value's length, within the
 * body. `@bagatka/otlp-protobuf` reads traces and logs, not metrics, so this reads metrics' framing
 * alone, for the archive to keep what is an export. Time linear in the body's size, memory constant.
 * Fails with `OtlpInvalid` saying where it isn't.
 */
export const countResourceMetrics = (body: Uint8Array): Effect.Effect<number, OtlpInvalid> => {
  let resources = 0
  let at = 0
  while (at < body.length) {
    const start = at
    const tag = varintAt(body, at)
    if (tag === undefined) {
      return refuse(`The tag at byte ${at} isn't a varint of at most 10 bytes within the body`)
    }
    const field = Math.floor(tag.value / 8)
    const wireType = tag.value % 8
    if (field === 0) {
      return refuse(`The field at byte ${at} has number 0, which protobuf has none of`)
    }
    if (wireType === 0) {
      const value = varintAt(body, tag.next)
      if (value === undefined) {
        return refuse(`The number at byte ${tag.next} isn't a varint of at most 10 bytes within the body`)
      }
      at = value.next
    } else if (wireType === 1 || wireType === 5) {
      at = tag.next + (wireType === 1 ? 8 : 4)
    } else if (wireType === 2) {
      const length = varintAt(body, tag.next)
      if (length === undefined) {
        return refuse(`The length at byte ${tag.next} isn't a varint of at most 10 bytes within the body`)
      }
      at = length.next + length.value
      resources += field === 1 ? 1 : 0
    } else {
      return refuse(`The field at byte ${at} has wire type ${wireType}, which OTLP's messages don't use`)
    }
    if (at > body.length) {
      return refuse(`The field at byte ${start} runs past the body's ${body.length} bytes`)
    }
  }
  return Effect.succeed(resources)
}
