import { ReleaseList } from "@cluenori/releases"
import { assert, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { render } from "vitest-browser-react"
import { page } from "vitest/browser"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import { answerApi, apiCalls, reply } from "./fake-api.ts"
import { appRelease, inReviewRelease, notesApi } from "./notes-project.ts"

const worse = "2026.10.21-e91f09c"
const better = "2026.10.20-7b2c4d1"

// Opens another address, as following a link from elsewhere does.
const open = (address: string) => {
  window.history.pushState(null, "", address)
  window.dispatchEvent(new PopStateEvent("popstate"))
}

// The release the calls to one of the API's areas asked about, oldest first.
const releasesAsked = (area: string) =>
  apiCalls()
    .filter((call) => call.path[2] === area && call.path.length === 3)
    .map((call) => call.query.get("release"))

describe("releases journey", () => {
  it.effect("leads from the project's line for Releases to the release that got worse, and what did", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes")
      const screen = yield* Effect.promise(() => render(<App />))

      // The project's line for Releases says what runs in production.
      const door = screen.getByRole("region", { name: "Products" }).getByRole("link", { name: /^Releases/ })
      yield* Effect.promise(() => expect.element(door).toMatchTextContent(/notes-api \S+ in production/))
      yield* expectAccessible()
      yield* Effect.promise(() => door.click())

      // Below what runs where, every release of the period in production, the latest first: how it
      // shipped, when it ran, how much, and against the one before; an app's build that names no
      // environment among them.
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Releases" })).toBeVisible(),
      )
      const list = screen.getByRole("region", { name: "Release history" })
      yield* Effect.promise(() => expect.element(list.getByRole("listitem")).toHaveLength(5))
      yield* Effect.promise(() => expect.element(list.getByText("Better")).toBeVisible())
      yield* Effect.promise(() => expect.element(list.getByText("Too early to tell").first()).toBeVisible())
      yield* Effect.promise(() => expect.element(list.getByText("First release counted").first()).toBeVisible())
      // Each one's commit, by its tag or its short SHA, opens it on GitHub when GitHub knows it.
      yield* Effect.promise(() =>
        expect
          .element(list.getByRole("link", { name: "e91f09c on GitHub" }).first())
          .toHaveAttribute(
            "href",
            "https://github.com/notesapp/notes-api/commit/e91f09c4b7a2d85f3c6e1b0a9d4f7c2e8b5a3d61",
          ),
      )
      yield* Effect.promise(() => expect.element(list.getByText("prod-2026.10.20-7b2c4d1")).toBeVisible())
      yield* Effect.promise(() => expect.element(list.getByText(/^Deployed/).first()).toBeVisible())
      yield* expectAccessible()

      // One component's releases, by one click.
      yield* Effect.promise(() => screen.getByRole("button", { name: "notes-ios" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "Release history" }).getByRole("listitem")).toHaveLength(3),
      )
      yield* Effect.promise(() => screen.getByRole("button", { name: "All" }).click())

      // Staging's releases, by one click: the one that ran there first.
      yield* Effect.promise(() => screen.getByRole("button", { name: "staging" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "Release history" }).getByRole("listitem")).toHaveLength(1),
      )
      yield* Effect.promise(() => screen.getByRole("button", { name: "production" }).click())

      // The release that got worse, in production, against the release before it.
      yield* Effect.promise(() =>
        screen
          .getByRole("region", { name: "Release history" })
          .getByRole("link", { name: `${worse} notes-api, production` })
          .click(),
      )
      yield* Effect.promise(() => expect.element(screen.getByRole("heading", { level: 1, name: worse })).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText(`Against ${better}`)).toBeVisible())
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

  it.effect("shows what changed since the release before: GitHub's pull requests, or a deploy's commits", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", `/projects/notes/releases/notes-api/${worse}?environment=production`)
      const screen = yield* Effect.promise(() => render(<App />))

      // Its commit, by its short SHA, opens on GitHub; its message beside it.
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("link", { name: "e91f09c on GitHub" }))
          .toHaveAttribute(
            "href",
            "https://github.com/notesapp/notes-api/commit/e91f09c4b7a2d85f3c6e1b0a9d4f7c2e8b5a3d61",
          ),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("Share a note by link (#212)")).toBeVisible())
      // Its page on the repository's Releases page, which Cluenori published once it reached production.
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("link", { name: "Release on GitHub" }))
          .toHaveAttribute("href", `https://github.com/notesapp/notes-api/releases/tag/${worse}`),
      )

      // The pull requests merged since, each opening on GitHub, with how much changed and the comparison.
      const changes = screen.getByRole("region", { name: `Changes since ${better}` })
      yield* Effect.promise(() => expect.element(changes.getByText("4 commits, 23 files, +640 −182")).toBeVisible())
      yield* Effect.promise(() => expect.element(changes.getByRole("link")).toHaveLength(5))
      yield* Effect.promise(() =>
        expect
          .element(changes.getByRole("link", { name: /^#212 Share a note by link mira · feature/ }))
          .toHaveAttribute("href", "https://github.com/notesapp/notes-api/pull/212"),
      )
      yield* Effect.promise(() =>
        expect
          .element(changes.getByRole("link", { name: "Compare on GitHub" }))
          .toHaveAttribute("href", "https://github.com/notesapp/notes-api/compare/7b2c4d1...e91f09c"),
      )
      yield* expectAccessible()

      // The release before was only reported from CI: its tag, and the commits its report listed,
      // without GitHub's pull requests, files, or comparison.
      yield* Effect.promise(() => screen.getByRole("link", { name: "Open the release before" }).click())
      yield* Effect.promise(() => expect.element(screen.getByRole("heading", { level: 1, name: better })).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText("prod-2026.10.20-7b2c4d1")).toBeVisible())
      const reported = screen.getByRole("region", { name: "Changes since 2026.10.17-c3d9a02" })
      yield* Effect.promise(() => expect.element(reported.getByText("3 commits", { exact: true })).toBeVisible())
      yield* Effect.promise(() => expect.element(reported.getByText("Cache the notes list per account")).toBeVisible())
      yield* Effect.promise(() => expect.element(reported.getByRole("link")).not.toBeInTheDocument())
      yield* Effect.promise(() => expect.element(screen.getByText("Deployed", { exact: true })).toBeVisible())
      yield* expectAccessible()
    }),
  )

  it.effect("shows an iPhone build only App Store Connect knows: where it stands, and no numbers", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/releases?component=notes-ios")
      const screen = yield* Effect.promise(() => render(<App />))

      // In the history: its stage in words, and no telemetry, never a zero.
      const history = screen.getByRole("region", { name: "Release history" })
      const row = history.getByRole("listitem").filter({ hasText: inReviewRelease })
      yield* Effect.promise(() => expect.element(row.getByText("In review")).toBeVisible())
      yield* Effect.promise(() => expect.element(row.getByText("No telemetry yet")).toBeVisible())
      yield* Effect.promise(() => expect.element(row.getByText(/runs|failed|%/)).not.toBeInTheDocument())
      yield* Effect.promise(() =>
        expect
          .element(
            history.getByRole("listitem").filter({ hasText: appRelease }).getByText("Phased release, day 3 of 7"),
          )
          .toBeVisible(),
      )
      yield* expectAccessible()

      // Its page: where it stands in App Store Connect, with Apple's states in words.
      yield* Effect.promise(() => row.getByRole("link", { name: `${inReviewRelease} notes-ios` }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: inReviewRelease })).toBeVisible(),
      )
      const verdict = screen.getByRole("region", { name: `Against ${appRelease}` })
      yield* Effect.promise(() => expect.element(verdict.getByText("No telemetry yet")).toBeVisible())
      yield* Effect.promise(() => expect.element(verdict.getByText("Runs")).not.toBeInTheDocument())
      const store = screen.getByRole("region", { name: "App Store Connect" })
      yield* Effect.promise(() => expect.element(store.getByText("Build 420 of version 1.9.0")).toBeVisible())
      yield* Effect.promise(() => expect.element(store.getByText("Uploaded")).toBeVisible())
      yield* Effect.promise(() => expect.element(store.getByText("In review", { exact: true })).toBeVisible())
      yield* Effect.promise(() => expect.element(store.getByText("In beta testing").first()).toBeVisible())
      // Without telemetry, no area has anything of it to show.
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("navigation", { name: "This release in each area" })).not.toBeInTheDocument(),
      )
      yield* expectAccessible()

      // What changed isn't known without its repository: one click links it.
      const changes = screen.getByRole("region", { name: `Changes since ${appRelease}` })
      yield* Effect.promise(() => changes.getByRole("button", { name: "Link the repository" }).click())
      const dialog = screen.getByRole("dialog", { name: "Where notes-ios's releases come from" })
      yield* Effect.promise(() => dialog.getByLabelText("GitHub repository").fill("notesapp/notes-ios"))
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Save the links" }).click())
      yield* Effect.promise(() => expect.element(dialog).not.toBeInTheDocument())
      yield* Effect.promise(() =>
        expect.element(changes.getByText(/haven.t both been found in notesapp\/notes-ios yet/)).toBeVisible(),
      )
    }),
  )

  it.effect("says which source failed lately, so commits missing from releases aren't read as none", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/releases")
      const screen = yield* Effect.promise(() => render(<App />))

      const failed = screen.getByRole("region", { name: "Sources that failed" })
      yield* Effect.promise(() =>
        expect.element(failed.getByText(/^GitHub refused: Cluenori isn.t connected to GitHub yet/)).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(failed.getByText("notes-api", { exact: true })).toBeVisible())
      yield* expectAccessible()
    }),
  )

  it.effect("opens Performance, Errors and Logs filtered to a release, over a period that covers it", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", `/projects/notes/releases/notes-api/${worse}?environment=production`)
      const screen = yield* Effect.promise(() => render(<App />))

      // Its errors, one click from its page: the release a chip beside the switches.
      yield* Effect.promise(() => screen.getByRole("link", { name: "Errors of this release" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Errors" })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByRole("link", { name: worse })).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText("NpgsqlException").first()).toBeVisible())
      // In the release's own environment.
      assert.strictEqual(window.location.search, `?component=notes-api&environment=production&release=${worse}`)
      assert.deepStrictEqual([...new Set(releasesAsked("errors"))], [worse])
      assert.deepStrictEqual(
        [
          ...new Set(
            apiCalls()
              .filter((call) => call.path[2] === "errors")
              .map((call) => call.query.get("environment")),
          ),
        ],
        ["production"],
      )
      // It ran 3 hours: the last 24 hours cover it.
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("button", { name: "24h" })).toHaveAttribute("aria-pressed", "true"),
      )
      yield* expectAccessible()

      // Removing the chip shows every release's errors again.
      yield* Effect.promise(() => screen.getByRole("button", { name: "Show every release" }).click())
      yield* Effect.promise(() => expect.element(screen.getByRole("link", { name: worse })).not.toBeInTheDocument())
      assert.strictEqual(window.location.search, "?component=notes-api&environment=production")
      yield* Effect.promise(() => expect.poll(() => releasesAsked("errors").at(-1)).toBeNull())

      // Its logs: a line opens in place, with a link back to the release it was written in.
      open(`/projects/notes/releases/notes-api/${worse}?environment=production`)
      yield* Effect.promise(() => screen.getByRole("link", { name: "Logs of this release" }).click())
      yield* Effect.promise(() => expect.element(screen.getByRole("heading", { level: 1, name: "Logs" })).toBeVisible())
      yield* Effect.promise(() => screen.getByRole("button", { name: /Retrying the export/ }).click())
      assert.deepStrictEqual([...new Set(releasesAsked("logs"))], [worse])
      yield* Effect.promise(() => screen.getByRole("link", { name: `Release ${worse}` }).click())
      yield* Effect.promise(() => expect.element(screen.getByRole("heading", { level: 1, name: worse })).toBeVisible())

      // The release before ran 24 hours, until 3 hours ago: its performance is over the last 7 days.
      open(`/projects/notes/releases/notes-api/${better}?environment=production`)
      yield* Effect.promise(() => screen.getByRole("link", { name: "Performance of this release" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Performance" })).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("button", { name: "7d" })).toHaveAttribute("aria-pressed", "true"),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("Load on notes-api")).toBeVisible())
      assert.deepStrictEqual([...new Set(releasesAsked("load"))], [better])
      yield* expectAccessible()

      // The chip leads back to the release.
      yield* Effect.promise(() => screen.getByRole("link", { name: better }).click())
      yield* Effect.promise(() => expect.element(screen.getByRole("heading", { level: 1, name: better })).toBeVisible())
    }),
  )

  it.effect("links a component to its repository, saying what is wrong and what the API said", () =>
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
      window.history.pushState(null, "", "/projects/notes/releases?component=notes-ios")
      const screen = yield* Effect.promise(() => render(<App />))

      // The iPhone app's block: no repository yet, and its builds going to the App Store.
      const block = screen.getByRole("region", { name: "notes-ios" })
      yield* Effect.promise(() =>
        expect.element(block.getByRole("listitem", { name: "production" }).getByText("App Store")).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(block.getByText("notesapp/notes-ios")).not.toBeInTheDocument())
      yield* Effect.promise(() => block.getByRole("button", { name: "Change links of notes-ios" }).click())

      // A repository that isn't one is refused with GitHub's rule, before anything is sent.
      const dialog = screen.getByRole("dialog", { name: "Where notes-ios's releases come from" })
      yield* Effect.promise(() => dialog.getByLabelText("GitHub repository").fill("notes app"))
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Save the links" }).click())
      yield* Effect.promise(() =>
        expect.element(dialog.getByText(/^Expected an owner and a repository name joined by a slash/)).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect.element(dialog.getByLabelText("GitHub repository")).toHaveAttribute("aria-invalid", "true"),
      )
      assert.isFalse(apiCalls().some((call) => call.method === "PUT"))
      yield* expectAccessible()

      // A failed save says so, and keeps what was typed.
      yield* Effect.promise(() => dialog.getByLabelText("GitHub repository").fill("notesapp/notes-ios"))
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Save the links" }).click())
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByRole("alert"))
          .toHaveTextContent("The API didn't answer. Check that Cluenori is running, then try again."),
      )
      yield* expectAccessible()

      // Saved: the dialog closes, and the component shows its repository, its deploy target kept.
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Save the links" }).click())
      yield* Effect.promise(() => expect.element(dialog).not.toBeInTheDocument())
      yield* Effect.promise(() =>
        expect
          .element(block.getByRole("link", { name: "notesapp/notes-ios on GitHub" }))
          .toHaveAttribute("href", "https://github.com/notesapp/notes-ios"),
      )
      const saved = apiCalls().filter((call) => call.method === "PUT")
      assert.deepStrictEqual(
        saved.map((call) => [call.path.join("/"), call.body]),
        [
          [
            "projects/notes/components/notes-ios/links",
            '{"repository":"notesapp/notes-ios","deployTargets":[{"environment":"production","appStore":{"bundleId":"com.notesapp.notes","distribution":"appStore"}}]}',
          ],
          [
            "projects/notes/components/notes-ios/links",
            '{"repository":"notesapp/notes-ios","deployTargets":[{"environment":"production","appStore":{"bundleId":"com.notesapp.notes","distribution":"appStore"}}]}',
          ],
        ],
      )
    }),
  )

  it.effect("asks for a release by its version and environment, and opens the release before it in one click", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(
        null,
        "",
        `/projects/notes/releases/notes-ios/${encodeURIComponent(appRelease)}?environment=production`,
      )
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("notes-ios, production")).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText("Too early to tell")).toBeVisible())
      yield* Effect.promise(() => expect.element(screen.getByText("Phased release, day 3 of 7")).toBeVisible())
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
      yield* Effect.promise(() => expect.element(screen.getByText("Replaced by a later build")).toBeVisible())
    }),
  )

  it.effect("says when releases appear, when there are none yet", () =>
    Effect.gen(function* () {
      const notes = notesApi()
      answerApi((call) =>
        call.path[2] === "releases" && call.path.length === 3
          ? reply(ReleaseList, { releases: [], problems: [] })
          : notes(call),
      )
      window.history.pushState(null, "", "/projects/notes/releases")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() =>
        expect
          .element(screen.getByText(/^No releases in this period\. A release appears once a service reports/))
          .toBeVisible(),
      )
      // Data arrives; it says no version.
      yield* Effect.promise(() => expect.element(screen.getByText(/^Receiving data, latest at/)).toBeVisible())
      // No source failed, so nothing says one did.
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "Sources that failed" })).not.toBeInTheDocument(),
      )
      yield* expectAccessible()
    }),
  )

  it.effect("says a release it never counted isn't there, with a way back", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      window.history.pushState(null, "", "/projects/notes/releases/notes-api/0.9.0")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("There is no such release")).toBeVisible())
      yield* expectAccessible()
      yield* Effect.promise(() => screen.getByRole("link", { name: "All releases" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Releases" })).toBeVisible(),
      )
    }),
  )

  it.effect("fits a phone: the releases, a release, and a store build with nothing wider than the screen", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      yield* Effect.promise(() => page.viewport(390, 844))
      window.history.pushState(null, "", "/projects/notes/releases")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("Better")).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* Effect.promise(() =>
        screen
          .getByRole("region", { name: "Release history" })
          .getByRole("link", { name: `${worse} notes-api, production` })
          .click(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText("was 290 ms")).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* expectAccessible()
      open(`/projects/notes/releases/notes-ios/${encodeURIComponent(inReviewRelease)}`)
      yield* Effect.promise(() => expect.element(screen.getByText("Build 420 of version 1.9.0")).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* expectAccessible()
      yield* Effect.promise(() => page.viewport(1280, 900))
    }),
  )
})
