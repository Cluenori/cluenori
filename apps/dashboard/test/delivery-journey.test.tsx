import { EnvironmentKey } from "@cluenori/foundation"
import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"
import type { Locator } from "vitest/browser"
import { page } from "vitest/browser"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi, apiCalls } from "./fake-api.ts"
import { firstNumberedDay, notesApi } from "./notes-project.ts"

const dated = "2026.10.21-e91f09c"

// Opens another address, as following a link from elsewhere does.
const open = (address: string) => {
  window.history.pushState(null, "", address)
  window.dispatchEvent(new PopStateEvent("popstate"))
}

// One environment of a component's delivery, in its block.
const stageOf = (block: Locator, component: string, environment: string) =>
  block
    .getByRole("list", { name: `Environments of ${component}` })
    .getByRole("listitem", { name: environment, exact: true })

// The promotions the dashboard asked for, as the path of the release and the body, oldest first.
const promoted = () =>
  apiCalls()
    .filter((call) => call.method === "POST" && call.path.at(-1) === "promotions")
    .map((call) => [call.path.slice(3).join("/"), call.body])

// The links the dashboard saved, by component, oldest first.
const linksSaved = () =>
  apiCalls()
    .filter((call) => call.method === "PUT" && call.path.at(-1) === "links")
    .map((call) => [call.path[3], call.body])

describe("delivery journey", () => {
  it.effect("shows what runs in each environment of each component, and the one next step", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ world: firstNumberedDay }))
      window.history.pushState(null, "", "/notes/releases")
      const screen = yield* Effect.promise(() => render(<App />))

      // The API goes to dev, then prod: in the order releases go.
      const delivery = screen.getByRole("region", { name: "Delivery" })
      const api = delivery.getByRole("region", { name: "notes-api" })
      yield* Effect.promise(() =>
        expect
          .element(api.getByRole("list", { name: "Environments of notes-api" }).getByRole("listitem"))
          .toHaveLength(2),
      )
      assert.deepStrictEqual(
        api
          .getByRole("list", { name: "Environments of notes-api" })
          .getByRole("listitem")
          .elements()
          .map((stage) => stage.getAttribute("aria-label")),
        ["dev", "prod"],
      )

      // Dev runs the first numbered release, built from its commit, too early to judge; its next step
      // is building the latest commit.
      const dev = stageOf(api, "notes-api", "dev")
      yield* Effect.promise(() =>
        expect
          .element(dev.getByRole("link", { name: "1.0.0+1 of notes-api in dev" }))
          .toHaveAttribute("href", "/notes/releases/notes-api/1.0.0%2B1?environment=dev"),
      )
      yield* Effect.promise(() => expect.element(dev.getByText(/^For .+, since .+$/)).toBeVisible())
      yield* Effect.promise(() => expect.element(dev.getByText("Open shared notes offline (#218)")).toBeVisible())
      yield* Effect.promise(() => expect.element(dev.getByText("Too early to tell")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(dev.getByRole("button", { name: "Build the latest commit for dev" })).toBeVisible(),
      )

      // Prod, production, still runs the dated release; its next step is what dev has.
      const prod = stageOf(api, "notes-api", "prod")
      yield* Effect.promise(() => expect.element(prod.getByText("Production", { exact: true })).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(prod.getByRole("link", { name: `${dated} of notes-api in prod` })).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect.element(prod.getByText("Worse: 1 slower, 1 fails more, 1 new error")).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(prod.getByRole("button")).toHaveLength(1))
      yield* Effect.promise(() =>
        expect.element(prod.getByRole("button", { name: "Promote 1.0.0+1 from dev to prod" })).toBeVisible(),
      )
      // Its version, and the release the next build will be.
      yield* Effect.promise(() => expect.element(api.getByText("1.0.0+2")).toBeVisible())

      // The iPhone app goes to internal testers, beta testers, then the App Store: each with its build,
      // where it stands, and what can go there next; the App Store has a promotion under way.
      const ios = delivery.getByRole("region", { name: "notes-ios" })
      const internal = stageOf(ios, "notes-ios", "internal")
      yield* Effect.promise(() => expect.element(internal.getByText("ios.yml, then TestFlight")).toBeVisible())
      yield* Effect.promise(() => expect.element(internal.getByText("In TestFlight")).toBeVisible())
      yield* Effect.promise(() => expect.element(internal.getByText("No telemetry yet")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(internal.getByRole("button", { name: "Build the latest commit for internal" })).toBeVisible(),
      )
      // Beta's last promotion failed and nothing came since: it says so, with its run, and offers the
      // same next step again.
      const beta = stageOf(ios, "notes-ios", "beta")
      yield* Effect.promise(() => expect.element(beta.getByText("Promoting 1.9.0+422 to beta failed")).toBeVisible())
      yield* Effect.promise(() =>
        expect
          .element(beta.getByRole("link", { name: "Run on GitHub of the promotion to beta" }))
          .toHaveAttribute("href", "https://github.com/notesapp/notes-ios/actions/runs/9340"),
      )
      yield* Effect.promise(() =>
        expect.element(beta.getByRole("button", { name: "Promote 1.9.0+422 from internal to beta" })).toBeVisible(),
      )
      const production = stageOf(ios, "notes-ios", "production")
      yield* Effect.promise(() => expect.element(production.getByText("Phased release, day 3 of 7")).toBeVisible())
      yield* Effect.promise(() => expect.element(production.getByText("Promoting 1.9.0+421 here")).toBeVisible())
      yield* Effect.promise(() => expect.element(production.getByText("In App Store review")).toBeVisible())
      yield* Effect.promise(() =>
        expect
          .element(production.getByRole("link", { name: "Run on GitHub of the promotion to production" }))
          .toHaveAttribute("href", "https://github.com/notesapp/notes-ios/actions/runs/9330"),
      )
      // While it runs, nothing else can go there.
      yield* Effect.promise(() => expect.element(production.getByRole("button")).not.toBeInTheDocument())
      yield* expectAccessible()

      // Below, the history of the environment the page shows.
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("region", { name: "Release history" }).getByText(/^Every component in prod, /))
          .toBeVisible(),
      )
    }),
  )

  it.effect("promotes a release from its environment's next step, and shows the promotion going there", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ world: firstNumberedDay }))
      window.history.pushState(null, "", "/notes/releases")
      const screen = yield* Effect.promise(() => render(<App />))

      const api = screen.getByRole("region", { name: "notes-api" })
      const prod = stageOf(api, "notes-api", "prod")
      yield* Effect.promise(() => prod.getByRole("button", { name: "Promote 1.0.0+1 from dev to prod" }).click())

      // The confirmation says what it runs, and what it replaces there.
      const dialog = screen.getByRole("dialog", { name: "Promote 1.0.0+1 to prod?" })
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByRole("listitem"))
          .toHaveTextContent(
            "Runs deploy.yml in notesapp/notes-api on GitHub, with release 1.0.0+1 and environment prod.",
          ),
      )
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByText(new RegExp(`^prod runs ${dated} now, since .+: this replaces it\\.$`)))
          .toBeVisible(),
      )
      // Where the workflow runs is folded away, Auto unless chosen.
      yield* Effect.promise(() =>
        expect.element(dialog.getByRole("button", { name: "Options" })).toHaveAttribute("aria-expanded", "false"),
      )
      yield* Effect.promise(() =>
        expect.element(dialog.getByRole("group", { name: "Where the workflow runs" })).not.toBeInTheDocument(),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => dialog.getByLabelText("Reason").fill("Offline notes for everyone"))
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Promote 1.0.0+1 to prod" }).click())

      // It closes; prod shows it going there, and has no next step while it does.
      yield* Effect.promise(() => expect.element(dialog).not.toBeInTheDocument())
      yield* Effect.promise(() => expect.element(prod.getByText("Promoting 1.0.0+1 here")).toBeVisible())
      yield* Effect.promise(() => expect.element(prod.getByText("Starting")).toBeVisible())
      yield* Effect.promise(() => expect.element(prod.getByRole("button")).not.toBeInTheDocument())
      assert.deepStrictEqual(promoted(), [
        [
          "notes-api/1.0.0+1/promotions",
          '{"environment":"prod","reason":"Offline notes for everyone","runner":"auto"}',
        ],
      ])
      yield* expectAccessible()

      // Building the latest commit for dev asks what to build, there.
      yield* Effect.promise(() =>
        stageOf(api, "notes-api", "dev").getByRole("button", { name: "Build the latest commit for dev" }).click(),
      )
      const build = screen.getByRole("dialog", { name: "Build notes-api's latest commit?" })
      yield* Effect.promise(() => expect.element(build.getByText("1.0.0+2")).toBeVisible())
      yield* Effect.promise(() =>
        expect
          .element(build.getByRole("group", { name: "Environment" }).getByRole("button", { name: "dev" }))
          .toHaveAttribute("aria-pressed", "true"),
      )
      yield* expectAccessible()
    }),
  )

  it.effect("nests a component that ships with another inside it, with nothing to do of its own", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ world: firstNumberedDay }))
      window.history.pushState(null, "", "/notes/releases")
      const screen = yield* Effect.promise(() => render(<App />))

      // The worker is inside the API's block, not a block of its own.
      const delivery = screen.getByRole("region", { name: "Delivery" })
      const worker = delivery.getByRole("region", { name: "notes-api" }).getByRole("region", { name: "notes-worker" })
      yield* Effect.promise(() =>
        expect
          .element(worker.getByText("Ships with notes-api: its deploys deploy it, with the same release"))
          .toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect
          .element(
            worker.getByRole("listitem", { name: "dev" }).getByRole("link", { name: "1.0.0+1 of notes-worker in dev" }),
          )
          .toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect
          .element(
            worker
              .getByRole("listitem", { name: "prod" })
              .getByRole("link", { name: `${dated} of notes-worker in prod` }),
          )
          .toBeVisible(),
      )
      // No next step, no version: only its links.
      yield* Effect.promise(() => expect.element(worker.getByRole("button")).toHaveLength(1))
      yield* Effect.promise(() =>
        expect.element(worker.getByRole("button", { name: "Change links of notes-worker" })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(worker.getByText(/^Version/)).not.toBeInTheDocument())
      yield* expectAccessible()

      // The worker alone is shown in the API's block too.
      yield* Effect.promise(() => screen.getByRole("button", { name: "notes-worker", exact: true }).click())
      yield* Effect.promise(() =>
        expect.element(delivery.getByRole("region", { name: "notes-ios" })).not.toBeInTheDocument(),
      )
      yield* Effect.promise(() =>
        expect
          .element(delivery.getByRole("region", { name: "notes-api" }).getByRole("region", { name: "notes-worker" }))
          .toBeVisible(),
      )
    }),
  )

  it.effect("keeps the component a component ships with when its links are saved, and sets it", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ world: firstNumberedDay }))
      window.history.pushState(null, "", "/notes/releases")
      const screen = yield* Effect.promise(() => render(<App />))

      // The worker ships with the API: no deploy targets of its own, and saving keeps it so.
      yield* Effect.promise(() => screen.getByRole("button", { name: "Change links of notes-worker" }).click())
      const dialog = screen.getByRole("dialog", { name: "Where notes-worker's releases come from" })
      const shipsWith = dialog.getByRole("group", { name: "Ships with" })
      yield* Effect.promise(() =>
        expect.element(shipsWith.getByRole("button", { name: "notes-api" })).toHaveAttribute("aria-pressed", "true"),
      )
      yield* Effect.promise(() =>
        expect.element(dialog.getByRole("group", { name: "Deploy targets" })).not.toBeInTheDocument(),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => dialog.getByLabelText("GitHub repository").fill("notesapp/notes-worker"))
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Save the links" }).click())
      yield* Effect.promise(() => expect.element(dialog).not.toBeInTheDocument())
      assert.deepStrictEqual(linksSaved(), [
        ["notes-worker", '{"repository":"notesapp/notes-worker","shipsWith":"notes-api"}'],
      ])

      // Shipping with nothing, it stands alone: where it ran, with deploy targets of its own to add.
      yield* Effect.promise(() => screen.getByRole("button", { name: "Change links of notes-worker" }).click())
      const again = screen.getByRole("dialog", { name: "Where notes-worker's releases come from" })
      yield* Effect.promise(() =>
        again.getByRole("group", { name: "Ships with" }).getByRole("button", { name: "None" }).click(),
      )
      yield* Effect.promise(() => expect.element(again.getByRole("group", { name: "Deploy targets" })).toBeVisible())
      yield* Effect.promise(() => again.getByRole("button", { name: "Save the links" }).click())
      yield* Effect.promise(() => expect.element(again).not.toBeInTheDocument())
      const delivery = screen.getByRole("region", { name: "Delivery" })
      const alone = delivery.getByRole("region", { name: "notes-worker" })
      yield* Effect.promise(() =>
        expect.element(alone.getByText(/^No deploy targets, so these are where it ran/)).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect
          .element(delivery.getByRole("region", { name: "notes-api" }).getByRole("region", { name: "notes-worker" }))
          .not.toBeInTheDocument(),
      )

      // Set to ship with the API again, it goes back inside the API's block. The API can't ship with
      // it in turn: its dialog doesn't offer the worker.
      yield* Effect.promise(() => alone.getByRole("button", { name: "Change links of notes-worker" }).click())
      const third = screen.getByRole("dialog", { name: "Where notes-worker's releases come from" })
      yield* Effect.promise(() =>
        third.getByRole("group", { name: "Ships with" }).getByRole("button", { name: "notes-api" }).click(),
      )
      yield* Effect.promise(() => third.getByRole("button", { name: "Save the links" }).click())
      yield* Effect.promise(() => expect.element(third).not.toBeInTheDocument())
      yield* Effect.promise(() =>
        expect
          .element(delivery.getByRole("region", { name: "notes-api" }).getByRole("region", { name: "notes-worker" }))
          .toBeVisible(),
      )
      assert.deepStrictEqual(linksSaved().slice(1), [
        ["notes-worker", '{"repository":"notesapp/notes-worker"}'],
        ["notes-worker", '{"repository":"notesapp/notes-worker","shipsWith":"notes-api"}'],
      ])
      yield* Effect.promise(() =>
        screen
          .getByRole("region", { name: "notes-api" })
          .getByRole("button", { name: "Change links of notes-api" })
          .click(),
      )
      const ofApi = screen.getByRole("dialog", { name: "Where notes-api's releases come from" })
      assert.deepStrictEqual(
        ofApi
          .getByRole("group", { name: "Ships with" })
          .getByRole("button")
          .elements()
          .map((option) => option.textContent),
        ["None", "notes-ios"],
      )
      yield* expectAccessible()
    }),
  )

  it.effect("says on a release's page where it runs now, its one next step, and promoting it elsewhere", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ world: firstNumberedDay }))
      window.history.pushState(null, "", "/notes/releases/notes-api/1.0.0%2B1?environment=dev")
      const screen = yield* Effect.promise(() => render(<App />))

      // What it is, and where it runs: in dev, not in prod yet.
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "1.0.0+1" })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByRole("link", { name: "b8e4f1a on GitHub" })).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText(/^In dev since .+ · not in prod yet$/)).toBeVisible())
      // One primary action, its next step; promoting it elsewhere is a choice.
      const next = screen.getByRole("button", { name: "Promote 1.0.0+1 from dev to prod" })
      yield* Effect.promise(() => expect.element(next).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("button", { name: "Promote to another environment" })).toBeVisible(),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => next.click())
      const dialog = screen.getByRole("dialog", { name: "Promote 1.0.0+1 to prod?" })
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByText(new RegExp(`^prod runs ${dated} now, since .+: this replaces it\\.$`)))
          .toBeVisible(),
      )
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Cancel" }).click())

      // The release prod runs: dev has moved on, so nothing's next step is it. Promoting it to dev is
      // a rollback there, which the confirmation says it is.
      open(`/notes/releases/notes-api/${dated}?environment=prod`)
      yield* Effect.promise(() =>
        expect.element(screen.getByText(/^In prod since .+ · dev runs 1\.0\.0\+1$/)).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("button", { name: / from .+ to / })).not.toBeInTheDocument(),
      )
      yield* Effect.promise(() => screen.getByRole("button", { name: "Promote to an environment" }).click())
      yield* Effect.promise(() => page.getByRole("menuitem", { name: "dev runs 1.0.0+1 now" }).click())
      const back = screen.getByRole("dialog", { name: `Promote ${dated} to dev?` })
      yield* Effect.promise(() =>
        expect.element(back.getByText(/^dev runs 1\.0\.0\+1 now, since .+: this replaces it\.$/)).toBeVisible(),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => back.getByRole("button", { name: `Promote ${dated} to dev` }).click())
      yield* Effect.promise(() => expect.element(back).not.toBeInTheDocument())
      yield* Effect.promise(() =>
        expect.element(screen.getByText(/^In prod since .+ · going to dev: Starting$/)).toBeVisible(),
      )
      assert.deepStrictEqual(promoted(), [[`notes-api/${dated}/promotions`, '{"environment":"dev","runner":"auto"}']])

      // The worker's release ships with the API's: nothing to promote of its own.
      open("/notes/releases/notes-worker/1.0.0%2B1?environment=dev")
      yield* Effect.promise(() =>
        expect.element(screen.getByText("Ships with notes-api: its deploys deploy this release too.")).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("link", { name: "Open notes-api 1.0.0+1" }))
          .toHaveAttribute("href", "/notes/releases/notes-api/1.0.0%2B1?environment=dev"),
      )
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("button", { name: /^Promote/ })).not.toBeInTheDocument(),
      )
      yield* expectAccessible()
    }),
  )

  it.effect("offers the environments deploy targets go to, beside those telemetry named, as what the page shows", () =>
    Effect.gen(function* () {
      // Lately only prod's telemetry arrived.
      answerApi(notesApi({ world: firstNumberedDay, seen: [EnvironmentKey.make("prod")] }))
      window.history.pushState(null, "", "/notes/releases")
      const screen = yield* Effect.promise(() => render(<App />))

      const environments = screen.getByRole("group", { name: "Environment" })
      yield* Effect.promise(() =>
        expect
          .element(environments.getByRole("button", { name: "prod", exact: true }))
          .toHaveAttribute("aria-pressed", "true"),
      )
      assert.deepStrictEqual(
        environments
          .getByRole("button")
          .elements()
          .map((option) => option.textContent),
        ["prod", "dev", "internal", "beta", "production"],
      )
      yield* expectAccessible()

      // Internal testers' environment: the history shows its build; the delivery still shows every one.
      yield* Effect.promise(() => environments.getByRole("button", { name: "internal" }).click())
      assert.strictEqual(window.location.search, "?environment=internal")
      const history = screen.getByRole("region", { name: "Release history" })
      yield* Effect.promise(() => expect.element(history.getByRole("listitem")).toHaveLength(1))
      yield* Effect.promise(() => expect.element(history.getByText("1.9.0+422")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(stageOf(screen.getByRole("region", { name: "notes-api" }), "notes-api", "prod")).toBeVisible(),
      )
    }),
  )

  it.effect("fits a phone: each component's environments stacked, and a release's header", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ world: firstNumberedDay }))
      yield* Effect.promise(() => page.viewport(390, 844))
      window.history.pushState(null, "", "/notes/releases")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() =>
        expect.element(screen.getByRole("button", { name: "Promote 1.0.0+1 from dev to prod" })).toBeVisible(),
      )
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* expectAccessible()
      open("/notes/releases/notes-api/1.0.0%2B1?environment=dev")
      yield* Effect.promise(() => expect.element(screen.getByText(/^In dev since .+ · not in prod yet$/)).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* expectAccessible()
      yield* Effect.promise(() => page.viewport(1280, 900))
    }),
  )
})
