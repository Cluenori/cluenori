import { Duration, Effect, Option, Random, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"

import type { WireBatch } from "./wire.ts"

// Sends the queue to the deployment, oldest first, one batch at a time, under the Swift SDK's rules
// (sdks/swift/Sources/Cluenori/Delivery.swift): a refused key stops sending for this release, a 429
// waits as long as it says, failures back off, and a body too big is split. What it sends is the
// signals the app recorded, and nothing about its own work: a failure to send never becomes a
// signal, so delivery can't feed itself.

/** One signal waiting, as its JSON, with the release and environment it was recorded in. */
export interface Queued {
  readonly release: string
  readonly environment: string
  readonly json: string
  readonly bytes: number
}

/** Delivery's own state, which only delivery changes. */
export interface DeliveryState {
  stopped: boolean
  notBefore: number | undefined
  failures: number
  /** The most signals a batch may have now: halved by each 413, whole again as batches get through. */
  limit: number
}

/** What one delivery did, and so when to try again. */
export type Outcome =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Sent"; readonly more: boolean }
  | { readonly _tag: "Wait"; readonly duration: Duration.Duration }
  | { readonly _tag: "Stopped" }

export const signalsPerBatch = 500
/** Below the 1 MB the deployment takes, for the JSON around the signals. */
const batchBytes = 800_000
/** What a request may carry as the page goes: browsers keep at most 64 KB of such requests at once. */
const keepaliveBytes = 60_000

const Answer = Schema.fromJsonString(
  Schema.Struct({
    _tag: Schema.optionalKey(Schema.String),
    retryAfterSeconds: Schema.optionalKey(Schema.Finite),
    accepted: Schema.optionalKey(Schema.Finite),
    duplicates: Schema.optionalKey(Schema.Finite),
  }),
)
const headJson = Schema.fromJsonString(Schema.Unknown)

/** 5 s after the first failure, doubling to 15 minutes, each between half and all of that. */
export const backOffMs = (failures: number, random: number) =>
  Math.min(900_000, 5_000 * 2 ** (Math.min(failures, 20) - 1)) * (0.5 + 0.5 * Math.min(Math.max(random, 0), 1))

/**
 * Sends the oldest batch, if it may now. One delivery runs at a time: the caller holds it while this
 * runs. What it sent leaves the queue by identity once the deployment has it, wherever it is in the
 * queue by then, so signals recorded, dropped or cleared while it was on its way stay as they are.
 */
export const deliverOnce = Effect.fn("Delivery.deliverOnce")(function* (options: {
  readonly queue: Array<Queued>
  readonly state: DeliveryState
  readonly keepalive: boolean
  /** The time now, in milliseconds since 1970. */
  readonly now: number
  readonly deployment: string
  readonly key: string
  readonly head: (release: string, environment: string) => Omit<WireBatch, "signals">
  /** Told once, when the deployment refuses the key. */
  readonly rejected: () => void
}) {
  const { queue, state } = options
  if (state.stopped) {
    const stopped: Outcome = { _tag: "Stopped" }
    return stopped
  }
  const now = options.now
  if (state.notBefore !== undefined && now < state.notBefore) {
    const wait: Outcome = { _tag: "Wait", duration: Duration.millis(state.notBefore - now) }
    return wait
  }
  const first = queue[0]
  if (first === undefined) {
    state.limit = signalsPerBatch
    const idle: Outcome = { _tag: "Idle" }
    return idle
  }
  // The oldest signals of one release and environment, within the limits.
  const maxBytes = options.keepalive ? keepaliveBytes : batchBytes
  const taken: Array<Queued> = []
  let bytes = 0
  for (const each of queue) {
    const fits = taken.length < state.limit && bytes + each.bytes + 1 <= maxBytes
    if (each.release !== first.release || each.environment !== first.environment || (!fits && taken.length > 0)) {
      break
    }
    taken.push(each)
    bytes += each.bytes + 1
  }
  if (options.keepalive && bytes > keepaliveBytes) {
    // A signal too big to leave with the page waits for the next run.
    const idle: Outcome = { _tag: "Idle" }
    return idle
  }
  const head = yield* Schema.encodeEffect(headJson)(options.head(first.release, first.environment)).pipe(Effect.orDie)
  // The batch's other fields, then its signals, as they were encoded when recorded.
  const body = `${head.slice(0, -1)},"signals":[${taken.map((each) => each.json).join(",")}]}`
  const http = yield* HttpClient.HttpClient
  const request = HttpClientRequest.post(new URL("/ingest/v1/app/batch", options.deployment).href).pipe(
    HttpClientRequest.bearerToken(options.key),
    HttpClientRequest.bodyText(body, "application/json"),
  )
  const sent = yield* http.execute(request).pipe(
    Effect.flatMap((response) =>
      response.text.pipe(
        Effect.map((text) => ({ status: response.status, text, retryAfter: response.headers["retry-after"] })),
      ),
    ),
    options.keepalive ? Effect.provideService(FetchHttpClient.RequestInit, { keepalive: true }) : (effect) => effect,
    Effect.option,
  )
  const remove = () => {
    const acknowledged = new Set(taken)
    for (let index = queue.length - 1; index >= 0; index--) {
      const each = queue[index]
      if (each !== undefined && acknowledged.has(each)) {
        queue.splice(index, 1)
      }
    }
    const sentOutcome: Outcome = { _tag: "Sent", more: queue.length > 0 }
    return sentOutcome
  }
  const backOff = Effect.fn("Delivery.backOff")(function* (afterSeconds: number | undefined) {
    state.failures += 1
    const random = yield* Random.next
    const waitMs = afterSeconds === undefined ? backOffMs(state.failures, random) : afterSeconds * 1000
    state.notBefore = now + waitMs
    const wait: Outcome = { _tag: "Wait", duration: Duration.millis(waitMs) }
    return wait
  })
  if (Option.isNone(sent)) {
    // No answer: tried again later.
    return yield* backOff(undefined)
  }
  const { status, text, retryAfter } = sent.value
  const answer = yield* Schema.decodeEffect(Answer)(text).pipe(Effect.option)
  const tag = Option.isSome(answer) ? answer.value._tag : undefined
  // Only the deployment's acknowledgment says it has the batch; another 2xx, such as a captive
  // portal's page, is a failure to retry.
  const isAcknowledgment =
    Option.isSome(answer) && answer.value.accepted !== undefined && answer.value.duplicates !== undefined
  if (status >= 200 && status < 300 && isAcknowledgment) {
    state.failures = 0
    state.notBefore = undefined
    state.limit = Math.min(signalsPerBatch, state.limit * 2)
    return remove()
  }
  if (status === 401 && tag === "SdkKeyRejected") {
    state.stopped = true
    options.rejected()
    const stopped: Outcome = { _tag: "Stopped" }
    return stopped
  }
  if (status === 429 && Option.isSome(answer) && answer.value.retryAfterSeconds !== undefined) {
    const seconds = answer.value.retryAfterSeconds
    state.notBefore = now + seconds * 1000
    const wait: Outcome = { _tag: "Wait", duration: Duration.seconds(seconds) }
    return wait
  }
  if (status === 413 || status === 400 || status === 422) {
    // Too big, or refused as it is: sent in halves, and a signal refused alone is dropped.
    if (taken.length > 1) {
      state.limit = Math.max(1, Math.floor(taken.length / 2))
      const again: Outcome = { _tag: "Sent", more: true }
      return again
    }
    state.limit = signalsPerBatch
    return remove()
  }
  // A server's failure, a 429 without its wait, a 401 without the deployment's word for a refused
  // key, or a 2xx without its acknowledgment, such as a captive portal's: tried again later, after
  // `Retry-After` when it says.
  const after = retryAfter === undefined ? Number.NaN : Number(retryAfter)
  return yield* backOff(Number.isFinite(after) && after > 0 ? after : undefined)
})
