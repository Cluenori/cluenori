import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"
import { page, userEvent } from "vitest/browser"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi, apiCalls } from "./fake-api.ts"
import { appRelease, appStorePromotions, notesApi } from "./notes-project.ts"

// What each link in a part of the page says: its label, else its text.
const lineTexts = (item: Element) =>
  [...item.querySelectorAll("a")].map((link) => link.getAttribute("aria-label") ?? link.textContent)

describe("now journey", () => {
  it.effect("leads from what needs the founder across projects, down a level at a time, and back", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ seeded: appStorePromotions }))
      window.history.pushState(null, "", "/")
      const screen = yield* Effect.promise(() => render(<App />))

      // Now answers first: which project needs the founder, and in which products.
      yield* Effect.promise(() => expect.element(screen.getByRole("heading", { level: 1, name: "Now" })).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(screen.getByText("Notes needs you: Uptime, Errors, Performance and Releases")).toBeVisible(),
      )
      // Each project, those that need the founder first: a line for each product with news, the most
      // urgent first, then the steady ones in one row.
      const projects = screen.getByRole("region", { name: "Projects" })
      const [notes, landing] = projects.getByRole("listitem").elements()
      assert.isDefined(notes)
      assert.isDefined(landing)
      const notesLines = lineTexts(notes)
      assert.deepStrictEqual(notesLines.slice(1, 5), [
        "UptimeFailing: POST /api/export",
        "Errors1 happening now · 1 new",
        "PerformanceGET /api/feed slower",
        `Releases${appRelease} passed App Store review`,
      ])
      assert.match(notesLines[0] ?? "", /^Notes4 need you/)
      assert.match(notesLines[5] ?? "", /^Analytics: Steady · 46 daily people, .*7 vs last week$/)
      assert.strictEqual(notesLines.length, 6)
      assert.deepStrictEqual(lineTexts(landing), [
        "LandingNothing needs you",
        "Uptime: No open incidents",
        "Errors: Nothing new",
      ])
      yield* expectAccessible()
      // All of Now is Today's one answer and the feeds: no question of any project's.
      assert.deepStrictEqual([...new Set(apiCalls().map((call) => call.path.join("/")))].toSorted(), [
        "feeds",
        "me",
        "projects",
        "today",
      ])

      // A project: what it comes to, then a row for each product, the most urgent first, the things
      // behind a line with several under it, and the products with nothing to say last.
      yield* Effect.promise(() => projects.getByRole("link", { name: /^Notes/ }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible(),
      )
      assert.strictEqual(window.location.pathname, "/projects/notes")
      yield* Effect.promise(() =>
        expect.element(screen.getByText("4 need you: Uptime, Errors, Performance and Releases")).toBeVisible(),
      )
      const productRows = screen.getByRole("region", { name: "Products" })
      const named = productRows
        .getByRole("listitem")
        .elements()
        .filter((item) => item.parentElement?.closest("li") === null)
        .map(
          (item) =>
            item.querySelector("a")?.textContent?.match(/^(Uptime|Errors|Performance|Releases|Analytics|Logs)/)?.[0],
        )
      assert.deepStrictEqual(named, ["Uptime", "Errors", "Performance", "Releases", "Analytics", "Logs"])
      const things = productRows.getByRole("list", { name: "What it is about" })
      yield* Effect.promise(() => expect.element(things.getByRole("link", { name: /NpgsqlException/ })).toBeVisible())
      yield* Effect.promise(() => expect.element(things.getByRole("link", { name: /TimeoutException/ })).toBeVisible())
      yield* Effect.promise(() =>
        expect
          .element(productRows.getByRole("link", { name: /^Performance/ }))
          .toMatchTextContent(/p95 620 ms over the last day, usually 300 ms/),
      )
      yield* Effect.promise(() =>
        expect
          .element(productRows.getByRole("link", { name: /^Logs/ }))
          .toMatchTextContent("Warnings and errors, to search"),
      )
      yield* expectAccessible()
      // Beside Today's answer, the page asks only what runs where, and which environments are production, for Releases.
      assert.deepStrictEqual(
        [...new Set(apiCalls().map((call) => call.path.join("/")))]
          .filter((path) => path.startsWith("projects/"))
          .toSorted(),
        ["projects/notes", "projects/notes/delivery"],
      )
      window.history.back()

      // A line about several things leads to its product, there: Errors, with both.
      yield* Effect.promise(() => projects.getByRole("link", { name: /^Errors.*happening now/ }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Errors" })).toBeVisible(),
      )
      assert.strictEqual(window.location.pathname, "/projects/notes/errors")
      yield* expectAccessible()

      // Tech: the top few of each, and a way to every one.
      yield* Effect.promise(() => screen.getByRole("link", { name: "Tech", exact: true }).first().click())
      yield* Effect.promise(() => expect.element(screen.getByRole("heading", { level: 1, name: "Tech" })).toBeVisible())
      const requests = screen.getByRole("region", { name: "Requests" })
      yield* Effect.promise(() =>
        expect.element(requests.getByText(/^Slower: p95 620 ms over the last day, usually 300 ms/)).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "Errors" }).getByText(/NpgsqlException/)).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("region", { name: "Logs" }).getByText("Warnings", { exact: true }).first())
          .toBeVisible(),
      )
      const incidents = screen.getByRole("region", { name: "Incidents" })
      yield* Effect.promise(() => expect.element(incidents.getByText(/^Failing: POST \/api\/export/)).toBeVisible())
      yield* expectAccessible()

      // Every incident, and the monitors the Down detector checks.
      yield* Effect.promise(() => incidents.getByRole("link", { name: "All incidents" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Incidents" })).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect
          .element(
            screen.getByRole("region", { name: "Resolved" }).getByText(/^Down: https:\/\/api\.notes\.example\/health/),
          )
          .toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "Monitors" }).getByText(/^Passed at/)).toBeVisible(),
      )
      yield* expectAccessible()

      // The browser's back steps back the way the founder came.
      window.history.back()
      yield* Effect.promise(() => expect.element(screen.getByRole("heading", { level: 1, name: "Tech" })).toBeVisible())
      window.history.back()
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Errors" })).toBeVisible(),
      )
    }),
  )

  it.effect("opens a product's line from the keyboard", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/")
      const screen = yield* Effect.promise(() => render(<App />))

      const slower = screen.getByRole("region", { name: "Projects" }).getByRole("link", { name: /^Performance/ })
      yield* Effect.promise(() => expect.element(slower).toBeVisible())
      slower.element().focus()
      yield* Effect.promise(() => userEvent.keyboard("{Enter}"))
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: /\/api\/feed/ })).toBeVisible(),
      )
      assert.strictEqual(window.location.pathname, "/projects/notes/operations/GET%20/api/feed")
    }),
  )

  it.effect("fits a phone: Now, a project and a product, nothing wider than the screen", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      yield* Effect.promise(() => page.viewport(390, 844))
      window.history.pushState(null, "", "/")
      const screen = yield* Effect.promise(() => render(<App />))

      const projects = screen.getByRole("region", { name: "Projects" })
      yield* Effect.promise(() => expect.element(projects.getByRole("link", { name: /^Notes/ })).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* Effect.promise(() => projects.getByRole("link", { name: /^Notes/ }).click())
      const products = screen.getByRole("region", { name: "Products" })
      yield* Effect.promise(() => expect.element(products.getByRole("link", { name: /^Logs/ })).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* expectAccessible()
      yield* Effect.promise(() =>
        products
          .getByRole("link", { name: /^Errors/ })
          .first()
          .click(),
      )
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Errors" })).toBeVisible(),
      )
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* Effect.promise(() => page.viewport(1280, 900))
    }),
  )

  it.effect("says a project's load and people are unknown when Today brings no pulse, as an older deployment's", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ older: true }))
      window.history.pushState(null, "", "/")
      const screen = yield* Effect.promise(() => render(<App />))

      const projects = screen.getByRole("region", { name: "Projects" })
      yield* Effect.promise(() =>
        expect.element(projects.getByRole("link", { name: /^Uptime.*Failing/ })).toBeVisible(),
      )
      // No steady line from a pulse that isn't there: neither Analytics nor Performance's load.
      yield* Effect.promise(() =>
        expect.element(projects.getByRole("link", { name: /^Analytics/ })).not.toBeInTheDocument(),
      )
      yield* Effect.promise(() => expect.element(projects).not.toMatchTextContent(/in 24 h/))
      yield* expectAccessible()

      yield* Effect.promise(() => projects.getByRole("link", { name: /^Notes/ }).click())
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("region", { name: "Products" }).getByRole("link", { name: /^Analytics/ }))
          .toMatchTextContent("Unknown: this deployment doesn't say"),
      )
    }),
  )

  it.effect("says a project that didn't answer Today is unknown, not fine", () =>
    Effect.gen(function* () {
      const notes = notesApi()
      answerApi((call) =>
        call.path[0] === "today"
          ? notes(call).pipe(
              Effect.map((answer) => ({
                ...answer,
                body:
                  typeof answer.body === "object" && answer.body !== null
                    ? { ...answer.body, unanswered: ["landing"] }
                    : answer.body,
              })),
            )
          : notes(call),
      )
      window.history.pushState(null, "", "/")
      const screen = yield* Effect.promise(() => render(<App />))

      const landingRow = screen.getByRole("region", { name: "Projects" }).getByRole("link", { name: /^Landing/ })
      yield* Effect.promise(() =>
        expect.element(landingRow).toMatchTextContent("Didn't answer: what it would show is missing"),
      )
      yield* Effect.promise(() => landingRow.click())
      yield* Effect.promise(() =>
        expect.element(screen.getByText("The project didn't answer: what needs you here is unknown")).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("region", { name: "Products" }).getByRole("link", { name: /^Uptime/ }))
          .toMatchTextContent("Unknown: the project didn't answer"),
      )
    }),
  )
})
