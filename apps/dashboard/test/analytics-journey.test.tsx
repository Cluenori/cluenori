import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"
import { page } from "vitest/browser"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi, apiCalls } from "./fake-api.ts"
import { knownPerson, knownUser } from "./notes-apps.ts"
import { notesApi } from "./notes-project.ts"

describe("analytics journey", () => {
  it.effect("leads from how the apps are used to a release that got worse, measure by measure", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/analytics")
      const screen = yield* Effect.promise(() => render(<App />))

      // The apps sent from production and beta; the page shows production, the project's. It leads
      // with the people of the latest whole day and week.
      const people = screen.getByRole("region", { name: "People" })
      yield* Effect.promise(() => expect.element(people.getByText("55", { exact: true })).toBeVisible())
      yield* Effect.promise(() => expect.element(people.getByText("180", { exact: true })).toBeVisible())
      const environment = screen.getByRole("group", { name: "Environment" })
      yield* Effect.promise(() =>
        expect.element(environment.getByRole("button", { name: "production" })).toHaveAttribute("aria-pressed", "true"),
      )
      const health = screen.getByRole("region", { name: "App health" })
      yield* Effect.promise(() =>
        expect.element(health.getByText("Worse: cold launch slower, more crashes")).toBeVisible(),
      )
      // Before MetricKit reported of a release, its crashes are unknown, not zero.
      yield* Effect.promise(() => expect.element(health.getByText(/unknown$/)).toBeVisible())
      yield* Effect.promise(() => expect.element(health.getByText("0.4.0+25")).not.toBeInTheDocument())
      // The month reaching before the app first sent isn't counted: unknown, never zero.
      yield* Effect.promise(() => expect.element(people.getByText("Not 30 days counted yet")).toBeVisible())
      yield* expectAccessible()

      yield* Effect.promise(() => health.getByRole("link", { name: /0\.3\.0\+20/ }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "0.3.0+20" })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("Against 0.2.0+10")).toBeVisible())
      const coldLaunch = screen.getByRole("row", { name: /^Cold launch p95/ })
      yield* Effect.promise(() => expect.element(coldLaunch.getByText(/^1[.,]6 s/)).toBeVisible())
      // Worse, as a screen reader says it, beside the color.
      yield* Effect.promise(() => expect.element(coldLaunch.getByText(", worse")).toBeInTheDocument())
      yield* expectAccessible()

      // Every release, beta's too once beta is chosen.
      yield* Effect.promise(() => screen.getByRole("link", { name: "Back to the releases' app health" }).click())
      yield* Effect.promise(() =>
        screen.getByRole("group", { name: "Environment" }).getByRole("button", { name: "beta" }).click(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("0.4.0+25")).toBeVisible())
      yield* expectAccessible()
    }),
  )

  it.effect("finds a person by the app's user ID, and says when the apps never sent one", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/analytics")
      const screen = yield* Effect.promise(() => render(<App />))

      const field = screen.getByLabelText("The app's user ID")
      yield* Effect.promise(() => field.fill("user 1842"))
      yield* Effect.promise(() => screen.getByRole("button", { name: "Find" }).click())
      yield* Effect.promise(() => expect.element(screen.getByText(/printable ASCII without spaces/)).toBeVisible())
      yield* Effect.promise(() => field.fill(knownUser))
      yield* Effect.promise(() => screen.getByRole("button", { name: "Find" }).click())

      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: knownUser })).toBeVisible(),
      )
      // Found by the app's user ID, the page moves to the person's own address, which keeps them.
      yield* Effect.promise(() =>
        expect.poll(() => window.location.pathname).toBe(`/projects/notes/analytics/people/${knownPerson}`),
      )
      assert.strictEqual(window.location.search, "")
      // Six days active in 30, the one a session only crossed into too; ten sessions started.
      const active = screen.getByRole("region", { name: "How active they are" })
      yield* Effect.promise(() => expect.element(active.getByText("6", { exact: true })).toBeVisible())
      yield* Effect.promise(() => expect.element(active.getByText("10", { exact: true })).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText("note.shared")).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText("Launched cold")).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText("iPhone17,2, iOS 27.1")).toBeVisible())
      yield* expectAccessible()

      window.history.pushState(null, "", "/projects/notes/analytics/people?user=user-0000")
      window.dispatchEvent(new PopStateEvent("popstate"))
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("alert"))
          .toHaveTextContent(
            "No person has this ID or user ID: the apps never sent it. Check it is the ID the app gives Cluenori.identify.",
          ),
      )
      yield* expectAccessible()
    }),
  )

  it.effect("opens a feature's story from the analytics page, and from a person who used it", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/analytics")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => screen.getByRole("link", { name: "notes.share" }).first().click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "notes.share" })).toBeVisible(),
      )
      // Its use and what its services did for it, each day, with its errors.
      yield* Effect.promise(() => expect.element(screen.getByRole("region", { name: "Each day" })).toBeVisible())
      const errors = screen.getByRole("region", { name: "Errors" })
      yield* Effect.promise(() => expect.element(errors.getByText("TimeoutException")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("button", { name: "Copy for an agent" })).toBeVisible(),
      )
      yield* expectAccessible()

      // From one who used it to their page, and back to the story of another feature they used.
      yield* Effect.promise(() =>
        screen
          .getByRole("region", { name: "Who uses it" })
          .getByRole("link", { name: /user-1842/ })
          .click(),
      )
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: knownUser })).toBeVisible(),
      )
      yield* Effect.promise(() =>
        screen
          .getByRole("region", { name: "Features they use" })
          .getByRole("link", { name: /notes\.edit/ })
          .click(),
      )
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "notes.edit" })).toBeVisible(),
      )
      // Only the app names it: the page says why its services' signals aren't there.
      yield* Effect.promise(() => expect.element(screen.getByText(/No service named this feature/)).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "Errors" })).not.toBeInTheDocument(),
      )
      yield* expectAccessible()
    }),
  )

  it.effect("says a feature nothing names isn't there", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/analytics/features/notes.nothing")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() =>
        expect.element(screen.getByRole("alert").getByText(/^Nothing kept names this feature/)).toBeVisible(),
      )
      yield* expectAccessible()
    }),
  )

  it.effect("searches every feature", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/analytics")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => screen.getByRole("link", { name: "All features" }).click())
      yield* Effect.promise(() => screen.getByLabelText("Search features").fill("share"))
      yield* Effect.promise(() => expect.element(screen.getByText("notes.share")).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText("notes.edit")).not.toBeInTheDocument())
      yield* expectAccessible()
    }),
  )

  it.effect("tells a project no app sends to how to start, on a phone too", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      yield* Effect.promise(() => page.viewport(390, 844))
      window.history.pushState(null, "", "/projects/landing/analytics")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("No app sends to this project yet")).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText(/Cluenori\.start\(/)).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* expectAccessible()

      window.history.pushState(null, "", "/projects/notes/analytics")
      window.dispatchEvent(new PopStateEvent("popstate"))
      yield* Effect.promise(() =>
        expect.element(screen.getByText("Worse: cold launch slower, more crashes")).toBeVisible(),
      )
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* Effect.promise(() => page.viewport(1280, 900))
      // The analytics questions were asked of production once its apps were known to send from it.
      const usage = apiCalls().filter((call) => call.path[1] === "notes" && call.path[2] === "usage")
      assert.isTrue(usage.every((call) => call.query.get("environment") === "production"))
    }),
  )
})
