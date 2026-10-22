import { AppBatchStore, ArchiveStore, ArchiveUnavailable } from "@cluenori/signals"
import { Effect, Layer, Option } from "effect"

const unavailable = (action: string) => (cause: unknown) =>
  new ArchiveUnavailable({
    message: `Couldn't ${action} the archive in R2: ${cause instanceof Error ? cause.message : "unknown"}`,
  })

// The archive's files are gzip: exports compress well, and R2 bills for what it stores.
const transformed = (bytes: Uint8Array, transform: TransformStream<Uint8Array, Uint8Array>) =>
  new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer()

/** The archive in an R2 bucket, its files compressed with gzip. */
export const r2ArchiveLayer = (bucket: R2Bucket) =>
  Layer.succeed(
    ArchiveStore,
    ArchiveStore.of({
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
        })
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
    }),
  )

const utf8 = new TextEncoder()

/** Apps' batches in an R2 bucket, kept 5 years by its lifecycle rule, each a JSON file compressed with gzip. */
export const r2AppBatchLayer = (bucket: R2Bucket) =>
  Layer.succeed(
    AppBatchStore,
    AppBatchStore.of({
      put: Effect.fn("R2AppBatches.put")(function* (key: string, json: string) {
        const compressed = yield* Effect.tryPromise({
          try: () => transformed(utf8.encode(json), new CompressionStream("gzip")),
          catch: unavailable("compress a batch for"),
        })
        yield* Effect.tryPromise({
          try: () =>
            bucket.put(key, compressed, { httpMetadata: { contentType: "application/json", contentEncoding: "gzip" } }),
          catch: unavailable("write to"),
        })
      }),
    }),
  )
