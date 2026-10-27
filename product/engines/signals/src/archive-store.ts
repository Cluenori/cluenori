import { Clock, Context, Effect, Layer, Option, Ref, Schema } from "effect"

/** The archive can't be reached right now; exports should be sent again later. */
export class ArchiveUnavailable extends Schema.TaggedError<ArchiveUnavailable>()(
  "ArchiveUnavailable",
  { message: Schema.String },
  { httpApiStatus: 503 },
) {}

/**
 * Deletes one page of the files whose keys start with `prefix`, listed by key after `after` (from
 * the first without it): those of the page stored before `before` (Unix ms), by the store's own
 * time. Returns the page's last key, to go on from, or none when the listing ended. A page is at
 * most 1,000 files: one listing and one deletion.
 */
export type DeleteBefore = (
  prefix: string,
  before: number,
  after: string | undefined,
) => Effect.Effect<Option.Option<string>, ArchiveUnavailable>

/** How many files a page of `DeleteBefore` lists at most. */
export const filesPerPage = 1000

/**
 * A `DeleteBefore` on files in memory, for tests' stores: each kept with when it was stored.
 */
export const deleteBeforeInMemory =
  (stored: Map<string, number>, remove: (key: string) => Effect.Effect<void>): DeleteBefore =>
  (prefix, before, after) =>
    Effect.gen(function* () {
      const page = [...stored.keys()]
        .filter((key) => key.startsWith(prefix) && (after === undefined || key > after))
        .toSorted()
        .slice(0, filesPerPage)
      for (const key of page) {
        if ((stored.get(key) ?? before) < before) {
          stored.delete(key)
          yield* remove(key)
        }
      }
      return page.length === filesPerPage ? Option.fromUndefinedOr(page.at(-1)) : Option.none()
    })

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
    /** Deletes one page of the files under `prefix` stored before a time (`DeleteBefore`). */
    readonly deleteBefore: DeleteBefore
  }
>()("@cluenori/signals/archive-store/ArchiveStore") {
  /** An archive in memory, for tests. */
  static readonly layerMemory = Layer.effect(
    ArchiveStore,
    Effect.gen(function* () {
      const files = yield* Ref.make(new Map<string, Uint8Array>())
      const storedAt = new Map<string, number>()
      return ArchiveStore.of({
        put: (key, bytes) =>
          Clock.currentTimeMillis.pipe(
            Effect.tap((now) => Effect.sync(() => storedAt.set(key, now))),
            Effect.andThen(Ref.update(files, (stored) => new Map(stored).set(key, bytes.slice()))),
          ),
        get: (key) => Ref.get(files).pipe(Effect.map((stored) => Option.fromNullishOr(stored.get(key)))),
        deleteBefore: deleteBeforeInMemory(storedAt, (key) =>
          Ref.update(files, (stored) => {
            const kept = new Map(stored)
            kept.delete(key)
            return kept
          }),
        ),
      })
    }),
  )
}
