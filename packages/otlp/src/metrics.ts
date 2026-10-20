import { Effect } from "effect"

import { OtlpInvalid } from "./otlp-invalid.ts"
import { readBytes, readerOf, readTag, skip } from "./protobuf-reader.ts"

/**
 * How many resources an OTLP/HTTP metrics export holds, checking that its body is well-formed
 * protobuf with `resource_metrics` at the top. It doesn't read the metrics themselves. Fails with
 * `OtlpInvalid` when the bytes aren't such a message.
 */
export const countResourceMetrics = (body: Uint8Array): Effect.Effect<number, OtlpInvalid> =>
  Effect.suspend(() => {
    const reader = readerOf(body)
    let resources = 0
    for (let tag = readTag(reader); tag !== undefined; tag = readTag(reader)) {
      if (tag.field === 1 && tag.wireType === 2) {
        readBytes(reader)
        resources += 1
      } else {
        skip(reader, tag.wireType)
      }
    }
    return reader.problem === undefined
      ? Effect.succeed(resources)
      : Effect.fail(new OtlpInvalid({ message: reader.problem }))
  })
