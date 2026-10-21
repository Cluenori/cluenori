import { Schema } from "effect"

/**
 * Where a call came from: the caller's IP address and the country Cloudflare places it in, when
 * known, and its `User-Agent`, in which the app says its own and its iOS version:
 * `Cluenori/1.0 (12) iOS/27.1`.
 */
export const Caller = Schema.Struct({
  address: Schema.optionalKey(Schema.String),
  country: Schema.optionalKey(Schema.String),
  userAgent: Schema.optionalKey(Schema.String),
})
export type Caller = typeof Caller.Type
