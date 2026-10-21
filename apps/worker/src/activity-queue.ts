import { Envelope } from "@cluenori/foundation"
import { Effect, Schema } from "effect"

// Each message is one activity entry, as JSON text.
const EnvelopeText = Schema.fromJsonString(Schema.toCodecJson(Envelope))

// A batch the queue takes is at most 256 KB; text of this many characters is well within, even
// where each takes 3 bytes.
const charactersPerSend = 64_000

/**
 * Sends activity entries to the activity queue, in as few requests as the queue's limits allow. Fails
 * when the queue doesn't take one, and then some of the entries may have been sent: the consumer's
 * reactions are idempotent, so sending them all again is safe.
 */
export const sendActivity = Effect.fn("sendActivity")(function* (queue: Queue, entries: ReadonlyArray<Envelope>) {
  const texts = yield* Effect.forEach(entries, (entry) => Schema.encodeEffect(EnvelopeText)(entry).pipe(Effect.orDie))
  const sends: Array<Array<MessageSendRequest>> = []
  let characters = charactersPerSend
  for (const text of texts) {
    if (characters + text.length > charactersPerSend) {
      sends.push([])
      characters = 0
    }
    sends.at(-1)?.push({ body: text, contentType: "text" })
    characters += text.length
  }
  for (const messages of sends) {
    yield* Effect.tryPromise(() => queue.sendBatch(messages))
  }
})

/**
 * The activity entries of a batch from the activity queue. A message that isn't one is logged and
 * left out, since trying it again won't change it.
 */
export const activityOf = Effect.fn("activityOf")(function* (batch: MessageBatch) {
  const entries: Array<Envelope> = []
  for (const message of batch.messages) {
    const decoded = yield* Schema.decodeUnknownEffect(EnvelopeText)(message.body).pipe(Effect.option)
    if (decoded._tag === "Some") {
      entries.push(decoded.value)
    } else {
      yield* Effect.logError("The activity queue had a message that isn't an activity entry", { id: message.id })
    }
  }
  return entries
})
