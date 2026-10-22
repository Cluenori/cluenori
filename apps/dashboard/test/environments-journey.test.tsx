import { EnvironmentKey } from "@cluenori/foundation"
import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"
import { page } from "vitest/browser"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi, apiCalls } from "./fake-api.ts"
import { notesApi } from "./notes-project.ts"

const worse = "2026.10.21-e91f09c"

// The environments the calls to one of the API's areas asked about, oldest first, each once.
const environmentsAsked = (area: string) => [
  ...new Set(
    apiCalls()
      .filter((call) => call.path[2] === area)
      .map((call) => call.query.get("environment")),
  ),
]

// The environment the latest call to one of the API's areas asked about.
const lastAsked = (area: string) =>
  apiCalls()
    .findLast((call) => call.path[2] === area)
    ?.query.get("environment")

describe("environments journey", () => {
  it.effect("starts in production, asks every question there, and remembers a switch to staging", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/notes/performance")
      const screen = yield* Effect.promise(() => render(<App />))

      // Production, one click from staging, beside the component and the period.
      const environments = screen.getByRole("group", { name: "Environment" })
      yield* Effect.promise(() =>
        expect
          .element(environments.getByRole("button", { name: "production" }))
          .toHaveAttribute("aria-pressed", "true"),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("Load on every component")).toBeVisible())
      assert.deepStrictEqual(environmentsAsked("operations"), ["production"])
      assert.deepStrictEqual(environmentsAsked("load"), ["production"])
      yield* expectAccessible()

      // Staging: in the address, and in every question.
      yield* Effect.promise(() => environments.getByRole("button", { name: "staging" }).click())
      yield* Effect.promise(() =>
        expect.element(environments.getByRole("button", { name: "staging" })).toHaveAttribute("aria-pressed", "true"),
      )
      assert.strictEqual(window.location.search, "?environment=staging")
      yield* Effect.promise(() => expect.poll(() => lastAsked("load")).toBe("staging"))

      // Kept on the project's other pages, opened from the sidebar.
      yield* Effect.promise(() => screen.getByRole("link", { name: "Errors", exact: true }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Errors" })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("No errors in this period.")).toBeVisible())
      assert.deepStrictEqual(environmentsAsked("errors"), ["staging"])

      // Another project, and back: Notes still shows staging, though its address doesn't say so.
      yield* Effect.promise(() => screen.getByRole("link", { name: "Landing" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Landing" })).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("group", { name: "Environment" })).not.toBeInTheDocument(),
      )
      yield* Effect.promise(() => screen.getByRole("link", { name: "Notes" }).first().click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible(),
      )
      assert.strictEqual(window.location.pathname, "/notes")
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("group", { name: "Environment" }).getByRole("button", { name: "staging" }))
          .toHaveAttribute("aria-pressed", "true"),
      )
      yield* Effect.promise(() => expect.poll(() => lastAsked("logs")).toBe("staging"))
      yield* expectAccessible()
    }),
  )

  it.effect("says the one environment seen as text, not a switch, and asks there", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ seen: [EnvironmentKey.make("production")] }))
      window.history.pushState(null, "", "/notes/logs")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("Warnings and errors over time")).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText("Environment", { exact: true })).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("group", { name: "Environment" })).not.toBeInTheDocument(),
      )
      assert.deepStrictEqual(environmentsAsked("logs"), ["production"])
      yield* expectAccessible()
    }),
  )

  it.effect("shows no environment on a deployment that doesn't say them, and asks without one", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ older: true }))
      window.history.pushState(null, "", "/notes/logs")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("Warnings and errors over time")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(screen.getByText("Environment", { exact: true })).not.toBeInTheDocument(),
      )
      assert.deepStrictEqual(environmentsAsked("logs"), [null])
      yield* Effect.promise(() => screen.getByRole("link", { name: "Overview" }).click())
      yield* Effect.promise(() => expect.element(screen.getByRole("region", { name: "Needs attention" })).toBeVisible())
      // Without settings, there is no production to choose.
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "Production" })).not.toBeInTheDocument(),
      )
    }),
  )

  it.effect("keeps a release and its environment from its page to an error, a trace, and an operation", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", `/notes/releases/notes-api/${worse}?environment=production`)
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => screen.getByRole("link", { name: "Errors of this release" }).click())
      yield* Effect.promise(() => screen.getByRole("link", { name: /NpgsqlException/ }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "NpgsqlException" })).toBeVisible(),
      )
      assert.strictEqual(window.location.search, `?component=notes-api&environment=production&release=${worse}`)
      yield* Effect.promise(() => expect.element(screen.getByRole("link", { name: worse })).toBeVisible())
      const asked = apiCalls().filter((call) => call.path[2] === "errors" && call.path.length === 4)
      assert.deepStrictEqual(
        asked.map((call) => [call.query.get("environment"), call.query.get("release")]),
        [["production", worse]],
      )
      yield* expectAccessible()

      // Its trace, and the way back, keep them too.
      yield* Effect.promise(() => screen.getByRole("link", { name: "Open the trace" }).click())
      yield* Effect.promise(() => expect.element(screen.getByText("INSERT exports")).toBeVisible())
      assert.include(window.location.search, `environment=production&release=${worse}`)
      yield* Effect.promise(() => screen.getByRole("link", { name: "Back to the performance" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Performance" })).toBeVisible(),
      )
      assert.strictEqual(window.location.search, `?environment=production&release=${worse}`)

      // An operation opened from there, too.
      yield* Effect.promise(() => screen.getByText("/api/feed", { exact: true }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: /\/api\/feed/ })).toBeVisible(),
      )
      assert.strictEqual(window.location.search, `?component=notes-api&environment=production&release=${worse}`)
      yield* Effect.promise(() => expect.element(screen.getByRole("link", { name: worse })).toBeVisible())
    }),
  )

  it.effect("chooses production from the overview, with the API's rule for a key and a failed save said", () =>
    Effect.gen(function* () {
      const notes = notesApi()
      // The first save finds the API not answering; the next goes through.
      let answering = false
      answerApi((call) => {
        if (call.method === "PUT" && !answering) {
          answering = true
          return Effect.succeed({ status: 503 })
        }
        return notes(call)
      })
      window.history.pushState(null, "", "/notes")
      const screen = yield* Effect.promise(() => render(<App />))

      const production = screen.getByRole("region", { name: "Production" })
      yield* Effect.promise(() =>
        expect.element(production.getByText("Where alerts ring, Today counts, and these pages start")).toBeVisible(),
      )
      yield* Effect.promise(() => production.getByRole("button", { name: "Change production" }).click())
      const dialog = screen.getByRole("dialog", { name: "Production in Notes" })
      yield* Effect.promise(() => expect.element(dialog.getByRole("checkbox", { name: "production" })).toBeChecked())
      yield* Effect.promise(() => expect.element(dialog.getByRole("checkbox", { name: "staging" })).not.toBeChecked())

      // Choosing none can't be saved.
      yield* Effect.promise(() => dialog.getByRole("checkbox", { name: "production" }).click())
      yield* Effect.promise(() => expect.element(dialog.getByText("Choose at least one.")).toBeVisible())
      yield* Effect.promise(() => expect.element(dialog.getByRole("button", { name: "Save" })).toBeDisabled())
      yield* Effect.promise(() => dialog.getByRole("checkbox", { name: "production" }).click())

      // One not seen yet is typed in, by the API's rule for a key.
      yield* Effect.promise(() => dialog.getByLabelText("Another environment, not seen yet").fill("Prod EU"))
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Add" }).click())
      yield* Effect.promise(() =>
        expect.element(dialog.getByText(/^Expected lowercase letters, digits and single hyphens/)).toBeVisible(),
      )
      yield* Effect.promise(() => dialog.getByLabelText("Another environment, not seen yet").fill("prod-eu"))
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Add" }).click())
      yield* Effect.promise(() => expect.element(dialog.getByRole("checkbox", { name: /^prod-eu/ })).toBeChecked())
      yield* expectAccessible()

      // A failed save says so; the next one closes the dialog, and the panel says the new choice.
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Save" }).click())
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByRole("alert"))
          .toHaveTextContent("The API didn't answer. Check that Cluenori is running, then try again."),
      )
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Save" }).click())
      yield* Effect.promise(() => expect.element(dialog).not.toBeInTheDocument())
      yield* Effect.promise(() =>
        expect.element(production.getByRole("listitem").filter({ hasText: "prod-eu" })).toBeVisible(),
      )
      const saved = apiCalls().filter((call) => call.method === "PUT")
      assert.deepStrictEqual(
        saved.map((call) => [call.path.join("/"), call.body]),
        [
          ["projects/notes/settings", '{"productionEnvironments":["production","prod-eu"]}'],
          ["projects/notes/settings", '{"productionEnvironments":["production","prod-eu"]}'],
        ],
      )
    }),
  )

  it.effect("fits a phone: the switches of a filtered page wrap, nothing wider than the screen", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      yield* Effect.promise(() => page.viewport(390, 844))
      window.history.pushState(null, "", `/notes/errors?component=notes-api&environment=production&release=${worse}`)
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("NpgsqlException").first()).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* expectAccessible()
      yield* Effect.promise(() => page.viewport(1280, 900))
    }),
  )
})
