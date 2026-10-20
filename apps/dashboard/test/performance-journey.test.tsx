import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"
import { page } from "vitest/browser"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi } from "./fake-api.ts"
import { notesApi } from "./notes-project.ts"

describe("performance journey", () => {
  it.effect("leads from the endpoints that take the most time to one endpoint's latency", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/notes/performance")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("Requests to every component")).toBeVisible())
      // The endpoint that got slower comes first, marked.
      yield* Effect.promise(() => expect.element(screen.getByText("slower").first()).toBeVisible())
      yield* expectAccessible()
      yield* Effect.promise(() => screen.getByRole("link", { name: "All endpoints" }).click())

      // Every endpoint, searchable: one search finds the export.
      yield* Effect.promise(() => screen.getByPlaceholder("Search endpoints, such as /api/notes").fill("export"))
      yield* expectAccessible()
      yield* Effect.promise(() => screen.getByText("/api/export", { exact: true }).click())

      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: /\/api\/export$/ })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("p95 of each step's requests")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(screen.getByText(/over the last day, 4 s over the 7 days before/)).toBeVisible(),
      )
      yield* expectAccessible()
    }),
  )

  it.effect("says when an endpoint got slower than usual, and what usual is", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", `/notes/endpoints/${encodeURIComponent("GET /api/feed")}?component=notes-api`)
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
