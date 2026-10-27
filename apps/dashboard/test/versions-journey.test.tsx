import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi, apiCalls } from "./fake-api.ts"
import { notesApi } from "./notes-project.ts"

// The versions the dashboard set, by component, oldest first.
const versionsSet = () =>
  apiCalls()
    .filter((call) => call.method === "PUT" && call.path[2] === "versions")
    .map((call) => [call.path[3], call.body])

describe("versions journey", () => {
  it.effect("bumps a component's version from a menu, and sets a first version with its first build", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/releases")
      const screen = yield* Effect.promise(() => render(<App />))

      // In each component's delivery, the API's version and the release its next build will be; the
      // iPhone app has none yet.
      const api = screen.getByRole("region", { name: "notes-api" })
      const ios = screen.getByRole("region", { name: "notes-ios" })
      yield* Effect.promise(() => expect.element(api.getByText("1.4.0", { exact: true })).toBeVisible())
      yield* Effect.promise(() => expect.element(api.getByText("1.4.0+58")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(ios.getByText("No version yet: CI can't number its builds.")).toBeVisible(),
      )
      yield* expectAccessible()

      // Each bump says what it becomes; minor, picked, is set at once.
      yield* Effect.promise(() => api.getByRole("button", { name: "Bump notes-api" }).click())
      const menu = screen.getByRole("menu")
      yield* Effect.promise(() => expect.element(menu.getByRole("menuitem", { name: "Patch 1.4.1" })).toBeVisible())
      yield* Effect.promise(() => expect.element(menu.getByRole("menuitem", { name: "Major 2.0.0" })).toBeVisible())
      yield* Effect.promise(() => menu.getByRole("menuitem", { name: "Minor 1.5.0" }).click())
      yield* Effect.promise(() => expect.element(api.getByText("1.5.0+58")).toBeVisible())
      // Checked once the menu has closed: while it closes, its focus guards are still there, and on a
      // busy machine the check can start before its closing animation does, so it wouldn't wait.
      yield* Effect.promise(() => expect.element(menu).not.toBeInTheDocument())
      yield* expectAccessible()

      // A first version for the iPhone app, its builds numbered on from those made before.
      yield* Effect.promise(() => ios.getByRole("button", { name: "Set the version… of notes-ios" }).click())
      const dialog = screen.getByRole("dialog", { name: "notes-ios's version" })
      yield* Effect.promise(() => dialog.getByLabelText("Version").fill("1.9"))
      yield* Effect.promise(() => dialog.getByLabelText("First build number").fill("421"))
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Set the version" }).click())
      yield* Effect.promise(() => expect.element(dialog.getByText(/^Expected MAJOR\.MINOR\.PATCH/)).toBeVisible())
      yield* expectAccessible()
      yield* Effect.promise(() => dialog.getByLabelText("Version").fill("1.9.0"))
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Set the version" }).click())
      yield* Effect.promise(() => expect.element(dialog).not.toBeInTheDocument())
      yield* Effect.promise(() => expect.element(ios.getByText("1.9.0+421")).toBeVisible())
      assert.deepStrictEqual(versionsSet(), [
        ["notes-api", '{"version":"1.5.0"}'],
        ["notes-ios", '{"version":"1.9.0","firstBuild":421}'],
      ])
    }),
  )

  it.effect("says why a lower version isn't set", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/releases?component=notes-api")
      const screen = yield* Effect.promise(() => render(<App />))

      const api = screen.getByRole("region", { name: "notes-api" })
      yield* Effect.promise(() => api.getByRole("button", { name: "Set version… of notes-api" }).click())
      const dialog = screen.getByRole("dialog", { name: "notes-api's version" })
      yield* Effect.promise(() => expect.element(dialog.getByLabelText("Version")).toHaveValue("1.4.0"))
      yield* Effect.promise(() => dialog.getByLabelText("Version").fill("1.3.9"))
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Set the version" }).click())
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByRole("alert"))
          .toHaveTextContent("1.3.9 is lower than notes-api's 1.4.0: a version only goes up"),
      )
      yield* expectAccessible()
    }),
  )
})
