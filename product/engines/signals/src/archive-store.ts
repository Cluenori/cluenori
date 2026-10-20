import { Context, Effect, Layer, Option, Ref, Schema } from "effect"

/** The archive can't be reached right now; exports should be sent again later. */
export class ArchiveUnavailable extends Schema.TaggedError<ArchiveUnavailable>()(
  "ArchiveUnavailable",
  { message: Schema.String },
  { httpApiStatus: 503 },
) {}

/**
 * Where whole exports are kept, as files by key. The host provides it: an R2 bucket, which keeps
 * each file 90 days. Signals decides the keys and what goes in the files.
 */
export class ArchiveStore extends Context.Service<
  ArchiveStore,
  {
    /** Stores `bytes` at `key`, replacing what is there; storing the same file again is harmless. */
    readonly put: (key: string, bytes: Uint8Array) => Effect.Effect<void, ArchiveUnavailable>
    /** The file at `key`, or none when it isn't there, such as after 90 days. */
    readonly get: (key: string) => Effect.Effect<Option.Option<Uint8Array>, ArchiveUnavailable>
  }
>()("@cluenori/signals/archive-store/ArchiveStore") {
  /** An archive in memory, for tests. */
  static readonly layerMemory = Layer.effect(
    ArchiveStore,
    Effect.gen(function* () {
      const files = yield* Ref.make(new Map<string, Uint8Array>())
      return ArchiveStore.of({
        put: (key, bytes) => Ref.update(files, (stored) => new Map(stored).set(key, bytes.slice())),
        get: (key) => Ref.get(files).pipe(Effect.map((stored) => Option.fromNullishOr(stored.get(key)))),
      })
    }),
  )
}
