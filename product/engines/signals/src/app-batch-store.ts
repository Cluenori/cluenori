import { Context, Effect, Layer } from "effect"

import type { ArchiveUnavailable } from "./archive-store.ts"

/**
 * Where apps' batches are kept as received, scrubbed and with user IDs replaced by people's, each a
 * JSON file by key: the raw product events the lake will be built from. The host provides it: an R2
 * bucket that keeps each file 5 years, as product events are kept. Signals decides the keys and what
 * goes in the files.
 */
export class AppBatchStore extends Context.Service<
  AppBatchStore,
  {
    /** Stores `json` at `key`, replacing what is there; storing the same file again is harmless. */
    readonly put: (key: string, json: string) => Effect.Effect<void, ArchiveUnavailable>
  }
>()("@cluenori/signals/app-batch-store/AppBatchStore") {
  /** A store in memory, for tests: what is put lands in `files`. */
  static readonly layerMemory = (files: Map<string, string> = new Map()) =>
    Layer.succeed(
      AppBatchStore,
      AppBatchStore.of({
        put: (key, json) =>
          Effect.sync(() => {
            files.set(key, json)
          }),
      }),
    )
}
