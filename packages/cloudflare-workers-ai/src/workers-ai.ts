import { Effect, Layer, Predicate, Stream } from "effect"
import { AiError, IdGenerator, LanguageModel } from "effect/ai"

import { completeAnswer, completeAnswerStream, streamedAnswer } from "./answers.ts"
import { failureOf, messageOf } from "./failures.ts"
import { messagesOf, toolsUnsupported } from "./messages.ts"
import type { WorkersAiModel } from "./workers-ai-model.ts"

/**
 * The part of a Workers AI binding this package calls: Cloudflare's `Ai` binding, `env.AI` in a
 * Worker, has it, and tests pass a fake.
 */
export interface WorkersAiBinding {
  /**
   * Runs `model` on `inputs`, answering with its output: an object, or for `stream: true` the bytes
   * of its server-sent events. Rejects with an error whose message carries Workers AI's code, such
   * as `3040: Capacity temporarily exceeded, please try again.`. `options.signal` aborts the run.
   */
  run(
    model: string,
    inputs: Readonly<Record<string, unknown>>,
    options?: { readonly signal?: unknown },
  ): Promise<unknown>
}

/** Which model a language model runs on Workers AI, and how. */
export interface WorkersAiSettings {
  /** The Workers AI binding: `env.AI`. */
  readonly binding: WorkersAiBinding
  readonly model: WorkersAiModel
  /**
   * The most tokens an answer may have, Workers AI's `max_tokens`. Without it the model's default
   * applies, 256 for most models, which cuts longer answers short.
   */
  readonly maxTokens?: number
  /** How random answers are, Workers AI's `temperature`, from 0 to 5; the model's default without it. */
  readonly temperature?: number
}

/** Effect's provider-neutral `LanguageModel` on Cloudflare Workers AI. */
export const WorkersAi = {
  /**
   * `LanguageModel` on `settings.model`, run through `settings.binding`.
   *
   * - `generateText` sends the prompt's system, user and assistant messages, their text, and answers
   *   with the model's text, then a finish part with its reason and tokens. A reason the model didn't
   *   state, as Workers AI's own answer shape doesn't, is `unknown`.
   * - `streamText` asks with `stream: true` and gives text deltas as they come, then the finish part;
   *   a stream cut off before its end finishes with `error`.
   * - `generateObject` asks in Workers AI's JSON mode, with the schema's JSON Schema, and
   *   `effect/ai` decodes the answer's text as JSON. Not every model has JSON mode.
   *
   * Fails with `AiError`: `InvalidRequestError` for a request with tools, which aren't supported;
   * `InvalidUserInputError` for a prompt with files or tool calls and results; the binding's
   * failures as their reasons, such as `RateLimitError` for Workers AI out of capacity or
   * `InvalidRequestError` for no such model; `InvalidOutputError` for an answer it can't read.
   * Each call is one run, never retried; interrupting it aborts the run.
   */
  layer: (settings: WorkersAiSettings): Layer.Layer<LanguageModel.LanguageModel> =>
    Layer.effect(LanguageModel.LanguageModel, languageModelOn(settings)),
}

const languageModelOn = (settings: WorkersAiSettings) => {
  const run = Effect.fn("WorkersAi.run")(function* (inputs: Readonly<Record<string, unknown>>) {
    return yield* Effect.tryPromise({
      try: (signal) => settings.binding.run(settings.model, inputs, { signal }),
      catch: failureOf,
    })
  })

  const inputsOf = Effect.fnUntraced(function* (options: LanguageModel.ProviderOptions, stream: boolean) {
    if (options.tools.length > 0) {
      return yield* new AiError.InvalidRequestError({ parameter: "toolkit", description: toolsUnsupported })
    }
    const messages = yield* messagesOf(options.prompt)
    const format = yield* responseFormatOf(options.responseFormat)
    const inputs: Readonly<Record<string, unknown>> = {
      messages,
      ...(settings.maxTokens === undefined ? {} : { max_tokens: settings.maxTokens }),
      ...(settings.temperature === undefined ? {} : { temperature: settings.temperature }),
      ...format,
      ...(stream ? { stream: true } : {}),
    }
    return inputs
  })

  const generateText = Effect.fn("WorkersAi.generateText")(
    function* (options: LanguageModel.ProviderOptions) {
      const inputs = yield* inputsOf(options, false)
      const output = yield* run(inputs)
      return yield* completeAnswer(output)
    },
    Effect.mapError((reason) => AiError.make({ module: "WorkersAi", method: "generateText", reason })),
  )

  const streamText = (options: LanguageModel.ProviderOptions) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const inputs = yield* inputsOf(options, true)
        const output = yield* run(inputs)
        const ids = yield* IdGenerator.IdGenerator
        const id = yield* ids.generateId()
        return isByteStream(output) ? streamedAnswer(output, id) : completeAnswerStream(output, id)
      }),
    ).pipe(Stream.mapError((reason) => AiError.make({ module: "WorkersAi", method: "streamText", reason })))

  return LanguageModel.make({ generateText, streamText })
}

// JSON mode takes the bare JSON Schema (https://developers.cloudflare.com/workers-ai/features/json-mode/),
// not OpenAI's `{ name, schema }`, also for the models that answer as OpenAI does; the object's name
// becomes its title. The schema comes from the transformer `LanguageModel.make` decodes answers with.
const responseFormatOf = (format: LanguageModel.ProviderOptions["responseFormat"]) => {
  switch (format.type) {
    case "text":
      return Effect.succeed({})
    case "json":
      return Effect.try({
        try: () => ({
          response_format: {
            type: "json_schema",
            json_schema: {
              title: format.objectName,
              ...LanguageModel.defaultCodecTransformer(format.schema).jsonSchema,
            },
          },
        }),
        catch: (cause) => new AiError.UnsupportedSchemaError({ description: messageOf(cause) }),
      })
  }
}

// A Worker's `ReadableStream` is async-iterable, of bytes; an answer that came whole is an object.
const isByteStream = (output: unknown): output is AsyncIterable<Uint8Array> =>
  Predicate.hasProperty(output, Symbol.asyncIterator)
