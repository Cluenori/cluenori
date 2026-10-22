import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Predicate, Result, Schema, Stream } from "effect"
import { LanguageModel, Tool, Toolkit } from "effect/ai"
import type { Response } from "effect/ai"

import type { WorkersAiBinding, WorkersAiSettings } from "../src/index.ts"
import { WorkersAi, WorkersAiModel } from "../src/index.ts"

// The runtime's `ReadableStream` and `TextEncoder`, which tests outside a runtime with their types
// can't name: the parts these tests use. A Worker's AI binding streams a `ReadableStream` of bytes.
declare const ReadableStream: new (source: {
  readonly start: (controller: { readonly enqueue: (chunk: Uint8Array) => void; readonly close: () => void }) => void
}) => AsyncIterable<Uint8Array>
declare const TextEncoder: new () => { readonly encode: (input: string) => Uint8Array }

const model = WorkersAiModel.make("@cf/meta/llama-4-scout-17b-16e-instruct")

interface Asked {
  readonly model: string
  readonly inputs: Readonly<Record<string, unknown>>
}

// A fake binding: answers each run with the next answer, or rejects with the next failure, as the
// binding throws, and keeps what it was asked.
const fakeBinding = (answers: Array<{ readonly answer: unknown } | { readonly failure: unknown }>) => {
  const asked: Array<Asked> = []
  const binding: WorkersAiBinding = {
    run: (askedModel, inputs) => {
      asked.push({ model: askedModel, inputs })
      const next = answers.shift() ?? { failure: { message: "The fake binding has no more answers" } }
      return "answer" in next ? Promise.resolve(next.answer) : Promise.reject(next.failure)
    },
  }
  return { asked, binding }
}

// Server-sent events as the binding streams them: bytes, in chunks that needn't end with an event.
const eventStream = (chunks: ReadonlyArray<string>) => {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start: (controller) => {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

const withWorkersAi = <A, E>(
  fake: ReturnType<typeof fakeBinding>,
  program: Effect.Effect<A, E, LanguageModel.LanguageModel>,
  settings: Partial<WorkersAiSettings> = {},
) => program.pipe(Effect.provide(WorkersAi.layer({ binding: fake.binding, model, ...settings })))

const deltasOf = (parts: ReadonlyArray<Response.StreamPart<{}>>) =>
  parts.flatMap((part) => (part.type === "text-delta" ? [part.delta] : []))

const finishOf = (parts: ReadonlyArray<Response.StreamPart<{}>>) =>
  parts.flatMap((part) => (part.type === "finish" ? [part] : []))[0]

describe("WorkersAi", () => {
  it.effect("sends the prompt's messages as Workers AI's, with the layer's tokens and temperature", () =>
    Effect.gen(function* () {
      const fake = fakeBinding([
        {
          answer: {
            response: "Sync works again on iOS 18.",
            usage: { prompt_tokens: 48, completion_tokens: 9, total_tokens: 57 },
          },
        },
      ])
      const response = yield* withWorkersAi(
        fake,
        LanguageModel.generateText({
          prompt: [
            { role: "system", content: "You write release notes in one sentence." },
            { role: "user", content: "What changed in 2.4.0?" },
            { role: "assistant", content: "Which component?" },
            {
              role: "user",
              content: [
                { type: "text", text: "Notes for iOS. " },
                { type: "text", text: "Fixed: sync on iOS 18." },
              ],
            },
          ],
        }),
        { maxTokens: 512, temperature: 0.2 },
      )

      assert.deepStrictEqual(fake.asked, [
        {
          model: "@cf/meta/llama-4-scout-17b-16e-instruct",
          inputs: {
            messages: [
              { role: "system", content: "You write release notes in one sentence." },
              { role: "user", content: "What changed in 2.4.0?" },
              { role: "assistant", content: "Which component?" },
              { role: "user", content: "Notes for iOS. Fixed: sync on iOS 18." },
            ],
            max_tokens: 512,
            temperature: 0.2,
          },
        },
      ])
      assert.strictEqual(response.text, "Sync works again on iOS 18.")
      // Workers AI's own answer states no finish reason.
      assert.strictEqual(response.finishReason, "unknown")
      assert.strictEqual(response.usage.inputTokens.total, 48)
      assert.strictEqual(response.usage.outputTokens.total, 9)
    }),
  )

  it.effect("reads a chat completion, as Kimi, Qwen 3 and gpt-oss answer, with its finish reason", () =>
    Effect.gen(function* () {
      const fake = fakeBinding([
        {
          answer: {
            id: "chatcmpl-5f1c",
            object: "chat.completion",
            created: 1792652400,
            model: "@cf/moonshotai/kimi-k2.6",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Sync works again", reasoning_content: "Short is fine." },
                finish_reason: "length",
              },
            ],
            usage: { prompt_tokens: 31, completion_tokens: 4, total_tokens: 35 },
          },
        },
      ])
      const response = yield* withWorkersAi(fake, LanguageModel.generateText({ prompt: "What changed in 2.4.0?" }))

      assert.strictEqual(response.text, "Sync works again")
      assert.strictEqual(response.finishReason, "length")
      assert.strictEqual(response.usage.inputTokens.total, 31)
      assert.strictEqual(response.usage.outputTokens.total, 4)
    }),
  )

  it.effect("asks for structured output in JSON mode, and decodes the object Workers AI answers", () =>
    Effect.gen(function* () {
      const Summary = Schema.Struct({ headline: Schema.String, highlights: Schema.Array(Schema.String) })
      const fake = fakeBinding([
        { answer: { response: { headline: "Sync is back", highlights: ["Sync works on iOS 18"] } } },
      ])
      const response = yield* withWorkersAi(
        fake,
        LanguageModel.generateObject({ prompt: "Summarize 2.4.0.", schema: Summary, objectName: "summary" }),
      )

      assert.deepStrictEqual(response.value, { headline: "Sync is back", highlights: ["Sync works on iOS 18"] })
      assert.deepStrictEqual(fake.asked[0]?.inputs["response_format"], {
        type: "json_schema",
        json_schema: {
          title: "summary",
          type: "object",
          properties: {
            headline: { type: "string" },
            highlights: { type: "array", items: { type: "string" } },
          },
          required: ["headline", "highlights"],
          additionalProperties: true,
        },
      })
    }),
  )

  it.effect("streams Workers AI's own events as text deltas, then the finish with its tokens", () =>
    Effect.gen(function* () {
      const fake = fakeBinding([
        {
          answer: eventStream([
            'data: {"response":"Sync ","p":"abcdef"}\n\n',
            'data: {"response":"works"}\n\ndata: {"resp',
            'onse":" again."}\n\n',
            'data: {"response":"","usage":{"prompt_tokens":31,"completion_tokens":4,"total_tokens":35}}\n\n',
            "data: [DONE]\n\n",
          ]),
        },
      ])
      const parts = yield* withWorkersAi(
        fake,
        LanguageModel.streamText({ prompt: "What changed in 2.4.0?" }).pipe(Stream.runCollect),
      )

      assert.strictEqual(fake.asked[0]?.inputs["stream"], true)
      assert.deepStrictEqual(deltasOf(parts), ["Sync ", "works", " again."])
      assert.deepStrictEqual(
        parts.map((part) => part.type),
        ["text-start", "text-delta", "text-delta", "text-delta", "text-end", "finish"],
      )
      const finish = finishOf(parts)
      assert.strictEqual(finish?.reason, "unknown")
      assert.strictEqual(finish?.usage.inputTokens.total, 31)
      assert.strictEqual(finish?.usage.outputTokens.total, 4)
    }),
  )

  it.effect("streams chat completion chunks, with the reason the model stated", () =>
    Effect.gen(function* () {
      const fake = fakeBinding([
        {
          answer: eventStream([
            'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":"Notes"}}]}\r\n\r\n',
            'data: {"choices":[{"index":0,"delta":{"content":" ready"},"finish_reason":"stop"}]}\r\n\r\n',
            'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":2,"total_tokens":14}}\r\n\r\n',
            "data: [DONE]\r\n\r\n",
          ]),
        },
      ])
      const parts = yield* withWorkersAi(fake, LanguageModel.streamText({ prompt: "Ready?" }).pipe(Stream.runCollect))

      assert.deepStrictEqual(deltasOf(parts), ["Notes", " ready"])
      const finish = finishOf(parts)
      assert.strictEqual(finish?.reason, "stop")
      assert.strictEqual(finish?.usage.outputTokens.total, 2)
    }),
  )

  it.effect("finishes a stream cut off before its end with error", () =>
    Effect.gen(function* () {
      const fake = fakeBinding([{ answer: eventStream(['data: {"response":"Sync wor"}\n\n']) }])
      const parts = yield* withWorkersAi(
        fake,
        LanguageModel.streamText({ prompt: "What changed?" }).pipe(Stream.runCollect),
      )

      assert.deepStrictEqual(deltasOf(parts), ["Sync wor"])
      assert.strictEqual(finishOf(parts)?.reason, "error")
    }),
  )

  it.effect("streams an answer Workers AI gave whole as one delta, its uncounted tokens unknown", () =>
    Effect.gen(function* () {
      const fake = fakeBinding([{ answer: { response: "Sync works again." } }])
      const parts = yield* withWorkersAi(
        fake,
        LanguageModel.streamText({ prompt: "What changed?" }).pipe(Stream.runCollect),
      )

      assert.deepStrictEqual(deltasOf(parts), ["Sync works again."])
      const finish = finishOf(parts)
      assert.strictEqual(finish?.usage.inputTokens.total, undefined)
      assert.strictEqual(finish?.usage.outputTokens.total, undefined)
    }),
  )

  it.effect("fails with the AiError reason that matches what the binding threw", () =>
    Effect.gen(function* () {
      const fake = fakeBinding([
        {
          failure: {
            name: "InferenceUpstreamError",
            message: "InferenceUpstreamError: 3040: Capacity temporarily exceeded, please try again.",
          },
        },
        { failure: { name: "InferenceUpstreamError", message: "5007: No such model @cf/meta/llama-9 or task" } },
        { failure: { name: "InferenceUpstreamError", message: "Something unexpected happened" } },
      ])
      const failures = yield* withWorkersAi(
        fake,
        Effect.forEach([1, 2, 3], () => LanguageModel.generateText({ prompt: "Hi" }).pipe(Effect.flip)),
      )

      assert.strictEqual(failures[0]?.module, "WorkersAi")
      assert.strictEqual(failures[0]?.method, "generateText")
      assert.strictEqual(failures[0]?.reason._tag, "RateLimitError")
      assert.isTrue(failures[0]?.isRetryable)

      const noSuchModel = failures[1]?.reason
      assert.strictEqual(noSuchModel?._tag, "InvalidRequestError")
      assert.strictEqual(noSuchModel?._tag === "InvalidRequestError" ? noSuchModel.parameter : undefined, "model")
      assert.isFalse(failures[1]?.isRetryable)

      const unknown = failures[2]?.reason
      assert.strictEqual(unknown?._tag, "UnknownError")
      assert.strictEqual(
        unknown?._tag === "UnknownError" ? unknown.description : undefined,
        "Something unexpected happened",
      )
    }),
  )

  it.effect("refuses tools, tool calls in the prompt, and files, without running the model", () =>
    Effect.gen(function* () {
      const GetWeather = Tool.make("GetWeather", {
        parameters: Schema.Struct({ city: Schema.String }),
        success: Schema.String,
      })
      const Weather = Toolkit.make(GetWeather)
      const fake = fakeBinding([])

      const withTools = yield* withWorkersAi(
        fake,
        LanguageModel.generateText({ prompt: "Weather in Lisbon?", toolkit: Weather }).pipe(
          Effect.flip,
          Effect.provide(Weather.toLayer({ GetWeather: () => Effect.succeed("Sunny") })),
        ),
      )
      const reason = withTools.reason
      assert.strictEqual(reason._tag, "InvalidRequestError")
      assert.match(reason.message, /tool calls aren't supported/)

      const toolCallsInPrompt = yield* withWorkersAi(
        fake,
        LanguageModel.generateText({
          prompt: [
            { role: "user", content: "Weather in Lisbon?" },
            {
              role: "tool",
              content: [{ type: "tool-result", id: "call-1", name: "GetWeather", isFailure: false, result: "Sunny" }],
            },
          ],
        }).pipe(Effect.flip),
      )
      assert.strictEqual(toolCallsInPrompt.reason._tag, "InvalidUserInputError")

      const file = yield* withWorkersAi(
        fake,
        LanguageModel.generateText({
          prompt: [
            {
              role: "user",
              content: [{ type: "file", mediaType: "image/png", data: "iVBORw0KGgo=" }],
            },
          ],
        }).pipe(Effect.flip),
      )
      assert.strictEqual(file.reason._tag, "InvalidUserInputError")
      assert.match(file.reason.message, /image\/png/)

      assert.deepStrictEqual(fake.asked, [])
    }),
  )

  it.effect("aborts the run when it is interrupted", () =>
    Effect.gen(function* () {
      const signals: Array<unknown> = []
      const binding: WorkersAiBinding = {
        run: (_model, _inputs, options) => {
          signals.push(options?.signal)
          // A run that never answers.
          return Promise.race([])
        },
      }
      const fiber = yield* Effect.forkChild(
        LanguageModel.generateText({ prompt: "Hi" }).pipe(Effect.provide(WorkersAi.layer({ binding, model }))),
      )
      while (signals.length === 0) {
        yield* Effect.yieldNow
      }
      yield* Fiber.interrupt(fiber)

      const signal = signals[0]
      assert.isTrue(Predicate.hasProperty(signal, "aborted") && signal.aborted === true)
    }),
  )
})

describe("WorkersAiModel", () => {
  it.effect("is a catalog ID: @cf/ or @hf/, an author and a name", () =>
    Effect.gen(function* () {
      const scout = yield* Schema.decodeEffect(WorkersAiModel)("@cf/meta/llama-4-scout-17b-16e-instruct").pipe(
        Effect.result,
      )
      const bare = yield* Schema.decodeEffect(WorkersAiModel)("llama-4-scout-17b-16e-instruct").pipe(Effect.result)

      assert.isTrue(Result.isSuccess(scout))
      assert.isTrue(Result.isFailure(bare))
    }),
  )
})
