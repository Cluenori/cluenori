import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi } from "./fake-api.ts"
import { notesApi } from "./notes-project.ts"

describe("incidents journey", () => {
  it.effect("leads from the incidents to one incident's life, its operation and release, and acknowledges it", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/incidents")
      const screen = yield* Effect.promise(() => render(<App />))

      // The list answers first: one open, no one on it; and whether every monitor is up.
      yield* Effect.promise(() => expect.element(screen.getByText("1 open, 1 no one is on yet")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("link", { name: /^Uptime:\s*All 2 monitors are fine/ })).toBeVisible(),
      )
      yield* expectAccessible()

      // The open incident is an item: no period, where it stands, what it is about, its life, and the
      // release that ran when it opened.
      yield* Effect.promise(() =>
        screen
          .getByRole("region", { name: "Open" })
          .getByRole("link", { name: /^Failing: POST \/api\/export/ })
          .click(),
      )
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("heading", { level: 1, name: "POST /api/export: 20% failed, usually 0.1%" }))
          .toBeVisible(),
      )
      assert.match(window.location.pathname, /^\/projects\/notes\/incidents\/0199f7a2-/)
      yield* Effect.promise(() =>
        expect.element(screen.getByText(/^Failing · Open for \d+ \S+, no one is on it yet$/)).toBeVisible(),
      )
      const life = screen.getByRole("region", { name: "Its life" })
      yield* Effect.promise(() => expect.element(life.getByText("Opened")).toBeVisible())
      yield* Effect.promise(() => expect.element(life.getByText("Got worse")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(life.getByText("POST /api/export: 8% failed, usually 0.1%")).toBeVisible(),
      )
      const released = screen.getByRole("region", { name: "Running when it opened" })
      yield* Effect.promise(() =>
        expect.element(released.getByRole("link", { name: /2026\.10\.21-e91f09c/ })).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("button", { name: "Copy for an agent" })).toBeVisible(),
      )
      yield* expectAccessible()

      // Acknowledging it says so at once, in where it stands and in its life.
      yield* Effect.promise(() => screen.getByRole("button", { name: "Acknowledge" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByText(/^Failing · Open for \d+ \S+, acknowledged$/)).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(life.getByText("Acknowledged")).toBeVisible())
      assert.isNull(screen.getByRole("button", { name: "Acknowledge" }).query())

      // Its operation opens at the moment it opened; its release, the release.
      yield* Effect.promise(() => screen.getByRole("link", { name: "Its operation" }).first().click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: /POST \/api\/export/ })).toBeVisible(),
      )
      assert.match(window.location.search, /at=/)
      // The operation leads back to its incidents.
      const about = screen.getByRole("region", { name: "Incidents" })
      yield* Effect.promise(() => expect.element(about.getByText(/^Failing: POST \/api\/export/)).toBeVisible())
    }),
  )

  it.effect("leads from Uptime to a monitor's history and its incident, and says when a monitor is gone", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/uptime")
      const screen = yield* Effect.promise(() => render(<App />))

      // Whether everything is up, first; then each monitor, with its days.
      yield* Effect.promise(() => expect.element(screen.getByText("All 2 monitors are fine")).toBeVisible())
      const monitors = screen.getByRole("region", { name: "Monitors" })
      yield* Effect.promise(() => expect.element(monitors.getByText(/^Up for 1 \S+$/)).toBeVisible())
      yield* Effect.promise(() =>
        expect
          .element(monitors.getByRole("img", { name: /^Last 30 days: \S*99[.,]\d+\S* up, 1 day with failed checks$/ }))
          .toBeVisible(),
      )
      yield* expectAccessible()

      // A monitor is an item: its last 24 hours, its 90 days, its failed checks and its incidents.
      yield* Effect.promise(() => monitors.getByRole("link", { name: /api\.notes\.example\/health/ }).click())
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("heading", { level: 1, name: "https://api.notes.example/health" }))
          .toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("region", { name: "Last 24 hours" }).getByText("average, every 5 min"))
          .toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("region", { name: "Last 90 days" }).getByRole("img", { name: /^Last 90 days: / }))
          .toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("region", { name: "Failed checks" }).getByText("HTTP 503").first())
          .toBeVisible(),
      )
      yield* expectAccessible()

      // Its incident opens its page, which leads back to the monitor.
      yield* Effect.promise(() =>
        screen
          .getByRole("region", { name: "Incidents" })
          .getByRole("link", { name: /^Down:/ })
          .click(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText(/^Down · Resolved after 14 \S+$/)).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "Its life" }).getByText("Resolved")).toBeVisible(),
      )
      yield* Effect.promise(() => screen.getByRole("link", { name: "Its monitor" }).first().click())
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("heading", { level: 1, name: "https://api.notes.example/health" }))
          .toBeVisible(),
      )

      // A monitor that is gone says so.
      window.history.pushState(null, "", "/projects/notes/uptime/0199f7a2-6d2f-7e4b-8c3a-5f9b2d7e1a99")
      window.dispatchEvent(new PopStateEvent("popstate"))
      yield* Effect.promise(() =>
        expect.element(screen.getByText("This project has no such monitor: it may have been removed.")).toBeVisible(),
      )
    }),
  )
})
