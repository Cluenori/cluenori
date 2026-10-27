import type { AppBatch, AppSignal } from "@cluenori/signals"

import type { WireBatch, WireSignal } from "../src/wire.ts"

// The compiler's check that the SDK's wire shapes are the ingest contract's: every signal the SDK
// makes is one the deployment decodes, and every field the contract has for those kinds is here.
// Nothing runs; `tsc` fails when they drift.

type Encoded = typeof AppSignal.Encoded
type Ours = Extract<Encoded, { readonly _tag: WireSignal["_tag"] }>
// An event's properties are any JSON to the contract's type, checked by its filter; the SDK's are
// the values that filter takes, so they are compared without them.
type WithoutProperties<T> = T extends { readonly _tag: "event" } ? Omit<T, "properties"> : T

export const sent = (signal: WireSignal): Encoded => signal
export const known = (signal: WithoutProperties<Ours>): WithoutProperties<WireSignal> => signal
export const batch = (wire: WireBatch): typeof AppBatch.Encoded => ({ ...wire, signals: [...wire.signals] })

// And the same fields of each kind, by name: an optional field only one side has fails here.
type FieldsOf<T> = T extends { readonly _tag: string } ? `${T["_tag"]}.${Extract<keyof T, string>}` : never
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
export const sameFields: Same<FieldsOf<WireSignal>, FieldsOf<Ours>> = true
