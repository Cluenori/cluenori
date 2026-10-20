import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"
import { userEvent } from "vitest/browser"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi, apiCalls } from "./fake-api.ts"
import { notesApi } from "./notes-project.ts"

describe("errors journey", () => {
  it.effect("leads from the overview's ongoing error to its stack, and to its request's trace", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/notes")
      const screen = yield* Effect.promise(() => render(<App />))

      // The overview names the error that is happening now first, with one way in.
      yield* Effect.promise(() =>
        expect.element(screen.getByText("NpgsqlException is happening right now")).toBeVisible(),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => screen.getByRole("link", { name: "Open the error" }).first().click())

      // The error opens in place: the stack in the app's own code, and its latest occurrences.
      yield* Effect.promise(() =>
        expect.element(screen.getByText("Notes.Api.Exports.ExportStore.SaveAsync(Export export)")).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("and 2 frames in libraries")).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText("Latest occurrences")).toBeVisible())
      yield* expectAccessible()

      // An occurrence opens its request's trace, read from the archive around when it happened.
      yield* Effect.promise(() => screen.getByRole("link", { name: "Open the request" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: /POST \/api\/export/ })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("INSERT exports")).toBeVisible())
      yield* expectAccessible()
    }),
  )

  it.effect("finds a log line by what it says, and asks again only when the search is submitted", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/notes/logs")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("Retrying the export, attempt 2 of 3")).toBeVisible())
      const search = screen.getByPlaceholder("Search messages and exceptions, then press Enter")
      yield* Effect.promise(() => search.fill("longer"))
      yield* Effect.promise(() => expect.element(screen.getByText("Retrying the export, attempt 2 of 3")).toBeVisible())
      yield* Effect.promise(() => userEvent.keyboard("{Enter}"))
      yield* Effect.promise(() =>
        expect.element(screen.getByText("Retrying the export, attempt 2 of 3")).not.toBeInTheDocument(),
      )
      yield* Effect.promise(() =>
        expect.element(screen.getByText("The export took longer than 30 seconds")).toBeVisible(),
      )
      yield* expectAccessible()
    }),
  )

  // Live time: the registry keeps an answer no page shows for 400 ms of its own; this waits past it.
  it.live("shows a page's answers at once on going back to it", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/notes")
      const screen = yield* Effect.promise(() => render(<App />))
      const ongoing = screen.getByText("NpgsqlException is happening right now")
      yield* Effect.promise(() => expect.element(ongoing).toBeVisible())

      yield* Effect.promise(() => screen.getByRole("link", { name: "Logs" }).first().click())
      yield* Effect.promise(() => expect.element(screen.getByText("Retrying the export, attempt 2 of 3")).toBeVisible())
      yield* Effect.sleep("1 second")
      const before = apiCalls().length
      yield* Effect.promise(() => screen.getByRole("link", { name: "Overview" }).click())
      yield* Effect.promise(() => expect.element(ongoing).toBeVisible())
      // Kept from the first visit and still fresh, so nothing is asked again.
      assert.deepStrictEqual(
        apiCalls()
          .slice(before)
          .map((call) => call.path.join("/")),
        [],
      )
    }),
  )
})
