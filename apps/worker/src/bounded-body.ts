import { Effect, Option, Stream } from "effect"
import type { HttpServerRequest } from "effect/http"

/**
 * A request's body, read only up to `maxBytes`: none when it is longer, which an ingest route
 * answers 413. A length the sender declares is refused before reading; a body sent without one is
 * read until it passes the limit and no further, so the Worker never holds more than the limit and
 * one chunk of what anyone sends, whatever the platform's own limit. A body that can't be read is a
 * defect, as the platform failing.
 */
export const boundedBody = Effect.fn("boundedBody")(function* (
  request: HttpServerRequest.HttpServerRequest,
  maxBytes: number,
) {
  if (Number(request.headers["content-length"] ?? "0") > maxBytes) {
    return Option.none<Uint8Array>()
  }
  let length = 0
  const chunks = yield* request.stream.pipe(
    Stream.orDie,
    Stream.takeUntil((chunk) => {
      length += chunk.byteLength
      return length > maxBytes
    }),
    Stream.runCollect,
  )
  if (length > maxBytes) {
    return Option.none<Uint8Array>()
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return Option.some(body)
})
