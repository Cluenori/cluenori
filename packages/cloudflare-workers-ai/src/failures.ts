import { Predicate } from "effect"
import { AiError } from "effect/ai"

/** What a thrown value says: an error's message, or a string itself. */
export const messageOf = (cause: unknown): string => {
  if (Predicate.isString(cause)) {
    return cause
  }
  if (Predicate.hasProperty(cause, "message") && Predicate.isString(cause.message)) {
    return cause.message
  }
  return "Workers AI failed without saying why"
}

/**
 * The reason a call to the binding failed. The binding throws errors whose message carries Workers
 * AI's code, such as `3040: Capacity temporarily exceeded, please try again.`, sometimes after a
 * name (`InferenceUpstreamError: 3040: ...`), and no HTTP status. Each documented code becomes the
 * matching reason (https://developers.cloudflare.com/workers-ai/platform/errors/); any other
 * failure is an `UnknownError` with the binding's message.
 */
export const failureOf = (cause: unknown): AiError.AiErrorReason => {
  const message = messageOf(cause)
  if (jsonModeUnmet.test(message)) {
    return new AiError.InvalidOutputError({ description: message, metadata: { workersAi: { message } } })
  }
  for (const code of codesIn(cause, message)) {
    const reason = reasonFor(code, message)
    if (reason !== undefined) {
      return reason
    }
  }
  return new AiError.UnknownError({ description: message, metadata: { workersAi: { message } } })
}

// JSON mode's documented failure, when the model couldn't answer to the schema.
const jsonModeUnmet = /JSON Mode couldn.t be met/i

// A numeric `code` first, then every "<digits>:" in the message, as a request ID may come first.
const codesIn = (cause: unknown, message: string): ReadonlyArray<number> => {
  const stated = Predicate.hasProperty(cause, "code") && Predicate.isNumber(cause.code) ? [cause.code] : []
  const written = Array.from(message.matchAll(/\b(\d{4})\s*:/g), (match) => Number(match[1]))
  return [...stated, ...written]
}

const reasonFor = (code: number, message: string): AiError.AiErrorReason | undefined => {
  const metadata = { workersAi: { code, message } }
  switch (code) {
    // No such model; the model name is invalid.
    case 5007:
    case 3042:
      return new AiError.InvalidRequestError({ parameter: "model", description: message, metadata })
    // Invalid data; a fine-tune's files missing; incomplete request; request too large; LoRA
    // unsupported; deprecated SDK.
    case 5004:
    case 3039:
    case 3003:
    case 3006:
    case 5005:
    case 5019:
      return new AiError.InvalidRequestError({ description: message, metadata })
    // The account may not use this model: private, terms not agreed, blocked, or Workers Paid needed.
    case 5018:
    case 3041:
    case 5016:
    case 3023:
    case 5035:
      return new AiError.AuthenticationError({ kind: "InsufficientPermissions", description: message, metadata })
    // The free plan's daily neurons are used up.
    case 3036:
      return new AiError.QuotaExhaustedError({ metadata })
    // Out of capacity, also what `rejectIfBusy` answers: the 429 Workers AI documents. It names no
    // code of its own for its per-minute rate limits.
    case 3040:
      return new AiError.RateLimitError({ metadata })
    // Timed out, or aborted.
    case 3007:
    case 3008:
      return new AiError.InternalProviderError({ description: message, metadata })
    default:
      return undefined
  }
}
