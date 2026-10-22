import { ComponentKey, EnvironmentKey, ReleaseVersion } from "@cluenori/foundation"
import { PromotionId, PromotionInProgress, PromotionRefused, PromotionUnavailable } from "@cluenori/releases"
import { assert, describe, expect, it, vi } from "@effect/vitest"
import { DateTime, Effect } from "effect"
import { render } from "vitest-browser-react"
import { page } from "vitest/browser"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import type { AnswerApi } from "./fake-api.ts"
import { answerApi, apiCalls, reply } from "./fake-api.ts"
import {
  appRelease,
  appStorePromotions,
  approvedId,
  iosWithThreeApps,
  mira,
  notesApi,
  repositoryOf,
  workflowFile,
} from "./notes-project.ts"

const worse = "2026.10.21-e91f09c"
const worsePage = `/notes/releases/notes-api/${worse}?environment=production`

// The calls that asked for the API's latest release.
const releaseAsked = () =>
  apiCalls().filter(
    (call) => call.method === "GET" && call.path.join("/") === `projects/notes/releases/notes-api/${worse}`,
  ).length

const appPage = `/notes/releases/notes-ios/${encodeURIComponent(appRelease)}?environment=production`

// The bodies of the promotions asked for of one release, oldest first.
const promotedOf = (component: string, release: string) =>
  apiCalls()
    .filter(
      (call) =>
        call.method === "POST" && call.path.join("/") === `projects/notes/releases/${component}/${release}/promotions`,
    )
    .map((call) => call.body)

const promoted = () =>
  apiCalls()
    .filter((call) => call.method === "POST" && call.path.at(-1) === "promotions")
    .map((call) => [call.path.slice(3).join("/"), call.body])

// A promotion to staging that hasn't ended, as the API names it when it refuses another.
const runningToStaging = {
  id: PromotionId.make("019a1000-0000-7000-8000-000000000009"),
  component: ComponentKey.make("notes-api"),
  release: ReleaseVersion.make(worse),
  environment: EnvironmentKey.make("staging"),
  repository: repositoryOf("notesapp/notes-api"),
  workflow: workflowFile("promote-to-staging.yml"),
  startedAt: DateTime.makeUnsafe("2026-10-21T09:00:00Z"),
  state: "running" as const,
  run: { id: 9_150, url: "https://github.com/notesapp/notes-api/actions/runs/9150" },
}

// The API refusing each promotion in turn: not connected to GitHub, already promoting, and GitHub
// not answering.
const refusingApi = (notes: AnswerApi): AnswerApi => {
  const answers = [
    reply(
      PromotionRefused,
      new PromotionRefused({
        reason: "Cluenori isn't connected to GitHub yet: an owner connects it on the web, on the GitHub page",
        fix: "github",
      }),
      422,
    ),
    reply(PromotionInProgress, new PromotionInProgress({ promotion: runningToStaging }), 409),
    reply(PromotionUnavailable, new PromotionUnavailable({ reason: "GitHub answered 502" }), 503),
  ]
  let refused = 0
  return (call) => {
    if (call.method === "POST" && call.path.at(-1) === "promotions") {
      const answer = answers[refused % answers.length] ?? answers[0]
      refused += 1
      return answer ?? Effect.die("No refusal to answer with.")
    }
    return notes(call)
  }
}

describe("promotions journey", () => {
  it.effect("lists a release's promotions, promotes it with a reason, and follows the run until it ends", () =>
    Effect.gen(function* () {
      // Only the page's own asking again is faked, so 15 seconds pass at once.
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] })
      answerApi(notesApi({ following: ["starting", "running", "succeeded"] }))
      window.history.pushState(null, "", worsePage)
      const screen = yield* Effect.promise(() => render(<App />))

      // Its promotions, the latest first: where each went, how it ended, when, who, why, and its run.
      const promotions = screen.getByRole("region", { name: "Promotions" })
      const rows = promotions.getByRole("listitem")
      yield* Effect.promise(() => expect.element(rows).toHaveLength(2))
      const toProduction = rows.first()
      yield* Effect.promise(() => expect.element(toProduction.getByText("Succeeded")).toBeVisible())
      yield* Effect.promise(() => expect.element(toProduction.getByText("by mira@notesapp.dev")).toBeVisible())
      yield* Effect.promise(() => expect.element(toProduction.getByText("Share links for everyone")).toBeVisible())
      yield* Effect.promise(() =>
        expect
          .element(toProduction.getByRole("link", { name: "Run on GitHub of the promotion to production" }))
          .toHaveAttribute("href", "https://github.com/notesapp/notes-api/actions/runs/9120"),
      )
      // Its exact time on pointing, in the viewer's own words.
      yield* Effect.promise(() => expect.element(toProduction.getByRole("time")).toHaveAttribute("title"))
      yield* Effect.promise(() => expect.element(rows.nth(1).getByText("by an agent or process")).toBeVisible())
      yield* expectAccessible()
      // Nothing runs, so nothing is asked again.
      const before = releaseAsked()
      vi.advanceTimersByTime(30_000)
      assert.strictEqual(releaseAsked(), before)

      // Promoting says what it starts, with what, where, and where it runs: by default, the Mac when
      // it's online.
      yield* Effect.promise(() => promotions.getByRole("button", { name: "Promote to production" }).click())
      const dialog = screen.getByRole("dialog", { name: `Promote ${worse} to production?` })
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByRole("listitem"))
          .toHaveTextContent(
            `Runs promote-to-prod.yml in notesapp/notes-api on GitHub, with release ${worse} and environment production.`,
          ),
      )
      const runner = dialog.getByRole("group", { name: "Where the workflow runs" })
      yield* Effect.promise(() =>
        expect.element(runner.getByRole("button", { name: "Auto" })).toHaveAttribute("aria-pressed", "true"),
      )
      yield* Effect.promise(() =>
        expect.element(dialog.getByText("Your Mac when it's online, else the cloud.")).toBeVisible(),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => runner.getByRole("button", { name: "Your Mac" }).click())
      yield* Effect.promise(() => dialog.getByLabelText("Reason").fill("  Retry exports for everyone  "))
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Promote" }).click())

      // It closes; the promotion shows at once, the latest, by you, with its reason.
      yield* Effect.promise(() => expect.element(dialog).not.toBeInTheDocument())
      yield* Effect.promise(() => expect.element(rows).toHaveLength(3))
      yield* Effect.promise(() => expect.element(rows.first().getByText("Starting")).toBeVisible())
      yield* Effect.promise(() => expect.element(rows.first().getByText("by you")).toBeVisible())
      yield* Effect.promise(() => expect.element(rows.first().getByText("Retry exports for everyone")).toBeVisible())
      assert.deepStrictEqual(promoted(), [
        [
          `notes-api/${worse}/promotions`,
          '{"environment":"production","reason":"Retry exports for everyone","runner":"local"}',
        ],
      ])
      yield* expectAccessible()

      // While it runs, the page asks again every 15 seconds, until it ends.
      yield* Effect.promise(() => expect.poll(() => releaseAsked()).toBeGreaterThan(before))
      vi.advanceTimersByTime(15_000)
      yield* Effect.promise(() => expect.element(rows.first().getByText("Running")).toBeVisible())
      yield* Effect.promise(() =>
        expect
          .element(rows.first().getByRole("link", { name: "Run on GitHub of the promotion to production" }))
          .toHaveAttribute("href", "https://github.com/notesapp/notes-api/actions/runs/9200"),
      )
      vi.advanceTimersByTime(15_000)
      yield* Effect.promise(() => expect.element(rows.first().getByText("Succeeded")).toBeVisible())
      const ended = releaseAsked()
      vi.advanceTimersByTime(60_000)
      assert.strictEqual(releaseAsked(), ended)
      vi.useRealTimers()
    }),
  )

  it.effect("says why a promotion didn't start: refused, already promoting, or GitHub not answering", () =>
    Effect.gen(function* () {
      answerApi(refusingApi(notesApi()))
      window.history.pushState(null, "", worsePage)
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => screen.getByRole("button", { name: "Promote to staging" }).click())
      const dialog = screen.getByRole("dialog", { name: `Promote ${worse} to staging?` })
      const promote = dialog.getByRole("button", { name: "Promote" })

      // Refused: the API's reason, and for an owner, the page where it is fixed.
      yield* Effect.promise(() => promote.click())
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByRole("alert"))
          .toMatchTextContent(
            "Cluenori isn't connected to GitHub yet: an owner connects it on the web, on the GitHub page.",
          ),
      )
      yield* Effect.promise(() =>
        expect.element(dialog.getByRole("link", { name: "Open the GitHub page" })).toHaveAttribute("href", "/github"),
      )
      yield* expectAccessible()

      // Already promoting: which release, and its run.
      yield* Effect.promise(() => promote.click())
      yield* Effect.promise(() =>
        expect.element(dialog.getByRole("alert")).toMatchTextContent(`Already promoting ${worse} to staging.`),
      )
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByRole("link", { name: "Its run on GitHub" }))
          .toHaveAttribute("href", "https://github.com/notesapp/notes-api/actions/runs/9150"),
      )

      // GitHub didn't answer: nothing started.
      yield* Effect.promise(() => promote.click())
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByRole("alert"))
          .toHaveTextContent("GitHub didn't answer, so nothing started. Try again in a moment."),
      )
      // Nothing started, so nothing is listed.
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Cancel" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("region", { name: "Promotions" }).getByRole("listitem")).toHaveLength(2),
      )
      yield* Effect.promise(() => screen.unmount())

      // A member is told what the refusal says, without the owners' page.
      answerApi(refusingApi(notesApi({ as: mira })))
      const asMember = yield* Effect.promise(() => render(<App />))
      yield* Effect.promise(() => asMember.getByRole("button", { name: "Promote to production" }).click())
      const memberDialog = asMember.getByRole("dialog", { name: `Promote ${worse} to production?` })
      yield* Effect.promise(() => memberDialog.getByRole("button", { name: "Promote" }).click())
      yield* Effect.promise(() =>
        expect.element(memberDialog.getByRole("alert")).toMatchTextContent(/on the GitHub page\.$/),
      )
      yield* Effect.promise(() =>
        expect.element(memberDialog.getByRole("link", { name: "Open the GitHub page" })).not.toBeInTheDocument(),
      )
      // Her own promotion is said to be hers.
      yield* Effect.promise(() => memberDialog.getByRole("button", { name: "Cancel" }).click())
      yield* Effect.promise(() => expect.element(asMember.getByText("by you")).toBeVisible())
    }),
  )

  it.effect("promotes an app to App Store review: its options, the notes it needs, then on", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ linked: iosWithThreeApps }))
      window.history.pushState(null, "", appPage)
      const screen = yield* Effect.promise(() => render(<App />))

      // A button for each of its targets.
      const promotions = screen.getByRole("region", { name: "Promotions" })
      for (const environment of ["internal", "beta", "production"]) {
        yield* Effect.promise(() =>
          expect.element(promotions.getByRole("button", { name: `Promote to ${environment}` })).toBeVisible(),
        )
      }
      yield* Effect.promise(() => promotions.getByRole("button", { name: "Promote to production" }).click())

      // What happens, step by step: the workflow, then App Store review with the notes as What's New.
      const dialog = screen.getByRole("dialog", { name: `Promote ${appRelease} to production?` })
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByRole("listitem").nth(1))
          .toHaveTextContent(
            "Then waits for App Store Connect to process its build of com.notesapp.notes, and submits it to App Store review with the notes as What's New.",
          ),
      )
      const approved = dialog.getByRole("group", { name: "Once App Store review approves it" })
      yield* Effect.promise(() =>
        expect
          .element(approved.getByRole("button", { name: "Release when approved" }))
          .toHaveAttribute("aria-pressed", "true"),
      )
      yield* Effect.promise(() =>
        expect.element(dialog.getByRole("checkbox", { name: "Phased over 7 days" })).toBeChecked(),
      )
      yield* Effect.promise(() =>
        expect.element(dialog.getByText(/^No notes yet: App Store review needs What's New/)).toBeVisible(),
      )
      yield* expectAccessible()

      // Without notes, review is refused: one click to write them.
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Promote", exact: true }).click())
      const refusal = dialog.getByRole("alert")
      yield* Effect.promise(() =>
        expect.element(refusal).toMatchTextContent(`${appRelease} has no notes: write its What's New in en-US`),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => refusal.getByRole("button", { name: "Write the notes" }).click())
      yield* Effect.promise(() => expect.element(dialog).not.toBeInTheDocument())
      yield* Effect.promise(() => expect.poll(() => document.activeElement?.id).toBe("release-notes"))
      const editor = screen.getByRole("region", { name: "Release notes" })
      yield* Effect.promise(() => editor.getByLabelText("en-US").fill("Share a note with anyone by a link."))
      yield* Effect.promise(() => editor.getByRole("button", { name: "Save notes" }).click())
      yield* Effect.promise(() => expect.element(editor.getByText("Saved.")).toBeVisible())

      // On: built in the cloud, released by hand once approved, to everyone at once.
      yield* Effect.promise(() => promotions.getByRole("button", { name: "Promote to production" }).click())
      const again = screen.getByRole("dialog", { name: `Promote ${appRelease} to production?` })
      yield* Effect.promise(() => expect.element(again.getByText("Share a note with anyone by a link.")).toBeVisible())
      yield* Effect.promise(() =>
        again.getByRole("group", { name: "Where the workflow runs" }).getByRole("button", { name: "Cloud" }).click(),
      )
      yield* Effect.promise(() =>
        again
          .getByRole("group", { name: "Once App Store review approves it" })
          .getByRole("button", { name: "Release manually" })
          .click(),
      )
      yield* Effect.promise(() => again.getByRole("checkbox", { name: "Phased over 7 days" }).click())
      yield* Effect.promise(() => again.getByRole("button", { name: "Promote", exact: true }).click())
      yield* Effect.promise(() => expect.element(again).not.toBeInTheDocument())
      const rows = promotions.getByRole("listitem")
      yield* Effect.promise(() => expect.element(rows.first().getByText("Starting")).toBeVisible())
      yield* Effect.promise(() => expect.element(rows.first().getByText("Released manually")).toBeVisible())
      assert.deepStrictEqual(promotedOf("notes-ios", appRelease), [
        '{"environment":"production","runner":"auto","submission":{"releaseType":"afterApproval","phased":true}}',
        '{"environment":"production","runner":"cloud","submission":{"releaseType":"manual","phased":false}}',
      ])
      assert.deepStrictEqual(
        apiCalls()
          .filter((call) => call.method === "PUT")
          .map((call) => [call.path.slice(3).join("/"), call.body]),
        [
          [
            `notes-ios/${appRelease}/notes`,
            '{"notes":[{"locale":"en-US","text":"Share a note with anyone by a link."}]}',
          ],
        ],
      )
    }),
  )

  it.effect("says where each App Store promotion stands, and releases an approved one now", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ linked: iosWithThreeApps, seeded: appStorePromotions }))
      window.history.pushState(null, "", appPage)
      const screen = yield* Effect.promise(() => render(<App />))

      const rows = screen.getByRole("region", { name: "Promotions" }).getByRole("listitem")
      yield* Effect.promise(() => expect.element(rows).toHaveLength(3))
      yield* Effect.promise(() => expect.element(rows.nth(0).getByText("Approved")).toBeVisible())
      yield* Effect.promise(() => expect.element(rows.nth(0).getByText("Waits for you to release it")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(rows.nth(1).getByText("Processing in App Store Connect")).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(rows.nth(2).getByText("Rejected in review")).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(rows.nth(2).getByText("Apple's reasons are in App Store Connect")).toBeVisible(),
      )
      yield* expectAccessible()

      // Releasing asks first, and says what happens.
      yield* Effect.promise(() => rows.nth(0).getByRole("button", { name: "Release now to production" }).click())
      const dialog = screen.getByRole("alertdialog", { name: `Release ${appRelease} on the App Store now?` })
      yield* Effect.promise(() => expect.element(dialog.getByText(/to everyone over 7 days/)).toBeVisible())
      yield* expectAccessible()
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Release now" }).click())
      yield* Effect.promise(() => expect.element(dialog).not.toBeInTheDocument())
      yield* Effect.promise(() => expect.element(rows.nth(0).getByText("Releasing on the App Store")).toBeVisible())
      assert.isTrue(
        apiCalls().some(
          (call) => call.method === "POST" && call.path.join("/") === `projects/notes/promotions/${approvedId}/release`,
        ),
      )
    }),
  )

  it.effect(
    "without a deploy target, says how to add one, and links targets as a notes app's iPhone app has them",
    () =>
      Effect.gen(function* () {
        const noTargets = new Map(iosWithThreeApps)
        noTargets.set("notes-ios", {})
        answerApi(notesApi({ linked: noTargets }))
        window.history.pushState(null, "", appPage)
        const screen = yield* Effect.promise(() => render(<App />))

        // A quiet line, not a panel.
        yield* Effect.promise(() =>
          expect.element(screen.getByText("Add a deploy target to promote releases from here.")).toBeVisible(),
        )
        yield* Effect.promise(() =>
          expect.element(screen.getByRole("region", { name: "Promotions" })).not.toBeInTheDocument(),
        )
        yield* Effect.promise(() => screen.getByRole("button", { name: "Change links" }).click())
        const dialog = screen.getByRole("dialog", { name: "Where notes-ios's releases come from" })

        // A target for internal testers, one for beta testers, and the App Store, each its own app.
        const rows = [
          ["internal", "com.notesapp.notes.internal"],
          ["beta", "com.notesapp.notes.beta"],
          ["production", "com.notesapp.notes"],
        ] as const
        for (const [index, [environment, app]] of rows.entries()) {
          const number = index + 1
          yield* Effect.promise(() => dialog.getByRole("button", { name: "Add a deploy target" }).click())
          yield* Effect.promise(() => dialog.getByLabelText(`Environment of deploy target ${number}`).fill(environment))
          yield* Effect.promise(() => dialog.getByLabelText(`Workflow file of deploy target ${number}`).fill("ios.yml"))
          yield* Effect.promise(() =>
            dialog.getByLabelText(`App Store Connect app of deploy target ${number}`).fill(app),
          )
        }
        yield* Effect.promise(() =>
          dialog
            .getByRole("group", { name: "Where deploy target 3's builds go" })
            .getByRole("button", { name: "App Store (through review)" })
            .click(),
        )
        // The environments it suggests are the project's.
        assert.deepStrictEqual(
          [...document.querySelectorAll("datalist option")].map((option) => option.getAttribute("value")),
          ["production", "staging"],
        )

        // A workflow needs the repository; an environment named twice, or a target with neither a
        // workflow nor an app, is refused.
        yield* Effect.promise(() => dialog.getByRole("button", { name: "Add a deploy target" }).click())
        yield* Effect.promise(() => dialog.getByLabelText("Environment of deploy target 4").fill("beta"))
        yield* Effect.promise(() => dialog.getByRole("button", { name: "Save the links" }).click())
        yield* Effect.promise(() =>
          expect
            .element(dialog.getByText("A workflow runs in the component's repository: link it above.").first())
            .toBeVisible(),
        )
        yield* Effect.promise(() =>
          expect.element(dialog.getByText(/^This environment has a target above/)).toBeVisible(),
        )
        yield* Effect.promise(() =>
          expect.element(dialog.getByRole("alert").filter({ hasText: "Fix what each target says" })).toBeVisible(),
        )
        assert.isFalse(apiCalls().some((call) => call.method === "PUT"))
        yield* expectAccessible()
        yield* Effect.promise(() => dialog.getByLabelText("Environment of deploy target 4").fill("staging"))
        yield* Effect.promise(() => dialog.getByRole("button", { name: "Save the links" }).click())
        yield* Effect.promise(() =>
          expect.element(dialog.getByText("Give it a workflow, an App Store Connect app, or both.")).toBeVisible(),
        )

        // Fixed: the repository linked, the fourth target removed.
        yield* Effect.promise(() => dialog.getByRole("button", { name: "Remove deploy target 4" }).click())
        yield* Effect.promise(() => dialog.getByLabelText("GitHub repository").fill("notesapp/notes-ios"))
        yield* Effect.promise(() => dialog.getByRole("button", { name: "Save the links" }).click())
        yield* Effect.promise(() => expect.element(dialog).not.toBeInTheDocument())
        assert.deepStrictEqual(
          apiCalls()
            .filter((call) => call.method === "PUT")
            .map((call) => call.body),
          [
            '{"repository":"notesapp/notes-ios","deployTargets":[{"environment":"internal","workflow":"ios.yml","appStore":{"bundleId":"com.notesapp.notes.internal","distribution":"testFlight"}},{"environment":"beta","workflow":"ios.yml","appStore":{"bundleId":"com.notesapp.notes.beta","distribution":"testFlight"}},{"environment":"production","workflow":"ios.yml","appStore":{"bundleId":"com.notesapp.notes","distribution":"appStore"}}]}',
          ],
        )

        // The release can be promoted to each now.
        const promotions = screen.getByRole("region", { name: "Promotions" })
        for (const environment of ["internal", "beta", "production"]) {
          yield* Effect.promise(() =>
            expect.element(promotions.getByRole("button", { name: `Promote to ${environment}` })).toBeVisible(),
          )
        }
        yield* Effect.promise(() => expect.element(screen.getByText("Not promoted from Cluenori yet.")).toBeVisible())
      }),
  )

  it.effect("keeps a component's deploy targets when its repository changes, and lists them", () =>
    Effect.gen(function* () {
      answerApi(notesApi({ linked: iosWithThreeApps }))
      window.history.pushState(null, "", "/notes/releases?component=notes-ios")
      const screen = yield* Effect.promise(() => render(<App />))

      const sources = screen.getByRole("region", { name: "Where releases come from" })
      yield* Effect.promise(() =>
        expect.element(sources.getByText("ios.yml · com.notesapp.notes.beta, TestFlight")).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect.element(sources.getByText("ios.yml · com.notesapp.notes, App Store")).toBeVisible(),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => sources.getByRole("button", { name: "Change links of notes-ios" }).click())
      const dialog = screen.getByRole("dialog", { name: "Where notes-ios's releases come from" })
      yield* Effect.promise(() =>
        expect
          .element(dialog.getByLabelText("App Store Connect app of deploy target 2"))
          .toHaveValue("com.notesapp.notes.beta"),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => dialog.getByLabelText("GitHub repository").fill("notesapp/notes-apple"))
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Save the links" }).click())
      yield* Effect.promise(() => expect.element(dialog).not.toBeInTheDocument())
      const [saved] = apiCalls()
        .filter((call) => call.method === "PUT")
        .map((call) => call.body)
      assert.include(saved, '"repository":"notesapp/notes-apple"')
      assert.include(
        saved,
        '{"environment":"production","workflow":"ios.yml","appStore":{"bundleId":"com.notesapp.notes","distribution":"appStore"}}',
      )
    }),
  )

  it.effect("fits a phone: a release's promotions and its promote dialog", () =>
    Effect.gen(function* () {
      answerApi(notesApi())
      yield* Effect.promise(() => page.viewport(390, 844))
      window.history.pushState(null, "", worsePage)
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() => expect.element(screen.getByText("by mira@notesapp.dev")).toBeVisible())
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* Effect.promise(() => screen.getByRole("button", { name: "Promote to production" }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("dialog", { name: `Promote ${worse} to production?` })).toBeVisible(),
      )
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* expectAccessible()
      yield* Effect.promise(() => screen.unmount())

      // An app's release: its targets, its notes, and the App Store's options.
      answerApi(notesApi({ linked: iosWithThreeApps }))
      window.history.pushState(null, "", appPage)
      const app = yield* Effect.promise(() => render(<App />))
      yield* Effect.promise(() =>
        expect.element(app.getByRole("region", { name: "Release notes" }).getByLabelText("en-US")).toBeVisible(),
      )
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* Effect.promise(() => app.getByRole("button", { name: "Promote to production" }).click())
      yield* Effect.promise(() =>
        expect.element(app.getByRole("checkbox", { name: "Phased over 7 days" })).toBeVisible(),
      )
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* expectAccessible()
      yield* Effect.promise(() => app.unmount())

      // The releases: versions, the notes style, and each component's targets.
      window.history.pushState(null, "", "/notes/releases")
      const releases = yield* Effect.promise(() => render(<App />))
      yield* Effect.promise(() =>
        expect.element(releases.getByRole("region", { name: "Versions" }).getByText("1.4.0+58")).toBeVisible(),
      )
      assert.isAtMost(document.documentElement.scrollWidth, window.innerWidth)
      yield* expectAccessible()
      yield* Effect.promise(() => page.viewport(1280, 900))
    }),
  )
})
