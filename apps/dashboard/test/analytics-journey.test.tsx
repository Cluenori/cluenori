import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"
import { page } from "vitest/browser"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi, apiCalls } from "./fake-api.ts"
import { knownUser } from "./notes-apps.ts"
import { notesApi } from "./notes-project.ts"

describe("analytics journey", () => {
  it.effect("leads from how the apps are used to a release that got worse, measure by measure", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/analytics")
      const screen = yield* Effect.promise(() => render(<App />))

      // The apps sent from production and beta; the page shows production, the project's.
      yield* Effect.promise(() =>
        expect
          .element(screen.getByText("Active each UTC day, and in the 7 and 30 days ending it", { exact: false }))
          .toBeVisible(),
      )
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
      // The month reaching before the app first sent isn't counted.
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "People" }).getByText("unknown")).toBeVisible(),
      )
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
            "No person has this user ID: the apps never sent it. Check it is the ID the app gives Cluenori.identify.",
          ),
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
