import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"
import { page } from "vitest/browser"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi } from "./fake-api.ts"
import { notesApi } from "./notes-project.ts"

describe("performance journey", () => {
  it.effect("leads from the operations that take the most time to one operation's latency", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/notes/performance")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("Runs of every component")).toBeVisible())
      // The operation that got slower comes first, marked.
      yield* Effect.promise(() => expect.element(screen.getByText("slower").first()).toBeVisible())
      yield* expectAccessible()
      yield* Effect.promise(() => screen.getByRole("link", { name: "All operations" }).click())

      // Every operation, searchable: one search finds the export.
      yield* Effect.promise(() => screen.getByPlaceholder("Search operations, such as /api/notes").fill("export"))
      yield* expectAccessible()
      yield* Effect.promise(() => screen.getByText("/api/export", { exact: true }).click())

      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: /\/api\/export$/ })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("p95 of each step's runs")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(screen.getByText(/over the last day, 4 s over the 7 days before/)).toBeVisible(),
      )
      yield* expectAccessible()

      // Its slowest runs, and the one that failed, each a click from its trace.
      const slowest = screen.getByRole("region", { name: "Slowest runs" })
      yield* Effect.promise(() => expect.element(slowest.getByRole("link")).toHaveLength(2))
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "Failed runs" }).getByText("500")).toBeVisible(),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => slowest.getByRole("link").first().click())
      yield* Effect.promise(() => expect.element(screen.getByText("INSERT exports")).toBeVisible())
    }),
  )

  it.effect("says over which days it keeps runs when the period is longer", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/notes/operations/GET%20/api/notes")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => screen.getByRole("button", { name: "30d" }).click())
      yield* Effect.promise(() => expect.element(screen.getByText("Slowest first, last 14 days")).toBeVisible())
      yield* Effect.promise(() =>
        expect
          .element(
            screen.getByText("No run of the last 14 days is kept. Of each hour, the five slowest are kept 14 days."),
          )
          .toBeVisible(),
      )
    }),
  )

  it.effect("says when an operation got slower than usual, and what usual is", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", `/notes/operations/${encodeURIComponent("GET /api/feed")}?component=notes-api`)
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("Slower than usual:")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(screen.getByText(/p95 620 ms over the last day, 300 ms over the 7 days before/)).toBeVisible(),
      )
      yield* expectAccessible()
    }),
  )

  it.effect("fits a phone: the errors with nothing wider than the screen", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      yield* Effect.promise(() => page.viewport(390, 844))
      window.history.pushState(null, "", "/notes/errors")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("Errors over time")).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText("NpgsqlException")).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* expectAccessible()
      yield* Effect.promise(() => page.viewport(1280, 900))
    }),
  )
})
