import { ComponentKey, Instant, Uuidv7 } from "@cluenori/foundation"
import { Duration, Schema } from "effect"

import { IngestKey } from "./ingest-key.ts"

/** One of a component's ingest keys, by an ID of its own, which names it without being it. */
export const IngestKeyId = Uuidv7.pipe(Schema.brand("IngestKeyId")).annotate({ identifier: "IngestKeyId" })
export type IngestKeyId = typeof IngestKeyId.Type

/** What a key is called, by where it is used: `ci`, `blue`, `first`. 1 to 40 characters. */
export const IngestKeyName = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(40),
).annotate({ identifier: "IngestKeyName" })
export type IngestKeyName = typeof IngestKeyName.Type

/** At most this many of a component's ingest keys work at once. */
export const ingestKeysPerComponent = 10

/** A key that ended (expired or revoked) is listed this long after, then forgotten. */
export const endedIngestKeysKept = Duration.days(30)

/** A key's owners are told this long before it expires, once each: a week before, then a day. */
export const ingestKeyWarnings = [Duration.days(7), Duration.days(1)] as const

/**
 * One of a component's ingest keys, never the key itself, which is shown once, when it is added.
 * It works until `expiresAt`, when it has one, or `revokedAt`, when it is revoked, whichever comes
 * first; a revocation may be scheduled, so `revokedAt` may be in the future. `lastUsedAt` is the
 * start of the UTC hour it was last used in, so it moves at most once an hour; absent until it is
 * used.
 */
export class IngestKeyInfo extends Schema.Class<IngestKeyInfo>("IngestKeyInfo")({
  id: IngestKeyId,
  component: ComponentKey,
  name: IngestKeyName,
  createdAt: Instant,
  lastUsedAt: Schema.optionalKey(Instant),
  expiresAt: Schema.optionalKey(Instant),
  revokedAt: Schema.optionalKey(Instant),
}) {}

/** A component's ingest keys, the newest first: those that work, and those that ended in the last 30 days. */
export const IngestKeyList = Schema.Struct({ keys: Schema.Array(IngestKeyInfo) }).annotate({
  identifier: "IngestKeyList",
})
export type IngestKeyList = typeof IngestKeyList.Type

/** A new key: what it is called, and when it stops working, if it should. */
export const AddIngestKey = Schema.Struct({
  name: IngestKeyName,
  expiresAt: Schema.optionalKey(Instant),
}).annotate({ identifier: "AddIngestKey" })
export type AddIngestKey = typeof AddIngestKey.Type

/** When a revoked key stops working: now when absent, else that moment, if it is later. */
export const RevokeIngestKey = Schema.Struct({ at: Schema.optionalKey(Instant) }).annotate({
  identifier: "RevokeIngestKey",
})
export type RevokeIngestKey = typeof RevokeIngestKey.Type

/** A key just added, with the key itself, shown only in this answer. */
export const AddedIngestKey = Schema.Struct({ key: IngestKeyInfo, ingestKey: IngestKey }).annotate({
  identifier: "AddedIngestKey",
})
export type AddedIngestKey = typeof AddedIngestKey.Type

/** Why a key wasn't added; see `IngestKeyRefused`. */
export const IngestKeyRefusal = Schema.Literals(["tooMany", "expiryPast"]).annotate({ identifier: "IngestKeyRefusal" })
export type IngestKeyRefusal = typeof IngestKeyRefusal.Type

/**
 * A key wasn't added: `tooMany`, the component has 10 that work, so one must be revoked first;
 * `expiryPast`, it would expire at once.
 */
export class IngestKeyRefused extends Schema.TaggedError<IngestKeyRefused>()("IngestKeyRefused", {
  reason: IngestKeyRefusal,
}) {}

/** The component has no such ingest key, or no longer lists it. */
export class IngestKeyNotFound extends Schema.TaggedError<IngestKeyNotFound>()("IngestKeyNotFound", {
  key: IngestKeyId,
}) {}
