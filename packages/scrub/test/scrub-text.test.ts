import { assert, describe, it } from "@effect/vitest"

import { isSecretName, scrubText } from "../src/index.ts"

describe("scrubText", () => {
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ["an email", "Invite sent to anna.k+notes@example.co.uk", "Invite sent to [email]"],
    ["a bearer token", "Authorization: Bearer abcDEF123456789.xyz failed", "Authorization: Bearer [token] failed"],
    ["a JWT", "Token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlMTIz expired", "Token [token] expired"],
    ["a Stripe key", "Using sk_live_51Habcdefghijklmnop", "Using [token]"],
    ["an OpenAI key", "key=sk-proj-abcdefghijklmnopqrstuvwxyz123", "key=[token]"],
    [
      "a secret in a URL",
      "GET /callback?code=4/0AY0e&state=x and ?token=abc123",
      "GET /callback?code=[secret]&state=x and ?token=[secret]",
    ],
    ["a card number", "Charged 4242 4242 4242 4242 for order 1234567890", "Charged [card] for order 1234567890"],
    ["a Cluenori ingest key", `cluenori.notes.notes-api.${"a".repeat(43)}`, "[token]"],
  ]
  for (const [what, input, expected] of cases) {
    it(`removes ${what}`, () => {
      assert.strictEqual(scrubText(input), expected)
    })
  }

  it("leaves ordinary messages as they are", () => {
    const messages = [
      "Export exp-3760 started with 3 notes",
      "Executed DbCommand (12ms) SELECT n.id FROM notes AS n WHERE n.id = @p0",
      "Request finished HTTP/1.1 GET /api/notes/42 - 200 in 12.4ms",
      "Order 4111111111111112 not found",
      "ParentId 0000000000000000 and 2222222222222222",
      "Build 1234567812345670",
    ]
    for (const message of messages) {
      assert.strictEqual(scrubText(message), message)
    }
  })
})

describe("isSecretName", () => {
  it("knows names whose values are credentials", () => {
    for (const name of [
      "http.request.header.authorization",
      "Cookie",
      "password",
      "client_secret",
      "api_key",
      "x-api-key",
      "refresh_token",
    ]) {
      assert.isTrue(isSecretName(name), name)
    }
    for (const name of ["http.route", "user_agent.original", "tokens_used", "keyword", "exception.message"]) {
      assert.isFalse(isSecretName(name), name)
    }
  })
})
