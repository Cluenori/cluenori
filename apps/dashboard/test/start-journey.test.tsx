import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi } from "./fake-api.ts"
import { notesApi, notesToken } from "./notes-project.ts"

describe("start journey", () => {
  it.effect("signs in with the API token, after saying why a wrong one was refused", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ signedIn: false }))
      window.history.pushState(null, "", "/")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { name: "Sign in to Cluenori" })).toBeVisible(),
      )
      yield* expectAccessible()
      const token = screen.getByLabelText("API token")
      yield* Effect.promise(() => token.fill("not-the-token"))
      yield* Effect.promise(() => screen.getByRole("button", { name: "Sign in" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("alert")).toHaveTextContent("The API token is wrong."),
      )

      yield* Effect.promise(() => token.fill(notesToken))
      yield* Effect.promise(() => screen.getByRole("button", { name: "Sign in" }).click())
      // The start shows the first project.
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("Needs attention")).toBeVisible())
    }),
  )

  it.effect("says how to create the first project in a workspace that has none", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ workspace: [] }))
      window.history.pushState(null, "", "/")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("No projects yet")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(screen.getByText("./cluenori project create notes --name Notes")).toBeVisible(),
      )
      yield* expectAccessible()
    }),
  )

  it.effect("says so for an address no page has, and for a trace the archive doesn't keep", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/Notes!/errors")
      const screen = yield* Effect.promise(() => render(<App />))
      yield* Effect.promise(() => expect.element(screen.getByText("There is no page at this address")).toBeVisible())
      yield* expectAccessible()

      yield* Effect.promise(() => screen.unmount())
      window.history.pushState(null, "", "/notes/traces/0123456789abcdef0123456789abcdef")
      const again = yield* Effect.promise(() => render(<App />))
      yield* Effect.promise(() => expect.element(again.getByText("No steps of this trace")).toBeVisible())
      yield* expectAccessible()
    }),
  )

  it.effect("opens the design kit without signing in, with the views ahead of the API on sample data", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ signedIn: false }))
      window.history.pushState(null, "", "/kit")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 2, name: "Ahead of the API" })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("Before it, in the latest session")).toBeVisible())
    }),
  )
})
