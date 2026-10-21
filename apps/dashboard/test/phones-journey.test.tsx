import { AppVersion, ModelIdentifier, Pairing, Phone, PhoneId, PhoneList, SystemVersion } from "@cluenori/phones"
import { assert, describe, expect, it } from "@effect/vitest"
import { Clock, DateTime, Effect } from "effect"
import { render } from "vitest-browser-react"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import type { AnswerApi } from "./fake-api.ts"
import { answerApi, apiCalls, reply } from "./fake-api.ts"
import { notesApi } from "./notes-project.ts"

const minute = 60_000

const phoneOf = (id: string, model: string, modelName: string, pairedAt: number, address?: string) =>
  new Phone({
    id: PhoneId.make(id),
    model: ModelIdentifier.make(model),
    modelName,
    systemVersion: SystemVersion.make("27.1"),
    appVersion: AppVersion.make("1.0 (12)"),
    pairedAt: DateTime.makeUnsafe(pairedAt),
    ...(address === undefined ? {} : { lastSeen: { at: DateTime.makeUnsafe(pairedAt), address, country: "PL" } }),
  })

// The deployment's phones: one paired a day ago; adding one pairs the iPhone the code is scanned
// with on the next look, as a phone does a few seconds after the code shows.
const phonesApi = (now: number): AnswerApi => {
  const notes = notesApi()
  let phones: ReadonlyArray<Phone> = [
    phoneOf(
      "019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f53",
      "iPhone19,3",
      "iPhone 18 Pro Max",
      now - 1440 * minute,
      "203.0.113.7",
    ),
  ]
  let codeShown = false
  let scanned = false
  return (call) => {
    const [first, second] = call.path
    if (first !== "phones") {
      return notes(call)
    }
    if (call.method === "POST" && second === "pairings") {
      codeShown = true
      return reply(
        Pairing,
        {
          link: "cluenori://pair?url=https%3A%2F%2Fcluenori.example&code=Zk3Pq9TzX2mV8wYb4LdR7nHs1cFgJ0uE_abcdefghij",
          expiresAt: DateTime.makeUnsafe(now + 10 * minute),
        },
        201,
      )
    }
    if (call.method === "DELETE" && second !== undefined) {
      phones = phones.filter((phone) => phone.id !== second)
      return Effect.succeed({ status: 204 })
    }
    if (codeShown && !scanned) {
      scanned = true
      phones = [phoneOf("019a0f3b-1a2b-7c3d-8e4f-5a6b7c8d9e0f", "iPhone18,1", "iPhone 17 Pro", now), ...phones]
    }
    return reply(PhoneList, { phones })
  }
}

describe("phones journey", () => {
  // Live: the code counts down by the browser's own clock.
  it.live("adds a phone by its code, sees it pair, and removes the old one", () =>
    Effect.gen(function* () {
      answerApi(phonesApi(yield* Clock.currentTimeMillis))
      window.history.pushState(null, "", "/phones")
      const screen = yield* Effect.promise(() => render(<App />))

      // The phone paired yesterday, and where it last called from.
      yield* Effect.promise(() => expect.element(screen.getByText("iPhone 18 Pro Max")).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText(/^203\.0\.113\.7, /)).toBeVisible())
      yield* expectAccessible()

      // Adding one shows the code, and how long it works.
      yield* Effect.promise(() => screen.getByRole("button", { name: "Add a phone" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("img", { name: "The pairing code, for the iPhone's Camera" })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText(/works for/)).toBeVisible())
      yield* expectAccessible()

      // The iPhone scans it; the page says which paired, without being asked.
      yield* Effect.promise(() =>
        expect
          .element(screen.getByText("Paired your iPhone 17 Pro. It shows your projects now."), { timeout: 5_000 })
          .toBeVisible(),
      )

      // The old phone goes, after a confirmation.
      yield* Effect.promise(() =>
        screen
          .getByRole("row", { name: /iPhone 18 Pro Max/ })
          .getByRole("button")
          .click(),
      )
      yield* Effect.promise(() => screen.getByRole("button", { name: "Remove the phone" }).click())
      yield* Effect.promise(() => expect.element(screen.getByText("iPhone 18 Pro Max")).not.toBeInTheDocument())
      assert.isTrue(
        apiCalls().some(
          (call) => call.method === "DELETE" && call.path.join("/") === "phones/019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f53",
        ),
      )
    }),
  )
})
