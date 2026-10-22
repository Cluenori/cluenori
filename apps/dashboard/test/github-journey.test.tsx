import { NotAllowed } from "@cluenori/foundation"
import type { GitHubStatus } from "@cluenori/github"
import {
  GitHubAccount,
  GitHubAlreadyConnected,
  GitHubAppForm,
  GitHubStatus as GitHubStatusSchema,
} from "@cluenori/github"
import { assert, describe, expect, it } from "@effect/vitest"
import { DateTime, Effect } from "effect"
import { render } from "vitest-browser-react"

import { App } from "@/app"

import { expectAccessible } from "./accessible.ts"
import type { AnswerApi } from "./fake-api.ts"
import { answerApi, apiCalls, reply } from "./fake-api.ts"
import { mira, notesApi } from "./notes-project.ts"

const app = {
  name: "Cluenori for notes.example",
  slug: "cluenori-for-notes-example",
  url: "https://github.com/apps/cluenori-for-notes-example",
  installUrl: "https://github.com/apps/cluenori-for-notes-example/installations/new",
  organization: GitHubAccount.make("notesapp"),
  connectedAt: DateTime.makeUnsafe("2026-10-20T09:30:00Z"),
}

const connected: GitHubStatus = {
  app,
  installations: [
    {
      account: "notesapp",
      accountType: "Organization",
      repositories: "all",
      url: "https://github.com/organizations/notesapp/settings/installations/71",
    },
    {
      account: "mira-dev",
      accountType: "User",
      repositories: "selected",
      url: "https://github.com/settings/installations/72",
    },
  ],
  problem: "GitHub didn't list the app's installations on mira-dev: try again in a moment",
}

// GitHub's form for a new app, as the API hands it over: posted as it is.
const form = {
  action: "https://github.com/organizations/notesapp/settings/apps/new?state=Zk3Pq9TzX2mV8wYb",
  manifest: '{"name":"Cluenori for notes.example","url":"https://notes.example","public":true}',
}

// The API with Notes in it, and GitHub's connection: none until `status` says one; connecting
// answers GitHub's form, or that it is connected already once `connectedMeanwhile` is; disconnecting
// forgets the app.
const gitHubApi = ({
  status = { installations: [] },
  connectedMeanwhile = false,
}: { readonly status?: GitHubStatus; readonly connectedMeanwhile?: boolean } = {}): AnswerApi => {
  const notes = notesApi()
  let shown = status
  return (call) => {
    if (call.path[0] !== "github") {
      return notes(call)
    }
    if (call.method === "POST" && call.path[1] === "connect") {
      if (connectedMeanwhile) {
        shown = connected
        return reply(GitHubAlreadyConnected, new GitHubAlreadyConnected(), 409)
      }
      return reply(GitHubAppForm, form)
    }
    if (call.method === "DELETE") {
      shown = { installations: [] }
      return Effect.succeed({ status: 204 })
    }
    return reply(GitHubStatusSchema, shown)
  }
}

// The forms the page posts to GitHub, kept here instead of leaving the test's page.
const catchPostsToGitHub = () => {
  const posted: Array<{ readonly action: string; readonly method: string; readonly manifest: unknown }> = []
  const onSubmit = (event: SubmitEvent) => {
    const target = event.target
    if (target instanceof HTMLFormElement && target.action.startsWith("https://github.com/")) {
      event.preventDefault()
      posted.push({ action: target.action, method: target.method, manifest: new FormData(target).get("manifest") })
    }
  }
  document.addEventListener("submit", onSubmit, { capture: true })
  return { posted, stop: () => document.removeEventListener("submit", onSubmit, { capture: true }) }
}

describe("GitHub journey", () => {
  it.effect("connects GitHub from the sidebar: the organization checked, then GitHub's form posted as it is", () =>
    Effect.gen(function* () {
      answerApi(gitHubApi())
      const github = catchPostsToGitHub()
      window.history.pushState(null, "", "/notes")
      const screen = yield* Effect.promise(() => render(<App />))

      // An owner finds it in the sidebar.
      yield* Effect.promise(() => screen.getByRole("link", { name: "GitHub", exact: true }).click())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "GitHub" })).toBeVisible(),
      )
      const connect = screen.getByRole("region", { name: "Connect GitHub" })
      yield* Effect.promise(() =>
        expect.element(connect.getByText(/^GitHub creates Cluenori.s own app in one step/)).toBeVisible(),
      )
      yield* expectAccessible()

      // A login that isn't one is refused with the API's rule, before anything is sent.
      const organization = connect.getByLabelText("Organization that owns the app")
      yield* Effect.promise(() => organization.fill("notes app"))
      yield* Effect.promise(() => connect.getByRole("button", { name: "Connect GitHub" }).click())
      yield* Effect.promise(() => expect.element(connect.getByText(/^Expected a GitHub account's login/)).toBeVisible())
      yield* Effect.promise(() => expect.element(organization).toHaveAttribute("aria-invalid", "true"))
      assert.isFalse(apiCalls().some((call) => call.method === "POST"))
      yield* expectAccessible()

      // Connecting asks for GitHub's form, and posts it there, its manifest as the API gave it.
      yield* Effect.promise(() => organization.fill("notesapp"))
      yield* Effect.promise(() => connect.getByRole("button", { name: "Connect GitHub" }).click())
      yield* Effect.promise(() => expect.poll(() => github.posted.length).toBe(1))
      assert.deepStrictEqual(github.posted, [{ action: form.action, method: "post", manifest: form.manifest }])
      assert.deepStrictEqual(
        apiCalls()
          .filter((call) => call.method === "POST")
          .map((call) => [call.path.join("/"), call.body]),
        [["github/connect", '{"organization":"notesapp"}']],
      )
      yield* Effect.promise(() =>
        expect.element(connect.getByRole("button", { name: "Opening GitHub…" })).toBeDisabled(),
      )
      github.stop()
    }),
  )

  it.effect("comes back connected: the app, who owns it, where it is installed, and disconnecting it", () =>
    Effect.gen(function* () {
      answerApi(gitHubApi({ status: connected }))
      window.history.pushState(null, "", "/github?connected")
      const screen = yield* Effect.promise(() => render(<App />))

      // Said once; the address forgets it, so a reload doesn't say it again.
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("status").getByText("Connected to GitHub")).toBeVisible(),
      )
      yield* Effect.promise(() => expect.poll(() => window.location.search).toBe(""))
      assert.strictEqual(window.location.pathname, "/github")

      const panel = screen.getByRole("region", { name: "GitHub App" })
      yield* Effect.promise(() =>
        expect.element(panel.getByRole("link", { name: `${app.name} on GitHub` })).toHaveAttribute("href", app.url),
      )
      yield* Effect.promise(() => expect.element(panel.getByText("notesapp")).toBeVisible())
      const installed = screen.getByRole("region", { name: "Installed on" })
      yield* Effect.promise(() =>
        expect
          .element(installed.getByRole("link", { name: "Install on an account" }))
          .toHaveAttribute("href", app.installUrl),
      )
      yield* Effect.promise(() => expect.element(installed.getByText(/^GitHub didn't list/)).toBeVisible())
      yield* Effect.promise(() =>
        expect
          .element(installed.getByRole("link", { name: /^notesapp Organization All repositories Change on GitHub/ }))
          .toHaveAttribute("href", "https://github.com/organizations/notesapp/settings/installations/71"),
      )
      yield* Effect.promise(() =>
        expect
          .element(installed.getByRole("link", { name: /^mira-dev Personal account Chosen repositories/ }))
          .toHaveAttribute("href", "https://github.com/settings/installations/72"),
      )
      yield* expectAccessible()

      // Disconnecting says what it does and doesn't, then forgets the app.
      yield* Effect.promise(() => panel.getByRole("button", { name: "Disconnect" }).click())
      const dialog = screen.getByRole("alertdialog", { name: "Disconnect GitHub?" })
      yield* Effect.promise(() =>
        expect.element(dialog.getByText(/The app stays on GitHub until its owner deletes it there\.$/)).toBeVisible(),
      )
      yield* expectAccessible()
      yield* Effect.promise(() => dialog.getByRole("button", { name: "Disconnect" }).click())
      yield* Effect.promise(() => expect.element(screen.getByRole("region", { name: "Connect GitHub" })).toBeVisible())
      assert.isTrue(apiCalls().some((call) => call.method === "DELETE" && call.path.join("/") === "github"))
    }),
  )

  it.effect("says it isn't installed anywhere yet, and that GitHub installed it, coming back from there", () =>
    Effect.gen(function* () {
      answerApi(gitHubApi({ status: { app, installations: [] } }))
      window.history.pushState(null, "", "/github?installation_id=72&setup_action=install")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() =>
        expect.element(screen.getByRole("status").getByText("Installed on GitHub")).toBeVisible(),
      )
      yield* Effect.promise(() =>
        expect
          .element(screen.getByRole("region", { name: "Installed on" }).getByText("Not installed on any account yet."))
          .toBeVisible(),
      )
      yield* Effect.promise(() => expect.poll(() => window.location.search).toBe(""))
      yield* expectAccessible()
    }),
  )

  it.effect("says why connecting didn't finish, and shows the app when it turns out connected already", () =>
    Effect.gen(function* () {
      answerApi(gitHubApi({ connectedMeanwhile: true }))
      window.history.pushState(
        null,
        "",
        `/github?problem=${encodeURIComponent("GitHub sent no app back: connect GitHub again")}`,
      )
      const screen = yield* Effect.promise(() => render(<App />))

      const problem = screen.getByRole("alert").filter({ hasText: "Connecting GitHub didn't finish" })
      yield* Effect.promise(() =>
        expect.element(problem.getByText("GitHub sent no app back: connect GitHub again")).toBeVisible(),
      )
      yield* Effect.promise(() => expect.poll(() => window.location.search).toBe(""))
      yield* expectAccessible()

      // Another owner connected it meanwhile: the page shows their app.
      yield* Effect.promise(() => screen.getByRole("button", { name: "Connect GitHub" }).click())
      yield* Effect.promise(() => expect.element(screen.getByRole("region", { name: "GitHub App" })).toBeVisible())
    }),
  )

  it.effect("tells a member that only an owner connects GitHub, and leaves it out of their sidebar", () =>
    Effect.gen(function* () {
      const notes = notesApi({ as: mira })
      answerApi((call) => (call.path[0] === "github" ? reply(NotAllowed, new NotAllowed(), 403) : notes(call)))
      window.history.pushState(null, "", "/notes")
      const screen = yield* Effect.promise(() => render(<App />))

      yield* Effect.promise(() =>
        expect.element(screen.getByRole("heading", { level: 1, name: "Notes" })).toBeVisible(),
      )
      yield* Effect.promise(() => expect.element(screen.getByRole("link", { name: "Browsers" })).toBeVisible())
      yield* Effect.promise(() =>
        expect.element(screen.getByRole("link", { name: "GitHub", exact: true })).not.toBeInTheDocument(),
      )

      window.history.pushState(null, "", "/github")
      window.dispatchEvent(new PopStateEvent("popstate"))
      yield* Effect.promise(() => expect.element(screen.getByText("Only an owner connects GitHub.")).toBeVisible())
      yield* expectAccessible()
    }),
  )
})
