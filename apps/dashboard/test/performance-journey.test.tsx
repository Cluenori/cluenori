import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"
import { page } from "vitest/browser"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"

describe("performance journey", () => {
  it.effect("leads from a backend's endpoints to one endpoint's slowest requests", () =>
    Effect.gen(function* () {
      window.history.pushState(null, "", "/folio/performance")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("Requests to folio-api")).toBeVisible())
      yield* expectAccessible()
      yield* Effect.promise(() => screen.getByRole("link", { name: "All endpoints" }).click())

      // Every endpoint, searchable: one search finds the export.
      yield* Effect.promise(() => screen.getByPlaceholder("Search endpoints, such as /api/notes").fill("export"))
      yield* expectAccessible()
      yield* Effect.promise(() => screen.getByText("/api/export", { exact: true }).click())

      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: /\/api\/export$/ })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("Slowest and failed requests")).toBeVisible())
      yield* expectAccessible()
    }),
  )

  it.effect("shows an app's start and screens, and how to start an app that has sent nothing", () =>
    Effect.gen(function* () {
      window.history.pushState(null, "", "/folio/performance?component=folio-ios")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("App start")).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText("FeedView")).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText("Network calls")).toBeVisible())
      yield* expectAccessible()

      yield* Effect.promise(() => screen.getByRole("button", { name: "folio-android" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByText("folio-android has sent nothing yet")).toBeVisible(),
      )
      yield* expectAccessible()
    }),
  )

  it.effect("fits a phone: an app's crashes with nothing wider than the screen", () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => page.viewport(390, 844))
      window.history.pushState(null, "", "/folio/errors?component=folio-ios")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("Crashes by hour")).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* expectAccessible()
      yield* Effect.promise(() => page.viewport(1280, 900))
    }),
  )
})
