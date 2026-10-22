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
  it.effect("promotes a component's newest commit, numbered as its next release, and opens that release", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/notes/releases?component=notes-api")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() =>
        screen
          .getByRole("region", { name: "Where releases come from" })
          .getByRole("button", { name: "Promote latest… of notes-api" })
          .click(),
      )
      const dialog = screen.getByRole("dialog", { name: "Promote notes-api's latest commit?" })
      // What it becomes, and where it goes: the first target unless another is chosen.
      yield* Effect.promise(() => expect.element(dialog.getByText("1.4.0+58")).toBeVisible())
      const environment = dialog.getByRole("group", { name: "Environment" })
      yield* Effect.promise(() =>
        expect.element(environment.getByRole("button", { name: "production" })).toHaveAttribute("aria-pressed", "true"),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => environment.getByRole("button", { name: "staging" }).click())
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByRole("listitem"))
          .toMatchTextContent("Runs promote-to-staging.yml in notesapp/notes-api"),
      )
      yield* Effect.promise(() =>
        dialog.getByRole("group", { name: "Where the workflow runs" }).getByRole("button", { name: "Cloud" }).click(),
      )

      // A commit that isn't a full SHA is refused before anything is sent; empty, it is the newest.
      yield* Effect.promise(() => dialog.getByLabelText("Commit").fill("5d2e8a7"))
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Promote", exact: true }).click())
      yield* Effect.promise(() => expect.element(dialog.getByText(/^Expected a full commit SHA/)).toBeVisible())
      assert.deepStrictEqual(promotedLatest("notes-api"), [])
      yield* Effect.promise(() => dialog.getByLabelText("Commit").fill(""))
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Promote", exact: true }).click())

      // Its release's page, where the promotion shows.
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "1.4.0+58" })).toBeVisible(),
      )
      assert.strictEqual(window.location.pathname, "/notes/releases/notes-api/1.4.0%2B58")
      // In the environment it is going to, compared with the release there now.
      assert.strictEqual(new URLSearchParams(window.location.search).get("environment"), "staging")
      const row = screen.getByRole("region", { name: "Promotions" }).getByRole("listitem").first()
      yield* Effect.promise(() => expect.element(row.getByText("Starting")).toBeVisible())
      yield* Effect.promise(() => expect.element(row.getByText("staging", { exact: true })).toBeVisible())
      yield* Effect.promise(() => expect.element(row.getByText(/by you/)).toBeVisible())
      assert.deepStrictEqual(promotedLatest("notes-api"), ['{"environment":"staging","runner":"cloud"}'])
      yield* expectAccessible()
    }),
  )

  it.effect("says a component's version isn't set, one click from the versions", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ linked: iosWithThreeApps }))
      window.history.pushState(null, "", "/notes/releases?component=notes-ios")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => screen.getByRole("button", { name: "Promote latest… of notes-ios" }).click())
      const dialog = screen.getByRole("dialog", { name: "Promote notes-ios's latest commit?" })
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByRole("group", { name: "Environment" }).getByRole("button", { name: "internal" }))
          .toHaveAttribute("aria-pressed", "true"),
      )
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Promote", exact: true }).click())
      const refusal = dialog.getByRole("alert")
      yield* Effect.promise(() =>
        expect
          .element(refusal)
          .toMatchTextContent("notes-ios has no version yet: set it, and its builds are numbered in it."),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => refusal.getByRole("button", { name: "Set the version" }).click())
      yield* Effect.promise(() => expect.element(dialog).not.toBeInTheDocument())
      yield* Effect.promise(() => expect.poll(() => document.activeElement?.id).toBe("versions"))
      yield* Effect.promise(() =>
        expect
          .element(
            screen.getByRole("region", { name: "Versions" }).getByText("Set a version to let CI number its builds."),
          )
          .toBeVisible(),
      )
    }),
  )

  it.effect("says the environment is being promoted to already, with its run", () =>
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

      yield* Effect.promise(() => screen.getByRole("button", { name: "Promote latest… of notes-api" }).click())
      const dialog = screen.getByRole("dialog", { name: "Promote notes-api's latest commit?" })
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Promote", exact: true }).click())
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
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "Versions" }).getByText("1.4.0+58")).toBeVisible(),
      )
      yield* expectAccessible()
    }),
  )
})
