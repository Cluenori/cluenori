import { ComponentKey, EnvironmentKey, ReleaseVersion } from "@cluenori/foundation"
import { PromotionId } from "@cluenori/releases"
import { assert, describe, expect, it } from "@effect/vitest"
import { DateTime, Effect } from "effect"
import { render } from "vitest-browser-react"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi, apiCalls } from "./fake-api.ts"
import { iosWithThreeApps, notesApi, repositoryOf, workflowFile } from "./notes-project.ts"

// The bodies of the promotions of a component's newest commit asked for, oldest first.
const promotedLatest = (component: string) =>
  apiCalls()
    .filter(
      (call) => call.method === "POST" && call.path.join("/") === `projects/notes/components/${component}/promotions`,
    )
    .map((call) => call.body)

describe("promote latest journey", () => {
  it.effect("builds a component's newest commit for its first environment, numbered as its next release", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/notes/releases?component=notes-api")
      const screen = yield* Effect.promise(() => render(<App />))

      // Staging, the API's first environment, takes the latest commit next.
      const api = screen.getByRole("region", { name: "notes-api" })
      const staging = api.getByRole("listitem", { name: "staging" })
      yield* Effect.promise(() => staging.getByRole("button", { name: "Build the latest commit for staging" }).click())
      const dialog = screen.getByRole("dialog", { name: "Build notes-api's latest commit?" })
      // What it becomes, and where it goes: the environment it was asked for.
      yield* Effect.promise(() => expect.element(dialog.getByText("1.4.0+58")).toBeVisible())
      const environment = dialog.getByRole("group", { name: "Environment" })
      yield* Effect.promise(() =>
        expect.element(environment.getByRole("button", { name: "staging" })).toHaveAttribute("aria-pressed", "true"),
      )
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByRole("listitem"))
          .toMatchTextContent("Runs promote-to-staging.yml in notesapp/notes-api"),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Options" }).click())
      yield* Effect.promise(() =>
        dialog.getByRole("group", { name: "Where the workflow runs" }).getByRole("button", { name: "Cloud" }).click(),
      )

      // A commit that isn't a full SHA is refused before anything is sent; empty, it is the newest.
      const build = dialog.getByRole("button", { name: "Build and promote to staging" })
      yield* Effect.promise(() => dialog.getByLabelText("Commit").fill("5d2e8a7"))
      yield* Effect.promise(() => build.click())
      yield* Effect.promise(() => expect.element(dialog.getByText(/^Expected a full commit SHA/)).toBeVisible())
      assert.deepStrictEqual(promotedLatest("notes-api"), [])
      yield* Effect.promise(() => dialog.getByLabelText("Commit").fill(""))
      yield* Effect.promise(() => build.click())

      // It closes, and staging shows the promotion going there, as Cluenori numbered it.
      yield* Effect.promise(() => expect.element(dialog).not.toBeInTheDocument())
      yield* Effect.promise(() => expect.element(staging.getByText("Starting")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(staging.getByRole("button", { name: /^Build the latest commit/ })).not.toBeInTheDocument(),
      )
      assert.deepStrictEqual(promotedLatest("notes-api"), ['{"environment":"staging","runner":"cloud"}'])
      // The next build is the one after.
      yield* Effect.promise(() => expect.element(api.getByText("1.4.0+59")).toBeVisible())
      yield* expectAccessible()

      // Its release's page, a click away, in the environment it goes to, has the promotion by you.
      yield* Effect.promise(() => staging.getByRole("link", { name: "1.4.0+58" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "1.4.0+58" })).toBeVisible(),
      )
      assert.strictEqual(window.location.pathname, "/notes/releases/notes-api/1.4.0%2B58")
      assert.strictEqual(new URLSearchParams(window.location.search).get("environment"), "staging")
      const row = screen.getByRole("region", { name: "Promotions" }).getByRole("listitem").first()
      yield* Effect.promise(() => expect.element(row.getByText("Starting")).toBeVisible())
      yield* Effect.promise(() => expect.element(row.getByText(/by you/)).toBeVisible())
      yield* expectAccessible()
    }),
  )

  it.effect("says a component's version isn't set, one click from setting it", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ linked: iosWithThreeApps }))
      window.history.pushState(null, "", "/notes/releases?component=notes-ios")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() =>
        screen
          .getByRole("region", { name: "notes-ios" })
          .getByRole("button", { name: "Build the latest commit for internal" })
          .click(),
      )
      const dialog = screen.getByRole("dialog", { name: "Build notes-ios's latest commit?" })
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByRole("group", { name: "Environment" }).getByRole("button", { name: "internal" }))
          .toHaveAttribute("aria-pressed", "true"),
      )
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Build and promote to internal" }).click())
      const refusal = dialog.getByRole("alert")
      yield* Effect.promise(() =>
        expect
          .element(refusal)
          .toMatchTextContent("notes-ios has no version yet: set it, and its builds are numbered in it."),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => refusal.getByRole("button", { name: "Set the version" }).click())
      yield* Effect.promise(() => expect.element(dialog).not.toBeInTheDocument())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("dialog", { name: "notes-ios's version" })).toBeVisible(),
      )
      yield* expectAccessible()
    }),
  )

  it.effect("shows a promotion running to an environment, and says so when it is promoted to again", () =>
    Effect.gen(function* () {
      const running = {
        id: PromotionId.make("019a1000-0000-7000-8000-000000000031"),
        component: ComponentKey.make("notes-api"),
        release: ReleaseVersion.make("1.4.0+57"),
        environment: EnvironmentKey.make("production"),
        repository: repositoryOf("notesapp/notes-api"),
        workflow: workflowFile("promote-to-prod.yml"),
        runner: "auto" as const,
        state: "running" as const,
        run: { id: 9_401, url: "https://github.com/notesapp/notes-api/actions/runs/9401" },
      }
      answerApi(notesApi({ seeded: (now) => [{ ...running, startedAt: DateTime.makeUnsafe(now - 4 * 60_000) }] }))
      window.history.pushState(null, "", "/notes/releases?component=notes-api")
      const screen = yield* Effect.promise(() => render(<App />))

      // Production shows it going there, with its run.
      const api = screen.getByRole("region", { name: "notes-api" })
      const production = api.getByRole("listitem", { name: "production" })
      yield* Effect.promise(() => expect.element(production.getByText("Running")).toBeVisible())
      yield* Effect.promise(() =>
        expect
          .element(production.getByRole("link", { name: "Run on GitHub of the promotion to production" }))
          .toHaveAttribute("href", "https://github.com/notesapp/notes-api/actions/runs/9401"),
      )
      yield* expectAccessible()

      // Building for production meanwhile is refused, with the run that holds it.
      yield* Effect.promise(() => api.getByRole("button", { name: "Build the latest commit for staging" }).click())
      const dialog = screen.getByRole("dialog", { name: "Build notes-api's latest commit?" })
      yield* Effect.promise(() =>
        dialog.getByRole("group", { name: "Environment" }).getByRole("button", { name: "production" }).click(),
      )
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Build and promote to production" }).click())
      yield* Effect.promise(() =>
        expect.element(dialog.getByRole("alert")).toMatchTextContent("Already promoting 1.4.0+57 to production."),
      )
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByRole("link", { name: "Its run on GitHub" }))
          .toHaveAttribute("href", "https://github.com/notesapp/notes-api/actions/runs/9401"),
      )
      // Nothing was numbered: the next build is the same.
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Cancel" }).click())
      yield* Effect.promise(() => expect.element(api.getByText("1.4.0+58")).toBeVisible())
      yield* expectAccessible()
    }),
  )
})
