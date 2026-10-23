import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"
import { page, userEvent } from "vitest/browser"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi, apiCalls } from "./fake-api.ts"
import { appRelease, appStorePromotions, notesApi } from "./notes-project.ts"

describe("now journey", () => {
  it.effect("leads from what needs the founder across projects, down a level at a time, and back", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ seeded: appStorePromotions }))
      window.history.pushState(null, "", "/")
      const screen = yield* Effect.promise(() => render(<App />))

      // Now: what needs the founder, the most urgent first, each with its kind and project, and the
      // release App Store review approved, which waits for them, last.
      yield* Effect.promise(() => expect.element(screen.getByRole("heading", { level: 1, name: "Now" })).toBeVisible())
      const needsYou = screen.getByRole("region", { name: "Needs you" })
      yield* Effect.promise(() =>
        expect.element(needsYou.getByRole("link", { name: /^Failing · Notes.*POST \/api\/export/ })).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect.element(needsYou.getByRole("link", { name: /^Slower · Notes.*GET \/api\/feed/ })).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect
          .element(
            needsYou.getByRole("link", {
              name: new RegExp(`^Release · Notes.*${appRelease.replace("+", "\\+")} passed App Store review`),
            }),
          )
          .toBeVisible(),
      )
      const kinds = needsYou
        .getByRole("link")
        .elements()
        .map((link) => (link.textContent ?? "").split(" · ")[0])
      assert.deepStrictEqual(kinds, ["Failing", "Happening now", "New error", "Slower", "Release"])
      yield* Effect.promise(() => expect.element(screen.getByText("5 things need you, in 1 project")).toBeVisible())

      // Every project: its state, its last day, and its daily people; Landing has nothing, and no apps.
      const projects = screen.getByRole("region", { name: "Projects" })
      const notesRow = projects.getByRole("link", { name: /^Notes/ })
      yield* Effect.promise(() =>
        expect.element(notesRow).toMatchTextContent("1 incident · 2 errors · 1 slower operation · 1 release"),
      )
      yield* Effect.promise(() => expect.element(notesRow).toMatchTextContent(/46\s*daily people.*vs last week/))
      const landingRow = projects.getByRole("link", { name: /^Landing/ })
      yield* Effect.promise(() => expect.element(landingRow).toMatchTextContent("Nothing needs you"))
      yield* Effect.promise(() => expect.element(landingRow).toMatchTextContent("Nothing reported in 24 h"))
      yield* Effect.promise(() => expect.element(landingRow).toMatchTextContent("No app data"))
      yield* expectAccessible()
      // All of Now is Today's one answer: no question of any project's.
      assert.deepStrictEqual([...new Set(apiCalls().map((call) => call.path.join("/")))].toSorted(), [
        "me",
        "projects",
        "today",
      ])

      // A project: its people, its last day, what needs the founder there, and its three doors.
      yield* Effect.promise(() => notesRow.click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible(),
      )
      assert.strictEqual(window.location.pathname, "/projects/notes")
      const people = screen.getByRole("region", { name: "People" })
      yield* Effect.promise(() => expect.element(people.getByText("Daily people")).toBeVisible())
      // The month before the apps first sent isn't counted: unknown, never zero.
      yield* Effect.promise(() => expect.element(people.getByText("Not counted that day")).toBeVisible())
      const load = screen.getByRole("region", { name: "Load" })
      yield* Effect.promise(() =>
        expect.element(load.getByRole("img", { name: /operations over the last 24 hours/ })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(load.getByText("Busiest hour")).toBeVisible())
      const doors = screen.getByRole("navigation", { name: "Notes's areas" })
      yield* Effect.promise(() =>
        expect
          .element(doors.getByRole("link", { name: /^Tech/ }))
          .toMatchTextContent("1 incident · 2 errors · 1 slower operation"),
      )
      yield* Effect.promise(() =>
        expect.element(doors.getByRole("link", { name: /^Releases/ })).toMatchTextContent("1 needs you"),
      )
      yield* expectAccessible()
      // Beside Today's answer, the page asks only what its doors say more of: what runs where, and how
      // the apps' releases are.
      assert.deepStrictEqual(
        [...new Set(apiCalls().map((call) => call.path.join("/")))].filter((path) => path.startsWith("projects/")),
        ["projects/notes/delivery", "projects/notes/app-health"],
      )

      // Tech: the top few of each, and a way to every one.
      yield* Effect.promise(() => doors.getByRole("link", { name: /^Tech/ }).click())
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

      // The browser's back steps up a level at a time.
      window.history.back()
      yield* Effect.promise(() => expect.element(screen.getByRole("heading", { level: 1, name: "Tech" })).toBeVisible())
      window.history.back()
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible(),
      )
    }),
  )

  it.effect("opens what needs the founder from the keyboard", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/")
      const screen = yield* Effect.promise(() => render(<App />))

      const slower = screen.getByRole("region", { name: "Needs you" }).getByRole("link", { name: /^Slower/ })
      yield* Effect.promise(() => expect.element(slower).toBeVisible())
      slower.element().focus()
      yield* Effect.promise(() => userEvent.keyboard("{Enter}"))
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: /\/api\/feed/ })).toBeVisible(),
      )
      assert.strictEqual(window.location.pathname, "/projects/notes/operations/GET%20/api/feed")
    }),
  )

  it.effect("fits a phone: Now, a project and Tech, nothing wider than the screen", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      yield* Effect.promise(() => page.viewport(390, 844))
      window.history.pushState(null, "", "/")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByRole("link", { name: /^Notes/ }).first()).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* Effect.promise(() =>
        screen
          .getByRole("region", { name: "Projects" })
          .getByRole("link", { name: /^Notes/ })
          .click(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("Busiest hour")).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* Effect.promise(() =>
        screen.getByRole("navigation", { name: "Notes's areas" }).getByRole("link", { name: /^Tech/ }).click(),
      )
      yield* Effect.promise(() => expect.element(screen.getByRole("region", { name: "Requests" })).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* expectAccessible()
      yield* Effect.promise(() => page.viewport(1280, 900))
    }),
  )

  it.effect("says a project's load and people are unknown when Today brings no pulse, as an older deployment's", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ older: true }))
      window.history.pushState(null, "", "/")
      const screen = yield* Effect.promise(() => render(<App />))

      const notesRow = screen.getByRole("region", { name: "Projects" }).getByRole("link", { name: /^Notes/ })
      yield* Effect.promise(() => expect.element(notesRow).toMatchTextContent("1 incident · 2 errors"))
      yield* Effect.promise(() => expect.element(notesRow).toMatchTextContent(/Unknown.*Unknown/))
      yield* Effect.promise(() => expect.element(notesRow).not.toMatchTextContent(/daily people|in 24 h/))
      yield* expectAccessible()

      yield* Effect.promise(() => notesRow.click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "People" }).getByText("Unknown right now.")).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "Load" }).getByText("Unknown right now.")).toBeVisible(),
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
        expect.element(landingRow).toMatchTextContent("Didn't answer, so what needs you there is unknown"),
      )
      yield* Effect.promise(() =>
        expect.element(screen.getByText("Landing didn't answer: what needs you there is unknown.")).toBeVisible(),
      )
    }),
  )
})
