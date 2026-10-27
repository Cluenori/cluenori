// What the SDK sends and reads, as JSON: the ingest contract (product/engines/signals/src/app-batch.ts)
// as it travels. Written out here so the published package stands alone; test/wire-contract.ts has
// the compiler check that every one of these is the contract's encoded shape and back, so the two
// can't drift apart.

interface InSession {
  readonly id: string
  readonly at: string
  readonly session: string
  readonly user?: string
  readonly feature?: string
  readonly screen?: string
}

/** One signal as it travels: those this SDK records. */
export type WireSignal =
  | (InSession & { readonly _tag: "session.started" })
  | (InSession & { readonly _tag: "session.ended"; readonly foregroundMs: number })
  | (InSession & { readonly _tag: "screen"; readonly screen: string })
  | (InSession & {
      readonly _tag: "screen.ready"
      readonly screen: string
      readonly visit: string
      readonly content: "kept" | "fresh"
      readonly ms: number
    })
  | (InSession & {
      readonly _tag: "screen.left"
      readonly screen: string
      readonly visit: string
      readonly visibleMs: number
      readonly cpuMs?: number
      readonly scrollMs?: number
      readonly hitchMs?: number
    })
  | (InSession & { readonly _tag: "app.hang"; readonly ms: number })
  | (InSession & {
      readonly _tag: "event"
      readonly name: string
      readonly properties?: { readonly [key: string]: string | number | boolean }
    })
  | (InSession & {
      readonly _tag: "error"
      readonly type: string
      readonly message: string
      readonly stack?: string
      readonly handled: boolean
    })
  | (InSession & { readonly _tag: "timing"; readonly name: string; readonly ms: number })

/** The device a batch says it came from. */
export interface WireDevice {
  readonly model: string
  readonly platform: "web" | "macOS" | "linux" | "windows"
  readonly osVersion: string
  readonly locale: string
  readonly timeZone: string
}

/** A batch as it travels. */
export interface WireBatch {
  readonly installation: string
  readonly environment: string
  readonly release: string
  readonly device: WireDevice
  readonly sdk: { readonly name: string; readonly version: string }
  readonly sentAt: string
  readonly signals: ReadonlyArray<WireSignal>
}
