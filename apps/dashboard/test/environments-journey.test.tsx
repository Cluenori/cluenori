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
      window.history.pushState(null, "", "/projects/notes/performance")
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

      // Kept on the project's other pages: Tech, from the sidebar, and its errors.
      yield* Effect.promise(() => screen.getByRole("link", { name: "Tech", exact: true }).first().click())
      yield* Effect.promise(() => screen.getByRole("link", { name: "All errors" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Errors" })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("No errors in this period.")).toBeVisible())
      assert.deepStrictEqual(environmentsAsked("errors"), ["staging"])

      // Another project, and back: Notes's Tech still shows staging, though its address doesn't say so.
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
      assert.strictEqual(window.location.pathname, "/projects/notes")
      yield* Effect.promise(() => screen.getByRole("link", { name: "Tech", exact: true }).first().click())
      assert.strictEqual(window.location.pathname, "/projects/notes/tech")
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("group", { name: "Environment" }).getByRole("button", { name: "staging" }))
          .toHaveAttribute("aria-pressed", "true"),
      )
      yield* Effect.promise(() => expect.poll(() => lastAsked("logs")).toBe("staging"))
      yield* expectAccessible()
    }),
  )

  it.effect("says the one environment as text, not a switch, and asks there", () =>
    Effect.gen(function* () {
      // Production is the one its telemetry named, and no deploy target goes elsewhere.
      answerApi(notesApi({ seen: [EnvironmentKey.make("production")], linked: new Map() }))
      window.history.pushState(null, "", "/projects/notes/logs")
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
      window.history.pushState(null, "", "/projects/notes/logs")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("Warnings and errors over time")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(screen.getByText("Environment", { exact: true })).not.toBeInTheDocument(),
      )
      assert.deepStrictEqual(environmentsAsked("logs"), [null])
      yield* Effect.promise(() => screen.getByRole("link", { name: "Tech", exact: true }).first().click())
      yield* Effect.promise(() => expect.element(screen.getByRole("region", { name: "Requests" })).toBeVisible())
      // Without settings, there is no production to choose.
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "Production" })).not.toBeInTheDocument(),
      )
    }),
  )

  it.effect("keeps a release and its environment from its page to an error, a trace, and an operation", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", `/projects/notes/releases/notes-api/${worse}?environment=production`)
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => screen.getByRole("link", { name: "Errors of this release" }).click())
      yield* Effect.promise(() => screen.getByRole("link", { name: /NpgsqlException/ }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "NpgsqlException" })).toBeVisible(),
      )
      assert.strictEqual(window.location.search, `?component=notes-api&environment=production&release=${worse}`)
      yield* Effect.promise(() => expect.element(screen.getByRole("link", { name: worse, exact: true })).toBeVisible())
      const asked = apiCalls().filter((call) => call.path[2] === "errors" && call.path.length === 4)
      assert.deepStrictEqual(
        asked.map((call) => [call.query.get("environment"), call.query.get("release")]),
        [["production", worse]],
      )
      yield* expectAccessible()

      // An occurrence is one thing, with no filters; its trace keeps the occurrence's own environment
      // and release, and the way back keeps them too.
      yield* Effect.promise(() => screen.getByRole("link", { name: "Open this occurrence" }).click())
      assert.strictEqual(window.location.search, "")
      yield* Effect.promise(() => screen.getByRole("link", { name: "Open the trace" }).click())
      yield* Effect.promise(() => expect.element(screen.getByText("INSERT exports")).toBeVisible())
      assert.include(window.location.search, `environment=production&release=${worse}`)
      // The way back is to the request's operation, then to every operation, each keeping them.
      yield* Effect.promise(() => screen.getByRole("link", { name: "Back to its operation" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: /\/api\/export/ })).toBeVisible(),
      )
      assert.strictEqual(window.location.search, `?component=notes-api&environment=production&release=${worse}`)
      yield* Effect.promise(() => screen.getByRole("link", { name: "Back to every operation" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Performance" })).toBeVisible(),
      )
      assert.strictEqual(window.location.search, `?component=notes-api&environment=production&release=${worse}`)
      yield* Effect.promise(() => expect.element(screen.getByRole("link", { name: worse })).toBeVisible())
    }),
  )

  it.effect("chooses production from Tech, with the API's rule for a key and a failed save said", () =>
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
      window.history.pushState(null, "", "/projects/notes/tech")
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
      window.history.pushState(
        null,
        "",
        `/projects/notes/errors?component=notes-api&environment=production&release=${worse}`,
      )
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("NpgsqlException").first()).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* expectAccessible()
      yield* Effect.promise(() => page.viewport(1280, 900))
    }),
  )
})
