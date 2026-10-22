# @cluenori/cloudflare-workers-ai

Effect's provider-neutral `LanguageModel` (`effect/ai`) on Cloudflare Workers AI: a product writes
text with `LanguageModel.generateText`, streams it with `streamText`, or decodes an object with
`generateObject`, without knowing whose model answers.

## Use it

```ts
import { WorkersAi, WorkersAiModel } from "@cluenori/cloudflare-workers-ai"
import { Config, Effect, Layer } from "effect"
import { LanguageModel } from "effect/ai"

// In a Worker's host, with its AI binding (`"ai": { "binding": "AI" }` in wrangler.jsonc). The model
// comes from configuration, decoded, so an ID of the wrong shape fails at startup.
const LanguageModelLive = Layer.unwrap(
  Effect.map(Config.schema(WorkersAiModel, "AI_MODEL"), (model) =>
    WorkersAi.layer({ binding: env.AI, model, maxTokens: 1024 }),
  ),
)

// Anywhere: text from whichever model the host chose.
const draft = Effect.gen(function* () {
  const response = yield* LanguageModel.generateText({
    prompt: [
      { role: "system", content: "You write release notes in plain sentences." },
      { role: "user", content: "Summarize: fixed sync on iOS 18; exports keep their dates." },
    ],
  })
  return response.text // "Sync works again on iOS 18, and exports keep their dates."
  // response.finishReason: "stop", "length", …, or "unknown" when the model didn't say
  // response.usage.outputTokens.total: 14, or undefined when Workers AI didn't count
})
```

`streamText` gives the text as `text-delta` parts while the model writes, then a `finish` part.
`generateObject({ prompt, schema, objectName })` asks in Workers AI's JSON mode and decodes the
answer with the schema.

Every failure is an `AiError` whose `reason` says what happened. Workers AI out of capacity is a
`RateLimitError`, which `isRetryable`: ask again later. A model Workers AI doesn't have is an
`InvalidRequestError` with `parameter: "model"`, which asking again won't change:

```ts
const drafted = draft.pipe(
  Effect.catchReason("AiError", "RateLimitError", () => Effect.succeed("The draft is waiting for Workers AI.")),
)
```

## Contract

`src/index.ts`. A host builds `WorkersAi.layer` once, with the binding, a model and how long and how
random its answers may be; everything else uses `effect/ai`'s `LanguageModel`, so another provider's
layer can replace this one without changing callers.

## Depends on

`effect`, for `effect/ai`; and a Workers AI binding the host passes, `env.AI`.

## Settings

The binding; the model, a `WorkersAiModel` such as `@cf/meta/llama-4-scout-17b-16e-instruct`,
which differs between deployments; and optionally `maxTokens` and `temperature`, for the answers a
product wants. A product that wants answers of two kinds builds two layers.

## Decisions and constraints

- **The binding is structural.** `WorkersAiBinding` is the one method used, `run`, so the package
  needs no Cloudflare types and tests pass a fake. Cloudflare's `Ai` binding fits it, checked
  against the Worker's generated runtime types.
- **What a prompt becomes.** System, user and assistant messages become Workers AI's `messages`,
  each with its text parts joined as they are, as the models' chat templates join them. An
  assistant's reasoning from an earlier answer is left out. A file, a tool call or result, or a tool
  message fails with `InvalidUserInputError`; a request with a toolkit fails with
  `InvalidRequestError`. Tools aren't supported.
- **Tokens and temperature are the layer's.** `effect/ai` 4.0.5 passes a provider the prompt, the
  tools, the tool choice, the response format, a span and incremental-prompt fields, and no sampling
  settings, so `maxTokens` and `temperature` are settings. Without `maxTokens`, Workers AI's
  default applies: 256 tokens for most models, which cuts longer answers short. Ignored from what
  `effect/ai` passes: the tool choice, as there are no tools; the incremental prompt and previous
  response ID, as Workers AI keeps no conversation, so the whole prompt is sent each time; and
  messages' and parts' provider options.
- **Two answer shapes.** Workers AI's own, `{ response, usage }` (Llama, Mistral, DeepSeek and
  most models), and OpenAI's chat completion, `{ choices, usage }` (Kimi, Qwen 3, gpt-oss), as the
  models' API schemas on developers.cloudflare.com/workers-ai/models describe them. Workers AI's own
  shape states no finish reason, so it is `unknown`; tokens it didn't count are `undefined`, never
  zero. A model's `reasoning_content` isn't passed on. An answer in neither shape fails with
  `InvalidOutputError`.
- **Streaming.** `streamText` asks with `stream: true` and reads the server-sent events as they
  come: each `data:` line is a JSON chunk of either shape, until `data: [DONE]`. A stream that ends
  before `[DONE]` with no reason stated finishes with `error`, as cut off. A model that answers a
  stream request whole, as some do, gives its whole answer as one delta. In workerd a
  `ReadableStream` is async-iterable, of bytes, and ending the iteration cancels it (checked in
  workerd 1.20261019.1), so an interrupted `streamText` stops reading Workers AI.
- **Structured output.** `effect/ai`'s `generateObject` passes a provider the JSON response format
  and decodes the answer's text as JSON with the schema; it doesn't describe the schema in the
  prompt. So this package asks in Workers AI's JSON mode, `response_format: { type: "json_schema",
  json_schema }` with the bare JSON Schema and the object's name as its `title`, as Cloudflare's own
  AI SDK provider does for every `@cf/` model; JSON mode's object `response` is read back as JSON
  text. Cloudflare documents JSON mode for a list of models and doesn't guarantee the schema is met:
  "JSON Mode couldn't be met" fails with `InvalidOutputError`, and a model that answers prose fails
  in `effect/ai` with `StructuredOutputError`. JSON mode doesn't stream; `generateObject` doesn't.
- **Failures.** The binding throws errors whose message carries Workers AI's code
  (developers.cloudflare.com/workers-ai/platform/errors): 5007 and 3042 (no such model) are
  `InvalidRequestError` for the model; 5004, 3039, 3003, 3006, 5005 and 5019 (the request) are
  `InvalidRequestError`; 5018, 3041, 5016, 3023 and 5035 (the account may not use the model) are
  `AuthenticationError`; 3036 (the free plan's daily neurons used) is `QuotaExhaustedError`; 3040
  (out of capacity, Workers AI's documented 429; it names no code for its per-minute rate limits)
  is `RateLimitError`; 3007 and 3008 (timeout, aborted) are `InternalProviderError`. Anything else
  is `UnknownError` with the binding's message. Each reason's `metadata.workersAi` keeps the code
  and message.
- **One run per call.** Nothing is retried here; `AiError.isRetryable` tells the caller whether
  asking again may work. Interrupting a call aborts the binding's run through its signal.
- **`effect/ai` is unstable.** It is allowed by name in `tsconfig.base.json` and pinned with
  `effect`; an `effect` upgrade reads its changelog for `LanguageModel.make` and the response parts.
