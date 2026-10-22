import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi, apiCalls } from "./fake-api.ts"
import { firstKey, issuedKey } from "./notes-apps.ts"
import { notesApi } from "./notes-project.ts"

// What the dashboard sent about notes-ios's keys and policy, oldest first.
const sent = () =>
  apiCalls()
    .filter((call) => call.method !== "GET" && (call.path[2] === "version-policies" || call.path[4] === "sdk-keys"))
    .map((call) => `${call.method} ${call.path.slice(2).join("/")}`)

describe("app keys journey", () => {
  it.effect("issues an SDK key and revokes the old one after asking", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/notes/analytics?component=notes-ios")
      const screen = yield* Effect.promise(() => render(<App />))

      const app = screen.getByRole("region", { name: "notes-ios" })
      yield* Effect.promise(() => expect.element(app.getByText(firstKey)).toBeVisible())
      yield* expectAccessible()

      yield* Effect.promise(() => app.getByRole("button", { name: "Issue a new key for notes-ios" }).click())
      yield* Effect.promise(() => expect.element(app.getByText(issuedKey)).toBeVisible())
      yield* Effect.promise(() => expect.element(app.getByText("New", { exact: true })).toBeVisible())
      yield* expectAccessible()

      // Revoking asks first, and keeping it changes nothing.
      const revokeFirst = app.getByRole("button", { name: `Revoke the key ending ${firstKey.slice(-6)}` })
      yield* Effect.promise(() => revokeFirst.click())
      const asking = screen.getByRole("alertdialog", { name: "Revoke this SDK key?" })
      yield* Effect.promise(() => expect.element(asking.getByText(/Ship a build with another key first/)).toBeVisible())
      yield* expectAccessible()
      yield* Effect.promise(() => asking.getByRole("button", { name: "Keep it" }).click())
      assert.deepStrictEqual(sent(), ["POST components/notes-ios/sdk-keys"])

      yield* Effect.promise(() => revokeFirst.click())
      yield* Effect.promise(() =>
        screen
          .getByRole("alertdialog", { name: "Revoke this SDK key?" })
          .getByRole("button", { name: "Revoke" })
          .click(),
      )
      yield* Effect.promise(() => expect.element(app.getByText("1 revoked key")).toBeVisible())
      yield* Effect.promise(() => expect.element(app.getByText(firstKey)).not.toBeInTheDocument())
      assert.deepStrictEqual(sent(), [
        "POST components/notes-ios/sdk-keys",
        `POST components/notes-ios/sdk-keys/${firstKey}/revoke`,
      ])
      yield* expectAccessible()
    }),
  )

  it.effect("sets a version policy, says why one isn't set, and clears it after asking", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/notes/analytics?component=notes-ios")
      const screen = yield* Effect.promise(() => render(<App />))

      const app = screen.getByRole("region", { name: "notes-ios" })
      yield* Effect.promise(() =>
        expect.element(app.getByText("No version policy: no release is asked to update.")).toBeVisible(),
      )
      yield* Effect.promise(() => app.getByRole("button", { name: /^Set a version policy/ }).click())
      const dialog = screen.getByRole("dialog", { name: "notes-ios's version policy" })
      yield* Effect.promise(() => dialog.getByLabelText("Minimum version").fill("0.3"))
      yield* Effect.promise(() => dialog.getByLabelText("Recommended version").fill("0.2"))
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Save the policy" }).click())
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByRole("alert"))
          .toHaveTextContent("The recommended version, 0.2, is lower than the minimum, 0.3."),
      )
      yield* expectAccessible()

      // Without a store page, the API finds none for an app without an App Store deploy target.
      yield* Effect.promise(() => dialog.getByLabelText("Recommended version").fill("0.4"))
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Save the policy" }).click())
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByRole("alert"))
          .toHaveTextContent("notes-ios has no store URL, and none was found from an App Store deploy target."),
      )
      yield* Effect.promise(() => dialog.getByLabelText("Store page").fill("https://apps.apple.com/app/id0000000000"))
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Add words" }).click())
      yield* Effect.promise(() => dialog.getByLabelText("Title").fill("Update Notes"))
      yield* Effect.promise(() => dialog.getByLabelText("Message").fill("This version no longer syncs."))
      yield* expectAccessible()
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Save the policy" }).click())
      yield* Effect.promise(() => expect.element(dialog).not.toBeInTheDocument())
      yield* Effect.promise(() => expect.element(app.getByText("Must update below")).toBeVisible())
      yield* Effect.promise(() => expect.element(app.getByText("Update Notes")).toBeVisible())
      yield* expectAccessible()

      yield* Effect.promise(() => app.getByRole("button", { name: "Clear notes-ios's version policy" }).click())
      const asking = screen.getByRole("alertdialog", { name: "Clear notes-ios's version policy?" })
      yield* Effect.promise(() => asking.getByRole("button", { name: "Clear the policy" }).click())
      yield* Effect.promise(() =>
        expect.element(app.getByText("No version policy: no release is asked to update.")).toBeVisible(),
      )
      assert.deepStrictEqual(sent(), [
        "PUT version-policies/notes-ios",
        "PUT version-policies/notes-ios",
        "DELETE version-policies/notes-ios",
      ])
      const saved = apiCalls().filter((call) => call.method === "PUT")[1]
      assert.deepStrictEqual(
        saved?.body,
        '{"minimum":"0.3","recommended":"0.4","storeUrl":"https://apps.apple.com/app/id0000000000","words":[{"locale":"en-US","decision":"require","text":{"title":"Update Notes","message":"This version no longer syncs."}}]}',
      )
    }),
  )
})
