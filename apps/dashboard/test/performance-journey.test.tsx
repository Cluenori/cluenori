import { assert, describe, expect, it } from "@effect/vitest"
import { Clock, DateTime, Effect } from "effect"
import { render } from "vitest-browser-react"
import { page, userEvent } from "vitest/browser"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi } from "./fake-api.ts"
import { exportTrace, notesApi } from "./notes-project.ts"

describe("performance journey", () => {
  it.effect("leads from every operation to one and its requests, and to one request's trace", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/performance")
      const screen = yield* Effect.promise(() => render(<App />))

      // The answer first: what ran, what failed, and what got slower.
      yield* Effect.promise(() =>
        expect.element(screen.getByText(/requests in the last 24 hours, across 3 operations/)).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect.element(screen.getByText(/GET \/api\/feed got slower: p95 620 ms/)).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("Load on every component")).toBeVisible())
      // The operation that got slower comes first, marked.
      yield* Effect.promise(() => expect.element(screen.getByText("slower").first()).toBeVisible())
      yield* expectAccessible()

      // Every operation is on this page, searchable: one search finds the export.
      yield* Effect.promise(() => screen.getByPlaceholder("Search operations, such as /api/notes").fill("export"))
      yield* expectAccessible()
      yield* Effect.promise(() => screen.getByText("/api/export", { exact: true }).click())

      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: /\/api\/export$/ })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText(/1.200 requests in the last 24 hours/)).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText("p95 of each step")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(screen.getByText(/over the last day, 4 s over the 7 days before/)).toBeVisible(),
      )
      yield* expectAccessible()

      // Its slowest requests, and the one that failed, each one click from its trace.
      const slowest = screen.getByRole("region", { name: "Slowest requests" })
      yield* Effect.promise(() => expect.element(slowest.getByRole("link")).toHaveLength(2))
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "Failed requests" }).getByText("500")).toBeVisible(),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => slowest.getByRole("link").first().click())

      // The request: what it was and how it ended, its waterfall, and a brief for an agent.
      yield* Effect.promise(() => expect.element(screen.getByText("INSERT exports")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: /\/api\/export/ })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText(/answered/)).toBeVisible())
      assert.notInclude(window.location.search, "from=")
      // What it copies, kept here rather than in the clipboard, which a test may not read.
      let brief = ""
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (text: string) => {
            brief = text
            return Promise.resolve()
          },
        },
      })
      yield* Effect.promise(() => screen.getByRole("button", { name: "Copy for an agent" }).click())
      yield* Effect.promise(() => expect.element(screen.getByRole("button", { name: "Copied" })).toBeVisible())
      assert.include(brief, `Trace ${exportTrace}: POST /api/export in notes-api`)
      assert.include(brief, "answered 500, failed")
      assert.include(brief, `GET /api/projects/notes/traces/${exportTrace}?around=`)
      assert.include(brief, `./cluenori operation notes 'POST /api/export' --component notes-api`)
      yield* expectAccessible()
    }),
  )

  it.effect("opens a moment from the chart, marked within the rest, with the requests kept from it", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/performance")
      const screen = yield* Effect.promise(() => render(<App />))

      const chart = screen.getByRole("slider", { name: /The load on every component/ })
      yield* Effect.promise(() => expect.element(chart).toBeVisible())
      // The latest column, from the keyboard: End, then Enter.
      chart.element().focus()
      yield* Effect.promise(() => userEvent.keyboard("{End}{Enter}"))
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("region", { name: /–/ }).getByText("The moment opened, marked on the charts"))
          .toBeVisible(),
      )
      assert.include(window.location.search, "at=")
      // The chart still shows the whole period, the moment marked on it.
      assert.isNotNull(document.querySelector("[data-marked]"))
      yield* expectAccessible()
      yield* Effect.promise(() => screen.getByRole("button", { name: "Close" }).click())
      assert.notInclude(window.location.search, "at=")
    }),
  )

  it.live("shows the requests of a moment 40 minutes ago, the failed export among them", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      const now = yield* Clock.currentTimeMillis
      const at = DateTime.formatIso(DateTime.makeUnsafe(now - 40 * 60_000))
      window.history.pushState(null, "", `/projects/notes/performance?at=${encodeURIComponent(at)}`)
      const screen = yield* Effect.promise(() => render(<App />))

      const opened = screen.getByRole("region", { name: /–/ })
      yield* Effect.promise(() =>
        expect
          .element(opened.getByRole("link"))
          .toHaveAttribute("href", expect.stringContaining(`/traces/${exportTrace}`)),
      )
      yield* Effect.promise(() => expect.element(opened.getByText("500")).toBeVisible())
      // An operation opened from here opens the same moment.
      yield* Effect.promise(() => screen.getByText("/api/export", { exact: true }).last().click())
      assert.include(window.location.search, `at=${encodeURIComponent(at)}`)
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: /–/ }).getByText("500")).toBeVisible(),
      )
      yield* expectAccessible()
    }),
  )

  it.effect("says a moment after the latest count is not known yet, with no period to show it", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/performance?at=2099-01-01T00%3A00%3A00.000Z")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText(/after the latest count/)).toBeVisible())
      assert.strictEqual(screen.getByRole("button", { name: /^Show the / }).elements().length, 0)
    }),
  )

  it.effect(
    "says an operation none of whose requests are in the period, when it last ran, and shows it in one click",
    () =>
      Effect.gen(function* () {
        answerApi(notesApi())
        window.history.pushState(null, "", `/projects/notes/operations/${encodeURIComponent("POST /api/import")}`)
        const screen = yield* Effect.promise(() => render(<App />))

        yield* Effect.promise(() =>
          expect.element(screen.getByText(/None in the last 24 hours\. Last ran/)).toBeVisible(),
        )
        yield* expectAccessible()
        yield* Effect.promise(() => screen.getByRole("button", { name: "Show the last 7 days" }).click())
        yield* Effect.promise(() => expect.element(screen.getByText(/140 requests in the last 7 days/)).toBeVisible())
      }),
  )

  it.effect("says over which days it keeps requests when the period is longer", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/operations/GET%20/api/notes")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => screen.getByRole("button", { name: "30d" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByText("Slowest first, last 14 days. Each opens its trace")).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect
          .element(
            screen.getByText(
              "No request of the last 14 days is kept. Of each hour, the five slowest are kept 14 days.",
            ),
          )
          .toBeVisible(),
      )
    }),
  )

  it.effect("says when an operation got slower than usual, and what usual is", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(
        null,
        "",
        `/projects/notes/operations/${encodeURIComponent("GET /api/feed")}?component=notes-api`,
      )
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
      window.history.pushState(null, "", "/projects/notes/errors")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("Errors over time")).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText("NpgsqlException")).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* expectAccessible()
      yield* Effect.promise(() => page.viewport(1280, 900))
    }),
  )
})
