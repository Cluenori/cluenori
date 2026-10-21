import { ReleaseList } from "@cluenori/releases"
import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"
import { page } from "vitest/browser"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi, apiCalls, reply } from "./fake-api.ts"
import { appRelease, notesApi } from "./notes-project.ts"

describe("releases journey", () => {
  it.effect("leads from the overview's latest releases to the one that got worse, and what did", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/notes")
      const screen = yield* Effect.promise(() => render(<App />))

      // The overview names the latest releases, each with its verdict in words.
      const latest = screen.getByRole("region", { name: "Releases" })
      yield* Effect.promise(() =>
        expect.element(latest.getByText("Worse: 1 slower, 1 fails more, 1 new error")).toBeVisible(),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => latest.getByRole("link", { name: "Open" }).click())

      // Every release of the period, the latest first: when it ran, how much, and against the one before.
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Releases" })).toBeVisible(),
      )
      const list = screen.getByRole("region", { name: "Releases of every component" })
      yield* Effect.promise(() => expect.element(list.getByRole("link")).toHaveLength(5))
      yield* Effect.promise(() => expect.element(list.getByText("Better")).toBeVisible())
      yield* Effect.promise(() => expect.element(list.getByText("Too early to tell").first()).toBeVisible())
      yield* Effect.promise(() => expect.element(list.getByText("First release counted").first()).toBeVisible())
      yield* expectAccessible()

      // One component's releases, by one click.
      yield* Effect.promise(() => screen.getByRole("button", { name: "notes-ios" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "Releases of notes-ios" }).getByRole("link")).toHaveLength(2),
      )
      yield* Effect.promise(() => screen.getByRole("button", { name: "All" }).click())

      // The release that got worse, in production, against the release before it.
      yield* Effect.promise(() =>
        screen
          .getByRole("region", { name: "Releases of every component" })
          .getByRole("link", { name: /^2026\.10\.21-e91f09c notes-api, production/ })
          .click(),
      )
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "2026.10.21-e91f09c" })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("Against 2026.10.20-7b2c4d1")).toBeVisible())
      const slower = screen.getByRole("region", { name: "Slower" })
      yield* Effect.promise(() => expect.element(slower.getByText("620 ms")).toBeVisible())
      yield* Effect.promise(() => expect.element(slower.getByText("was 290 ms")).toBeVisible())
      const failing = screen.getByRole("region", { name: "Fails more" })
      yield* Effect.promise(() => expect.element(failing.getByText(/3[.,]2/)).toBeVisible())
      yield* Effect.promise(() => expect.element(failing.getByText(/was %?0[.,]4/)).toBeVisible())
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("region", { name: "Incidents while it ran" }).getByText(/, opened .*, resolved /))
          .toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByRole("region", { name: "Faster" })).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "New operations" }).getByText(/share$/)).toBeVisible(),
      )
      // A part with nothing in it isn't shown.
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "Fails less" })).not.toBeInTheDocument(),
      )
      yield* expectAccessible()

      // Its new error opens the error's page.
      yield* Effect.promise(() =>
        screen
          .getByRole("region", { name: "New errors" })
          .getByRole("link", { name: /TimeoutException/ })
          .click(),
      )
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "TimeoutException" })).toBeVisible(),
      )
    }),
  )

  it.effect("asks for a release by its version and environment, and opens the release before it in one click", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(
        null,
        "",
        `/notes/releases/notes-ios/${encodeURIComponent(appRelease)}?environment=production`,
      )
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("notes-ios, production")).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText("Too early to tell")).toBeVisible())
      const asked = apiCalls().filter((call) => call.path[2] === "releases")
      assert.deepStrictEqual(
        asked.map((call) => [call.path.slice(3).join("/"), call.query.get("environment")]),
        [[`notes-ios/${appRelease}`, "production"]],
      )

      yield* Effect.promise(() => screen.getByRole("link", { name: "Open the release before" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "1.8.1+398" })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("First release counted")).toBeVisible())
    }),
  )

  it.effect("says when releases appear, when there are none yet", () =>
    Effect.gen(function* () {
      const notes = notesApi()
      answerApi((call) =>
        call.path[2] === "releases" && call.path.length === 3 ? reply(ReleaseList, { releases: [] }) : notes(call),
      )
      window.history.pushState(null, "", "/notes/releases")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() =>
        expect
          .element(screen.getByText(/^No releases in this period: a release appears once a service reports/))
          .toBeVisible(),
      )
      // Data arrives; it says no version.
      yield* Effect.promise(() => expect.element(screen.getByText(/^Receiving data, latest at/)).toBeVisible())
      yield* expectAccessible()
    }),
  )

  it.effect("says a release it never counted isn't there, with a way back", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/notes/releases/notes-api/0.9.0")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("There is no such release")).toBeVisible())
      yield* expectAccessible()
      yield* Effect.promise(() => screen.getByRole("link", { name: "All releases" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Releases" })).toBeVisible(),
      )
    }),
  )

  it.effect("fits a phone: the releases and a release with nothing wider than the screen", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      yield* Effect.promise(() => page.viewport(390, 844))
      window.history.pushState(null, "", "/notes/releases")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("Better")).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* Effect.promise(() =>
        screen.getByRole("link", { name: /^2026\.10\.21-e91f09c notes-api, production/ }).click(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("was 290 ms")).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* expectAccessible()
      yield* Effect.promise(() => page.viewport(1280, 900))
    }),
  )
})
