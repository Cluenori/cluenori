import { assert, layer } from "@effect/vitest"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

import { apiToken, baseUrl, WorkerHttpClient } from "./cluenori-client.ts"

// A browser's requests, made by hand: the journey reads the cookie's attributes, which a browser
// keeps to itself.
const post = Effect.fn("post")(function* (path: string, body?: unknown) {
  const http = yield* HttpClient.HttpClient
  const request = HttpClientRequest.post(`${baseUrl}${path}`)
  const response = yield* http.execute(
    body === undefined ? request : yield* HttpClientRequest.bodyJson(request, body).pipe(Effect.orDie),
  )
  return { status: response.status, cookie: response.headers["set-cookie"] }
})

const listProjects = Effect.fn("listProjects")(function* (cookie?: string) {
  const http = yield* HttpClient.HttpClient
  const request = HttpClientRequest.get(`${baseUrl}/api/projects`)
  const response = yield* http.execute(
    cookie === undefined ? request : HttpClientRequest.setHeader(request, "cookie", cookie),
  )
  return response.status
})

layer(WorkerHttpClient, { excludeTestServices: true })("sign-in", (it) => {
  it.effect("a browser signs in with the API token, uses the API with its cookie, and signs out", () =>
    Effect.gen(function* () {
      assert.strictEqual(yield* listProjects(), 401)

      const signedIn = yield* post("/api/sign-in", { token: apiToken })
      assert.strictEqual(signedIn.status, 204)
      assert.strictEqual(
        signedIn.cookie,
        `cluenori_sign_in=${apiToken}; Max-Age=2592000; Path=/api; HttpOnly; Secure; SameSite=Strict`,
      )
      assert.strictEqual(yield* listProjects(`cluenori_sign_in=${apiToken}`), 200)

      const signedOut = yield* post("/api/sign-out")
      assert.strictEqual(signedOut.status, 204)
      assert.strictEqual(signedOut.cookie, "cluenori_sign_in=; Max-Age=0; Path=/api; HttpOnly; Secure; SameSite=Strict")
    }),
  )

  it.effect("a wrong token signs nobody in, and a wrong cookie opens nothing", () =>
    Effect.gen(function* () {
      const refused = yield* post("/api/sign-in", { token: "not-the-token" })
      assert.deepStrictEqual(refused, { status: 401, cookie: undefined })
      assert.strictEqual(yield* listProjects("cluenori_sign_in=not-the-token"), 401)
    }),
  )
})
