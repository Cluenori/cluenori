import { Effect, Schema } from "effect"

/** A call the dashboard made to the public API: its method, its path under `/api`, its query, its body. */
export type ApiCall = {
  readonly method: string
  readonly path: ReadonlyArray<string>
  readonly query: URLSearchParams
  readonly body: string | undefined
}

/** An answer to a call: a status, and a body already encoded as the API's schemas encode it. */
export type ApiReply = { readonly status: number; readonly body?: unknown }

/** The answer a schema encodes: a fixture that has drifted from the contract fails to encode here. */
export const reply = <T>(schema: Schema.Codec<T, unknown>, value: T, status = 200) =>
  Schema.encodeEffect(schema)(value).pipe(
    Effect.orDie,
    Effect.map((body): ApiReply => ({ status, body })),
  )

/** How a fake API answers a call. A defect, such as a call it has no answer for, fails the call. */
export type AnswerApi = (call: ApiCall) => Effect.Effect<ApiReply>

let answer: AnswerApi | undefined
const asked: Array<ApiCall> = []

/** How the public API answers the dashboard in this test; each test starts with no answers. */
export const answerApi = (next: AnswerApi | undefined) => {
  answer = next
  asked.length = 0
}

/** The calls the dashboard has made since `answerApi`, oldest first. */
export const apiCalls = (): ReadonlyArray<ApiCall> => [...asked]

const JsonText = Schema.fromJsonString(Schema.Unknown)

/**
 * Answers the dashboard's calls to the API from `answerApi`. The API client reads `fetch` once, when
 * it first calls, so the tests' setup installs this once, before any test. Any other request, such
 * as Vite's, goes through.
 */
export const installFakeApi = () => {
  const original = window.fetch.bind(window)
  window.fetch = (input, init) => answered(original, input, init)
}

const answered = (original: typeof window.fetch, input: RequestInfo | URL, init: RequestInit | undefined) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
    return original(input, init)
  }
  return Effect.runPromise(
    Effect.gen(function* () {
      const text = yield* Effect.promise(() => request.text())
      const call = {
        method: request.method,
        path: url.pathname.slice("/api/".length).split("/").map(decodeURIComponent),
        query: url.searchParams,
        body: text === "" ? undefined : text,
      }
      asked.push(call)
      if (answer === undefined) {
        return yield* Effect.die(
          `The test answers no API calls, and the dashboard called ${call.method} ${url.pathname}.`,
        )
      }
      const { status, body } = yield* answer(call)
      if (body === undefined) {
        return new Response(null, { status })
      }
      const encoded = yield* Schema.encodeEffect(JsonText)(body).pipe(Effect.orDie)
      return new Response(encoded, { status, headers: { "content-type": "application/json" } })
    }),
  )
}
