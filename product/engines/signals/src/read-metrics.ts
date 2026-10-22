import { countResourceMetrics } from "@cluenori/otlp"
import { Crypto, DateTime, Effect } from "effect"
import { Hex } from "effect/encoding"

import type { MetricsExport } from "./exports.ts"
import { BatchDigest } from "./operation-counts.ts"

/**
 * Reads the body of an OTLP/HTTP protobuf metrics export, checking its framing, for the archive to
 * keep as it arrived. Cluenori doesn't read metrics yet; once it does, the archive has them.
 */
export const readMetrics = Effect.fn("readMetrics")(function* (body: Uint8Array) {
  const crypto = yield* Crypto.Crypto
  const now = yield* DateTime.now
  const resources = yield* countResourceMetrics(body)
  const digest = yield* crypto.digest("SHA-256", body).pipe(Effect.orDie)
  // Not handled: removing credentials and personal data from metrics, whose labels rarely hold
  // them; it comes with reading metrics, as it did for traces and logs.
  const read: MetricsExport = {
    digest: BatchDigest.make(Hex.encode(digest)),
    archive: body,
    from: now,
    to: now,
    resources,
  }
  return read
})
