import { AppBatchStore, ArchiveStore, ArchiveUnavailable } from "@cluenori/signals"
import { Effect, Layer, Option, Semaphore } from "effect"

// What R2 lists in one page at most, and deletes in one call.
const filesPerPage = 1000

// The writes a store lets run at once, each taking one of its lock's permits; a purge's page takes
// them all. Writes don't wait for one another, only for a page being deleted.
const writesAtOnce = 1000

// A store's lock: `writing`'s permits, and `entering`, the one door every write and every page
// goes through in turn. A smaller request may overtake a larger one waiting on a semaphore, so
// without the door writes that keep overlapping would hold a waiting page off for good; with it, a
// page waiting at the door holds back the writes after it, and once through, waits only for the
// writes already started.
interface Lock {
  readonly entering: Semaphore.Semaphore
  readonly writing: Semaphore.Semaphore
}

const makeLock = Effect.all({ entering: Semaphore.make(1), writing: Semaphore.make(writesAtOnce) })

// Runs a write of the store, beside its other writes and never during a page being deleted.
const asWrite =
  (lock: Lock) =>
  <A, E>(write: Effect.Effect<A, E>) =>
    lock.entering
      .withPermits(1)(Effect.void)
      .pipe(Effect.andThen(lock.writing.withPermits(1)(write)))

const unavailable = (action: string) => (cause: unknown) =>
  new ArchiveUnavailable({
    message: `Couldn't ${action} the archive in R2: ${cause instanceof Error ? cause.message : "unknown"}`,
  })

// The archive's files are gzip: exports compress well, and R2 bills for what it stores.
const transformed = (bytes: Uint8Array, transform: TransformStream<Uint8Array, Uint8Array>) =>
  new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer()

// One page of a bucket's files under `prefix`, after `after`: those uploaded before `before` (Unix
// ms) deleted in one call. Returns the page's last key while the listing goes on. R2 can't delete
// on a condition, so a file written again between the listing and the delete would go with it:
// the page holds the store's lock whole, keeping its writes out from the listing until the delete
// is done. The store's writes and purges all run in the project's Durable Object, the
// one place its layer is built, so its lock covers them.
const deleteBefore = (bucket: R2Bucket, lock: Lock) =>
  Effect.fn("R2.deleteBefore")(
    function* (prefix: string, before: number, after: string | undefined) {
      const listed = yield* Effect.tryPromise({
        try: () => bucket.list({ prefix, limit: filesPerPage, ...(after === undefined ? {} : { startAfter: after }) }),
        catch: unavailable("list"),
      })
      const old = listed.objects.filter((object) => object.uploaded.getTime() < before).map((object) => object.key)
      if (old.length > 0) {
        yield* Effect.tryPromise({ try: () => bucket.delete(old), catch: unavailable("delete from") })
      }
      return listed.truncated ? Option.fromUndefinedOr(listed.objects.at(-1)?.key) : Option.none<string>()
    },
    lock.writing.withPermits(writesAtOnce),
    lock.entering.withPermits(1),
  )

/** The archive in an R2 bucket, its files compressed with gzip. */
export const r2ArchiveLayer = (bucket: R2Bucket) =>
  Layer.effect(
    ArchiveStore,
    Effect.gen(function* () {
      const lock = yield* makeLock
      return ArchiveStore.of({
        put: Effect.fn("R2Archive.put")(function* (key: string, bytes: Uint8Array) {
          const compressed = yield* Effect.tryPromise({
            try: () => transformed(bytes, new CompressionStream("gzip")),
            catch: unavailable("compress a file for"),
          })
          yield* Effect.tryPromise({
            try: () =>
              bucket.put(key, compressed, {
                httpMetadata: { contentType: "application/x-protobuf", contentEncoding: "gzip" },
              }),
            catch: unavailable("write to"),
          }).pipe(asWrite(lock))
        }),
        get: Effect.fn("R2Archive.get")(function* (key: string) {
          const object = yield* Effect.tryPromise({ try: () => bucket.get(key), catch: unavailable("read") })
          if (object === null) {
            return Option.none()
          }
          const compressed = yield* Effect.tryPromise({ try: () => object.arrayBuffer(), catch: unavailable("read") })
          const bytes = yield* Effect.tryPromise({
            try: () => transformed(new Uint8Array(compressed), new DecompressionStream("gzip")),
            catch: unavailable("decompress a file of"),
          })
          return Option.some(new Uint8Array(bytes))
        }),
        deleteBefore: deleteBefore(bucket, lock),
      })
    }),
  )

const utf8 = new TextEncoder()

/** Apps' batches in an R2 bucket, kept 5 years by its lifecycle rule, each a JSON file compressed with gzip. */
export const r2AppBatchLayer = (bucket: R2Bucket) =>
  Layer.effect(
    AppBatchStore,
    Effect.gen(function* () {
      const lock = yield* makeLock
      return AppBatchStore.of({
        put: Effect.fn("R2AppBatches.put")(function* (key: string, json: string) {
          const compressed = yield* Effect.tryPromise({
            try: () => transformed(utf8.encode(json), new CompressionStream("gzip")),
            catch: unavailable("compress a batch for"),
          })
          yield* Effect.tryPromise({
            try: () =>
              bucket.put(key, compressed, {
                httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
              }),
            catch: unavailable("write to"),
          }).pipe(asWrite(lock))
        }),
        deleteBefore: deleteBefore(bucket, lock),
      })
    }),
  )
