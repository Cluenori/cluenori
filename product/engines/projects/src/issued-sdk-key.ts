import { ComponentKey, Instant } from "@cluenori/foundation"
import { Schema } from "effect"

import { SdkKey } from "./sdk-key.ts"

/** One of a component's SDK keys: when it was issued, and when it was revoked, if it was. */
export class IssuedSdkKey extends Schema.Class<IssuedSdkKey>("IssuedSdkKey")({
  key: SdkKey,
  component: ComponentKey,
  issuedAt: Instant,
  revokedAt: Schema.optionalKey(Instant),
}) {}

/** A component's SDK keys, the newest first, revoked ones too. */
export const SdkKeyList = Schema.Struct({ keys: Schema.Array(IssuedSdkKey) }).annotate({ identifier: "SdkKeyList" })
export type SdkKeyList = typeof SdkKeyList.Type

/**
 * The component has no such SDK key; or, where a key is authenticated, it is unknown, revoked, or
 * another project's, which fail alike.
 */
export class SdkKeyNotFound extends Schema.TaggedError<SdkKeyNotFound>()("SdkKeyNotFound", { key: SdkKey }) {}
