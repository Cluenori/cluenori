import type { FeedEntry, FeedInput, FeedSummary } from "@cluenori/feeds"
import { Feed, FeedEntries, FeedId, FeedInput as FeedInputSchema, FeedList } from "@cluenori/feeds"
import { ComponentKey, EnvelopeName, EnvironmentKey, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import type { Member } from "@cluenori/members"
import { AppUserId, CountryCode } from "@cluenori/signals"
import { assert, describe, expect, it } from "@effect/vitest"
import { Clock, DateTime, Effect, Schema } from "effect"
import { render } from "vitest-browser-react"
import { userEvent } from "vitest/browser"

import { App } from "@/app"
import { countryName } from "@/lib/format"

import { expectAccessible } from "./accessible.ts"
import type { AnswerApi } from "./fake-api.ts"
import { answerApi, apiCalls, reply } from "./fake-api.ts"
import { ada, mira, notesApi } from "./notes-project.ts"

const minute = 60_000
const notes = ProjectKey.make("notes")
const landing = ProjectKey.make("landing")
const made = FeedId.make("019a2000-0000-7000-8000-000000000001")
const decodeInput = Schema.decodeUnknownEffect(Schema.fromJsonString(FeedInputSchema))

// Someone registered in `project`, `minutes` before `now`.
const entryOf = (id: number, project: ProjectKey, event: string, at: number, user?: string): FeedEntry => ({
  id,
  project,
  event: EnvelopeName.make(event),
  at: DateTime.makeUnsafe(at),
  component: ComponentKey.make(project === notes ? "notes-ios" : "landing-web"),
  environment: EnvironmentKey.make("production"),
  release: ReleaseVersion.make(project === notes ? "1.8.2+412" : "0.4.0+7"),
  country: CountryCode.make(project === notes ? "DE" : "JP"),
  ...(user === undefined ? {} : { user: AppUserId.make(user) }),
})

/**
 * The feeds API, as the workspace's object answers it, for `as`: the feed an owner makes, and its
 * entries; a member sees only Notes's. Every other call is Notes's workspace's.
 */
const feedsApi = (now: number, as: Member, existing?: FeedInput): AnswerApi => {
  const workspace = notesApi({ as })
  let feed: Feed | undefined = existing === undefined ? undefined : { id: made, ...existing }
  const entries = [
    entryOf(3, notes, "user.registered", now - 4 * minute, "u-1042"),
    entryOf(2, landing, "signup_completed", now - 50 * minute),
    entryOf(1, notes, "user.registered", now - 26 * 60 * minute, "u-0977"),
  ]
  const seen = (project: ProjectKey) => as.projects === undefined || as.projects.includes(project)
  const summaryOf = (of: Feed): FeedSummary => {
    const shown = { ...of, sources: of.sources.filter((source) => seen(source.project)) }
    const listed = entries.filter((entry) => seen(entry.project))
    return {
      feed: shown,
      lastDay: listed.filter((entry) => DateTime.toEpochMillis(entry.at) > now - 24 * 60 * minute).length,
      lastWeek: listed.length,
      byProject: [notes, landing]
        .filter(seen)
        .map((project) => ({ project, lastWeek: listed.filter((entry) => entry.project === project).length })),
      latest: listed[0]?.at ?? DateTime.makeUnsafe(now),
    }
  }
  return (call) =>
    Effect.gen(function* () {
      const [first, id] = call.path
      if (first !== "feeds") {
        return yield* workspace(call)
      }
      if (call.method === "GET" && id === undefined) {
        return yield* reply(FeedList, { feeds: feed === undefined ? [] : [summaryOf(feed)] })
      }
      if (call.method === "POST") {
        feed = { id: made, ...(yield* decodeInput(call.body).pipe(Effect.orDie)) }
        return yield* reply(Feed, feed, 201)
      }
      if (call.method === "PUT" && feed !== undefined) {
        feed = { id: made, ...(yield* decodeInput(call.body).pipe(Effect.orDie)) }
        return yield* reply(Feed, feed)
      }
      if (call.method === "DELETE") {
        feed = undefined
        return { status: 204 }
      }
      if (call.method === "GET" && id === made && feed !== undefined) {
        return yield* reply(FeedEntries, {
          summary: summaryOf(feed),
          entries: entries.filter((entry) => seen(entry.project)),
        })
      }
      return yield* Effect.die(`The feeds API has no ${call.method} /api/${call.path.join("/")}.`)
    })
}

describe("feeds journey", () => {
  it.effect(
    "an owner makes a feed of each project's own registration event, opens it, changes it, and deletes it",
    () =>
      Effect.gen(function* () {
        answerApi(feedsApi(yield* Clock.currentTimeMillis, ada))
        window.history.pushState(null, "", "/")
        const screen = yield* Effect.promise(() => render(<App />))

        // Feeds is a click from anywhere; there are none yet, and it says what one is.
        yield* Effect.promise(() => screen.getByRole("link", { name: "Feeds" }).first().click())
        yield* Effect.promise(() => expect.element(screen.getByText(/^No feeds yet\./)).toBeVisible())
        yield* expectAccessible()

        // Ada makes one: Notes names a registration `user.registered`, Landing `signup_completed`.
        yield* Effect.promise(() => screen.getByRole("button", { name: "New feed" }).click())
        yield* Effect.promise(() => userEvent.fill(screen.getByLabelText("Name"), "Registrations"))
        yield* Effect.promise(() => userEvent.fill(screen.getByLabelText("Event of source 1"), "user.registered"))
        yield* Effect.promise(() => screen.getByRole("button", { name: "Add a source" }).click())
        yield* Effect.promise(() => userEvent.selectOptions(screen.getByLabelText("Project of source 2"), "landing"))
        yield* Effect.promise(() => userEvent.fill(screen.getByLabelText("Event of source 2"), "signup_completed"))
        yield* expectAccessible()
        yield* Effect.promise(() => screen.getByRole("button", { name: "Make the feed" }).click())

        // It opens: the newest first, by day, each with the person, where they were, and the release.
        yield* Effect.promise(() =>
          expect.element(screen.getByRole("heading", { level: 1, name: "Registrations" })).toBeVisible(),
        )
        assert.strictEqual(window.location.pathname, `/feeds/${made}`)
        const making = apiCalls().find((call) => call.method === "POST" && call.path.join("/") === "feeds")
        assert.deepStrictEqual(yield* decodeInput(making?.body).pipe(Effect.orDie), {
          name: "Registrations",
          level: "timeSensitive",
          sources: [
            { project: notes, event: EnvelopeName.make("user.registered") },
            { project: landing, event: EnvelopeName.make("signup_completed") },
          ],
        })
        const entries = screen.getByRole("region", { name: "Entries" })
        yield* Effect.promise(() =>
          expect
            .element(entries.getByRole("link", { name: "u-1042" }))
            .toHaveAttribute("href", "/projects/notes/analytics/people?user=u-1042"),
        )
        yield* Effect.promise(() => expect.element(entries.getByText(countryName("JP"))).toBeVisible())
        yield* Effect.promise(() =>
          expect
            .element(entries.getByRole("link", { name: "notes-ios 1.8.2+412" }).first())
            .toHaveAttribute("href", "/projects/notes/analytics/releases/notes-ios/1.8.2%2B412?environment=production"),
        )
        const byProject = screen.getByRole("region", { name: "By project" })
        yield* Effect.promise(() => expect.element(byProject.getByText("Last 24 hours")).toBeVisible())
        yield* expectAccessible()

        // Quieter: it changes in place, and its entries stay.
        yield* Effect.promise(() => screen.getByRole("button", { name: "Change" }).click())
        yield* Effect.promise(() => screen.getByRole("button", { name: "Quiet" }).click())
        yield* Effect.promise(() => screen.getByRole("button", { name: "Save" }).click())
        yield* Effect.promise(() => expect.element(screen.getByText("Quiet", { exact: true })).toBeVisible())
        const changed = apiCalls().find((call) => call.method === "PUT")
        assert.strictEqual((yield* decodeInput(changed?.body).pipe(Effect.orDie)).level, "quiet")

        // Deleted, after a confirmation: back to Feeds, which has none.
        yield* Effect.promise(() => screen.getByRole("button", { name: "Delete" }).click())
        yield* Effect.promise(() => screen.getByRole("button", { name: "Delete the feed" }).click())
        yield* Effect.promise(() => expect.element(screen.getByText(/^No feeds yet\./)).toBeVisible())
        assert.isTrue(apiCalls().some((call) => call.method === "DELETE" && call.path.join("/") === `feeds/${made}`))
      }),
  )

  it.effect("a member sees the feed's entries of the projects they see, and Now lists it, without changing it", () =>
    Effect.gen(function* () {
      const registrations: FeedInput = {
        name: "Registrations",
        level: "timeSensitive",
        sources: [
          { project: notes, event: EnvelopeName.make("user.registered") },
          { project: landing, event: EnvelopeName.make("signup_completed") },
        ],
      }
      answerApi(feedsApi(yield* Clock.currentTimeMillis, mira, registrations))
      window.history.pushState(null, "", "/")
      const screen = yield* Effect.promise(() => render(<App />))

      // Now lists the feed, with how many arrived in the last 24 hours.
      const feeds = screen.getByRole("region", { name: "Feeds" })
      yield* Effect.promise(() => feeds.getByRole("link", { name: /^Registrations/ }).click())

      // Mira sees Notes's registrations only, and nothing to change.
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Registrations" })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByText(countryName("JP"))).not.toBeInTheDocument())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("button", { name: "Change" })).not.toBeInTheDocument(),
      )
      yield* expectAccessible()
    }),
  )
})
