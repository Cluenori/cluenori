import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"

describe("crash journey", () => {
  it.effect("leads from the overview's new crash to what the app did before it, and to a request's trace", () =>
    Effect.gen(function* () {
      window.history.pushState(null, "", "/folio")
      const screen = yield* Effect.promise(() => render(<App />))

      // The overview names the new crash first among what is new, with one way in.
      yield* Effect.promise(() =>
        expect.element(screen.getByText(/EXC_BAD_ACCESS is a new crash in folio-ios/)).toBeVisible(),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => screen.getByRole("link", { name: "Open the crash" }).click())

      // The crash opens in place: its stack, its release, and the app's trail before it.
      yield* Effect.promise(() => expect.element(screen.getByText("Before it, in the latest session")).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText("By release")).toBeVisible())
      yield* expectAccessible()

      // A request from the trail opens its trace, which starts in the app.
      yield* Effect.promise(() => screen.getByRole("link", { name: "Open the request" }).first().click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: /POST \/api\/export/ })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("At folio-api")).toBeVisible())
      yield* expectAccessible()
    }),
  )
})
