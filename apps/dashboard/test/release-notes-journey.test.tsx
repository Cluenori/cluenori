import { defaultNotesStyle } from "@cluenori/releases"
import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi, apiCalls } from "./fake-api.ts"
import { appRelease, iosWithThreeApps, notesApi } from "./notes-project.ts"

const appPage = `/projects/notes/releases/notes-ios/${encodeURIComponent(appRelease)}?environment=production`

// The bodies the dashboard saved at an address under the project, oldest first.
const putTo = (path: string) =>
  apiCalls()
    .filter((call) => call.method === "PUT" && call.path.join("/") === `projects/notes/${path}`)
    .map((call) => call.body)

describe("release notes journey", () => {
  it.effect("drafts a release's notes with AI, edits them, adds a language, and saves them", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ linked: iosWithThreeApps }))
      window.history.pushState(null, "", appPage)
      const screen = yield* Effect.promise(() => render(<App />))

      // An app's release has notes, in English to start with; a draft is for where it goes, the
      // App Store by default.
      const editor = screen.getByRole("region", { name: "Release notes" })
      yield* Effect.promise(() => expect.element(editor.getByLabelText("en-US")).toHaveValue(""))
      const draftFor = editor.getByRole("group", { name: "The environment the draft is for" })
      yield* Effect.promise(() =>
        expect.element(draftFor.getByRole("button", { name: "production" })).toHaveAttribute("aria-pressed", "true"),
      )
      yield* expectAccessible()

      // The draft fills the field, and saves nothing.
      yield* Effect.promise(() => editor.getByRole("button", { name: "Draft with AI" }).click())
      yield* Effect.promise(() =>
        expect
          .element(editor.getByRole("status"))
          .toHaveTextContent(`Drafted from 4 commits since 1.8.1+398. Not saved: read it, edit it, then save it.`),
      )
      yield* Effect.promise(() =>
        expect
          .element(editor.getByLabelText("en-US"))
          .toHaveValue(
            "Share a note with anyone by a link.\nExports that failed on a bad connection now finish on their own.",
          ),
      )
      yield* Effect.promise(() => expect.element(editor.getByText("Not saved")).toBeVisible())
      assert.deepStrictEqual(putTo(`releases/notes-ios/${appRelease}/notes`), [])
      assert.deepStrictEqual(
        apiCalls()
          .filter((call) => call.path.at(-1) === "draft")
          .map((call) => call.body),
        ['{"environment":"production"}'],
      )

      // Edited, with how long it is of what a store takes.
      yield* Effect.promise(() => editor.getByLabelText("en-US").fill("Share a note with anyone by a link."))
      yield* Effect.promise(() => expect.element(editor.getByText(/^35 \/ 4[.,]?000/)).toBeVisible())

      // A language that isn't one is refused with the API's rule; German is added.
      const language = editor.getByLabelText("Add language")
      yield* Effect.promise(() => language.fill("German"))
      yield* Effect.promise(() => editor.getByRole("button", { name: "Add", exact: true }).click())
      yield* Effect.promise(() =>
        expect.element(editor.getByText(/^Expected a language as App Store Connect names it/)).toBeVisible(),
      )
      yield* Effect.promise(() => language.fill("de-DE"))
      yield* Effect.promise(() => editor.getByRole("button", { name: "Add", exact: true }).click())
      yield* Effect.promise(() => editor.getByLabelText("de-DE").fill("Teile eine Notiz per Link."))
      yield* expectAccessible()

      // Saved, both.
      yield* Effect.promise(() => editor.getByRole("button", { name: "Save notes" }).click())
      yield* Effect.promise(() => expect.element(editor.getByText("Saved.")).toBeVisible())
      assert.deepStrictEqual(putTo(`releases/notes-ios/${appRelease}/notes`), [
        '{"notes":[{"locale":"en-US","text":"Share a note with anyone by a link."},{"locale":"de-DE","text":"Teile eine Notiz per Link."}]}',
      ])
    }),
  )

  it.effect("says why no draft was written, and keeps what was typed", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ linked: iosWithThreeApps, drafts: false }))
      window.history.pushState(null, "", appPage)
      const screen = yield* Effect.promise(() => render(<App />))

      const editor = screen.getByRole("region", { name: "Release notes" })
      yield* Effect.promise(() => editor.getByLabelText("en-US").fill("Faster sync."))
      yield* Effect.promise(() =>
        editor
          .getByRole("group", { name: "The environment the draft is for" })
          .getByRole("button", { name: "beta" })
          .click(),
      )
      yield* Effect.promise(() => editor.getByRole("button", { name: "Draft with AI" }).click())
      yield* Effect.promise(() =>
        expect
          .element(editor.getByRole("alert"))
          .toHaveTextContent("The language model didn't answer: try again in a minute"),
      )
      yield* Effect.promise(() => expect.element(editor.getByLabelText("en-US")).toHaveValue("Faster sync."))
      yield* expectAccessible()
    }),
  )

  it.effect("saves the project's notes style, Cluenori's default until then", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/releases")
      const screen = yield* Effect.promise(() => render(<App />))

      const panel = screen.getByRole("region", { name: "Release notes style" })
      const style = panel.getByLabelText("How the notes read")
      yield* Effect.promise(() => expect.element(style).toHaveValue(defaultNotesStyle))
      yield* Effect.promise(() =>
        expect.element(panel.getByText(/^Cluenori's default, until the project saves/)).toBeVisible(),
      )
      yield* expectAccessible()

      yield* Effect.promise(() => style.fill("Two short lines, for people who take notes all day."))
      yield* Effect.promise(() => panel.getByRole("button", { name: "Save" }).click())
      yield* Effect.promise(() => expect.element(panel.getByText("Saved.")).toBeVisible())
      yield* Effect.promise(() =>
        expect
          .element(panel.getByLabelText("How the notes read"))
          .toHaveValue("Two short lines, for people who take notes all day."),
      )
      assert.deepStrictEqual(putTo("notes-style"), ['{"style":"Two short lines, for people who take notes all day."}'])
    }),
  )
})
