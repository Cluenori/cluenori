import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"
import { userEvent } from "vitest/browser"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi, apiCalls } from "./fake-api.ts"
import { exportTrace, notesApi } from "./notes-project.ts"

describe("errors journey", () => {
  it.effect("leads from Now's line for Errors to the error happening now, its stack, and its trace", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/")
      const screen = yield* Effect.promise(() => render(<App />))

      // Now's line for Errors says one is happening now; Notes's page names it, one click from its page.
      const projects = screen.getByRole("region", { name: "Projects" })
      yield* Effect.promise(() =>
        expect.element(projects.getByRole("link", { name: /^Errors.*1 happening now · 1 new/ })).toBeVisible(),
      )
      yield* Effect.promise(() => projects.getByRole("link", { name: /^Notes/ }).click())
      const happening = screen
        .getByRole("region", { name: "Products" })
        .getByRole("link", { name: /^Happening now · NpgsqlException/ })
      yield* Effect.promise(() => expect.element(happening).toBeVisible())
      yield* expectAccessible()
      yield* Effect.promise(() => happening.click())

      // The error's page is a list: its occurrences over the period, each opening its own page.
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "NpgsqlException" })).toBeVisible(),
      )
      const occurrences = screen.getByRole("list").filter({ hasText: "Export 51c2 failed after 3 attempts" })
      yield* Effect.promise(() => expect.element(occurrences).toBeVisible())
      yield* expectAccessible()
      yield* Effect.promise(() => occurrences.getByRole("link").first().click())

      // One occurrence, by its ID, with no period to change: what it said, every frame, the library
      // ones folded, and the operation it happened in.
      yield* Effect.promise(() => expect.element(screen.getByRole("link", { name: "Every occurrence" })).toBeVisible())
      assert.match(window.location.pathname, /^\/projects\/notes\/errors\/4f1c9a2e7b3d5068\/3$/)
      yield* Effect.promise(() => expect.element(screen.getByRole("group", { name: "Period" })).not.toBeInTheDocument())
      yield* Effect.promise(() =>
        expect.element(screen.getByText("Notes.Api.Exports.ExportStore.SaveAsync(Export export)")).toBeVisible(),
      )
      yield* Effect.promise(() => screen.getByRole("button", { name: "Show 2 frames in libraries" }).click())
      yield* Effect.promise(() =>
        expect
          .element(screen.getByText("Npgsql.Internal.NpgsqlConnector.Connect(NpgsqlTimeout timeout)"))
          .toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("Notes.Api.Exports.ExportEndpoint")).toBeVisible())
      yield* expectAccessible()

      // An occurrence opens its trace, read from the archive around when it happened.
      yield* Effect.promise(() => screen.getByRole("link", { name: "Open the trace" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: /POST \/api\/export/ })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("INSERT exports")).toBeVisible())
      yield* expectAccessible()
    }),
  )

  it.effect("refuses an address that names one error and a line of another", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      // Line 1 is the timeout's, not the database error's.
      window.history.pushState(null, "", "/projects/notes/errors/4f1c9a2e7b3d5068/1")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByRole("alert")).toBeVisible())
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("link", { name: "Open it under its own error" }))
          .toHaveAttribute("href", "/projects/notes/errors/a90e3b7c14d2f685/1"),
      )
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("button", { name: "Copy for an agent" })).not.toBeInTheDocument(),
      )
    }),
  )

  it.effect("opens a trace from an address with only its ID, as one pasted from elsewhere", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", `/projects/notes/traces/${exportTrace}`)
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: /POST \/api\/export/ })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("INSERT exports")).toBeVisible())
      const asked = apiCalls().filter((call) => call.path[2] === "traces")
      assert.deepStrictEqual(
        asked.map((call) => [call.path[3], call.query.has("around")]),
        [[exportTrace, false]],
      )
    }),
  )

  it.effect("finds a log message by what its lines say, and leads from it to one line, with no period", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/logs")
      const screen = yield* Effect.promise(() => render(<App />))

      // The list is of messages, named by their templates, the most lines first.
      const retrying = screen.getByRole("button", { name: /Retrying the export, attempt/ })
      yield* Effect.promise(() => expect.element(retrying).toBeVisible())
      yield* expectAccessible()
      const search = screen.getByPlaceholder("Search what the lines say, then press Enter")
      yield* Effect.promise(() => search.fill("longer"))
      yield* Effect.promise(() => expect.element(retrying).toBeVisible())
      yield* Effect.promise(() => userEvent.keyboard("{Enter}"))
      yield* Effect.promise(() => expect.element(retrying).not.toBeInTheDocument())
      const longer = screen.getByRole("button", { name: /The export took longer than/ })
      yield* Effect.promise(() => expect.element(longer).toBeVisible())

      // A message opens in place to its latest lines, and on to its own page.
      yield* Effect.promise(() => longer.click())
      yield* Effect.promise(() => screen.getByRole("link", { name: "All 7 lines" }).click())
      assert.match(window.location.pathname, /^\/projects\/notes\/logs\/messages\/3$/)
      yield* Effect.promise(() => expect.element(screen.getByText("7 in the last 24 hours")).toBeVisible())
      // Its lines are occurrences of an error, which it names.
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "Errors" }).getByText(/TimeoutException/)).toBeVisible(),
      )
      yield* expectAccessible()

      // A line is an item: its own address, no period, a brief for an agent.
      yield* Effect.promise(() =>
        screen
          .getByRole("region", { name: "Latest lines" })
          .getByRole("link", { name: /The export took longer than 30 seconds/ })
          .click(),
      )
      assert.match(window.location.pathname, /^\/projects\/notes\/logs\/lines\/1$/)
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Error" })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByRole("group", { name: "Period" })).not.toBeInTheDocument())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("button", { name: "Copy for an agent" })).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("link", { name: "Every line of its message" }))
          .toHaveAttribute("href", "/projects/notes/logs/messages/3"),
      )
      yield* expectAccessible()
    }),
  )

  it.effect("says when a message was last seen when the period holds none of its lines", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/logs/messages/2?environment=staging")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() =>
        expect.element(screen.getByText(/^None in the last 24 hours\. Last seen/)).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByRole("button", { name: /^Show the last/ })).toBeVisible())
      yield* expectAccessible()
    }),
  )

  // Live time: the registry keeps an answer no page shows for 400 ms of its own; this waits past it.
  it.live("shows a page's answers at once on going back to it", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes")
      const screen = yield* Effect.promise(() => render(<App />))
      const ongoing = screen.getByRole("link", { name: /^Happening now.*NpgsqlException/ })
      yield* Effect.promise(() => expect.element(ongoing).toBeVisible())

      yield* Effect.promise(() => screen.getByRole("link", { name: "Tech", exact: true }).first().click())
      yield* Effect.promise(() => screen.getByRole("link", { name: "All logs" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("button", { name: /Retrying the export, attempt/ })).toBeVisible(),
      )
      yield* Effect.sleep("1 second")
      const before = apiCalls().length
      // Back to the project by the trail above the page.
      yield* Effect.promise(() =>
        screen.getByRole("navigation", { name: "Where you are" }).getByRole("link", { name: "Notes" }).click(),
      )
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
