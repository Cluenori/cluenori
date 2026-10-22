import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect, Layer, Option, Redacted, Schema } from "effect"

import type { GitHubUnavailable, WorkflowNotFound, WorkflowRejected } from "../src/index.ts"
import { GitHub, GitHubRefused, Repository, WorkflowFile } from "../src/index.ts"
import type { FakeAnswer } from "./fake-github.ts"
import { fakeGitHub } from "./fake-github.ts"
import { errorJson, repositoryJson, workflowRunJson, workflowRunsJson } from "./github-answers.ts"

const repository = Repository.make("octocat/Hello-World")
const repo = "/repos/octocat/Hello-World"
const workflow = WorkflowFile.make("promote-to-prod.yml")
const visibleRepository: FakeAnswer = { status: 200, body: repositoryJson }

// Runs `program` with GitHub's API answered by `github`, and one token for every repository.
const withGitHub = <A, E>(github: ReturnType<typeof fakeGitHub>, program: Effect.Effect<A, E, GitHub>) =>
  program.pipe(
    Effect.provide(
      GitHub.layer({ token: Redacted.make("test-token-not-a-real-one") }).pipe(Layer.provide(github.layer)),
    ),
  )

// An error's tag and fields, as plain data.
const factsOf = (error: GitHubRefused | GitHubUnavailable | WorkflowNotFound | WorkflowRejected) => {
  switch (error._tag) {
    case "GitHubRefused":
      return { _tag: error._tag, status: error.status, reason: error.reason }
    case "GitHubUnavailable":
      return { _tag: error._tag, reason: error.reason }
    case "WorkflowNotFound":
      return { _tag: error._tag, workflow: error.workflow }
    case "WorkflowRejected":
      return { _tag: error._tag, reason: error.reason }
  }
}

describe("GitHub.layerFor", () => {
  it.effect("asks for the token of each call's repository, and sends that one", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        [`GET ${repo}`]: [visibleRepository],
        ["GET /repos/octo-org/octo-repo"]: [{ status: 200, body: { ...repositoryJson, default_branch: "trunk" } }],
      })
      const asked: Array<Repository> = []
      const tokens = GitHub.layerFor((forRepository) =>
        Effect.sync(() => {
          asked.push(forRepository)
          return Redacted.make(`token-for-${forRepository}`)
        }),
      )
      const branches = yield* Effect.gen(function* () {
        const gitHub = yield* GitHub
        return yield* Effect.all([
          gitHub.defaultBranch(repository),
          gitHub.defaultBranch(Repository.make("octo-org/octo-repo")),
        ])
      }).pipe(Effect.provide(tokens.pipe(Layer.provide(github.layer))))

      assert.deepStrictEqual(branches, ["main", "trunk"])
      assert.deepStrictEqual(asked, ["octocat/Hello-World", "octo-org/octo-repo"])
      assert.deepStrictEqual(
        github.asked.map((question) => question.headers["authorization"]),
        ["Bearer token-for-octocat/Hello-World", "Bearer token-for-octo-org/octo-repo"],
      )
    }),
  )

  it.effect("fails as the token fails, sending nothing", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({ [`GET ${repo}`]: [visibleRepository] })
      const refusing = GitHub.layerFor((forRepository) =>
        Effect.fail(new GitHubRefused({ status: 404, reason: `No app is installed on ${forRepository}` })),
      )
      const refused = yield* Effect.gen(function* () {
        const gitHub = yield* GitHub
        return yield* gitHub.defaultBranch(repository).pipe(Effect.flip)
      }).pipe(Effect.provide(refusing.pipe(Layer.provide(github.layer))))
      assert.deepStrictEqual(factsOf(refused), {
        _tag: "GitHubRefused",
        status: 404,
        reason: "No app is installed on octocat/Hello-World",
      })
      assert.strictEqual(github.asked.length, 0)
    }),
  )
})

describe("GitHub's workflows", () => {
  it.effect("starts a workflow with its inputs, and says which run it started", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        [`POST ${repo}/actions/workflows/promote-to-prod.yml/dispatches`]: [
          {
            status: 200,
            body: {
              workflow_run_id: 30433642,
              run_url: `https://api.github.com${repo}/actions/runs/30433642`,
              html_url: "https://github.com/octocat/Hello-World/actions/runs/30433642",
            },
          },
        ],
      })
      const started = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          return yield* gitHub.dispatchWorkflow(repository, workflow, "main", { version: "2.4.0", track: "production" })
        }),
      )
      assert.deepStrictEqual(
        started,
        Option.some({ id: 30433642, url: "https://github.com/octocat/Hello-World/actions/runs/30433642" }),
      )
      assert.strictEqual(github.asked.length, 1)
      assert.strictEqual(github.asked[0]?.method, "POST")
      assert.deepStrictEqual(github.asked[0]?.body, {
        ref: "main",
        inputs: { version: "2.4.0", track: "production" },
        return_run_details: true,
      })
    }),
  )

  it.effect("has no run to name when GitHub starts one without saying which", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        [`POST ${repo}/actions/workflows/promote-to-prod.yml/dispatches`]: [{ status: 204 }],
      })
      const started = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          return yield* gitHub.dispatchWorkflow(repository, workflow, "v2.4.0", {})
        }),
      )
      assert.deepStrictEqual(started, Option.none())
    }),
  )

  it.effect("tells a missing workflow from a repository the token can't see, and carries GitHub's rejection", () =>
    Effect.gen(function* () {
      const visible = fakeGitHub({ [`GET ${repo}`]: [visibleRepository] })
      const hidden = fakeGitHub({})
      const rejecting = fakeGitHub({
        [`POST ${repo}/actions/workflows/promote-to-prod.yml/dispatches`]: [
          { status: 422, body: errorJson('Unexpected inputs provided: ["track"]', 422) },
        ],
      })
      const dispatch = Effect.gen(function* () {
        const gitHub = yield* GitHub
        return yield* gitHub.dispatchWorkflow(repository, workflow, "main", { track: "production" }).pipe(Effect.flip)
      })
      const missing = yield* withGitHub(visible, dispatch)
      const unseen = yield* withGitHub(hidden, dispatch)
      const rejected = yield* withGitHub(rejecting, dispatch)

      assert.deepStrictEqual(factsOf(missing), { _tag: "WorkflowNotFound", workflow })
      assert.deepStrictEqual(
        visible.asked.map((question) => `${question.method} ${question.url.pathname}`),
        [`POST ${repo}/actions/workflows/promote-to-prod.yml/dispatches`, `GET ${repo}`],
      )
      assert.deepStrictEqual(factsOf(unseen), {
        _tag: "GitHubRefused",
        status: 404,
        reason:
          "GitHub shows no repository octocat/Hello-World to this token: it doesn't exist, or the token can't read it",
      })
      assert.deepStrictEqual(factsOf(rejected), {
        _tag: "WorkflowRejected",
        reason: 'Unexpected inputs provided: ["track"]',
      })
    }),
  )

  it.effect("lists the runs created since a time, by an event, newest first", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        [`GET ${repo}/actions/workflows/promote-to-prod.yml/runs`]: [
          {
            status: 200,
            body: workflowRunsJson([
              workflowRunJson({
                id: 101,
                status: "completed",
                conclusion: "success",
                createdAt: "2026-10-22T10:00:05Z",
              }),
              workflowRunJson({
                id: 103,
                status: "in_progress",
                conclusion: null,
                createdAt: "2026-10-22T10:02:00Z",
                title: "Promote 2.4.0",
              }),
              workflowRunJson({ id: 102, status: "queued", conclusion: null, createdAt: "2026-10-22T10:01:00Z" }),
            ]),
          },
        ],
      })
      const runs = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          return yield* gitHub.workflowRuns(repository, workflow, {
            createdSince: DateTime.makeUnsafe("2026-10-22T10:00:00.250Z"),
            event: "workflow_dispatch",
          })
        }),
      )

      assert.deepStrictEqual(
        runs.map((run) => [run.id, run.status, run.conclusion]),
        [
          [103, "in_progress", undefined],
          [102, "queued", undefined],
          [101, "completed", "success"],
        ],
      )
      assert.deepStrictEqual(runs[0], {
        id: 103,
        status: "in_progress",
        createdAt: DateTime.makeUnsafe("2026-10-22T10:02:00Z"),
        updatedAt: DateTime.makeUnsafe("2026-10-22T10:02:00Z"),
        url: "https://github.com/octocat/Hello-World/actions/runs/103",
        actor: "octocat",
        displayTitle: "Promote 2.4.0",
      })
      // GitHub's search syntax takes the time to the second; the milliseconds round down.
      const query = github.asked[0]?.url.searchParams
      assert.strictEqual(query?.get("created"), ">=2026-10-22T10:00:00Z")
      assert.strictEqual(query?.get("event"), "workflow_dispatch")
      assert.strictEqual(query?.get("per_page"), "20")
      assert.strictEqual(query?.get("exclude_pull_requests"), "true")
    }),
  )

  it.effect("finds a run by its ID, and none for one the repository doesn't have", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        [`GET ${repo}/actions/runs/30433642`]: [
          {
            status: 200,
            body: workflowRunJson({
              id: 30433642,
              status: "completed",
              conclusion: "failure",
              createdAt: "2026-10-22T10:00:05Z",
              updatedAt: "2026-10-22T10:04:30Z",
            }),
          },
        ],
        [`GET ${repo}`]: [visibleRepository],
      })
      const [found, missing, nonsense] = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          return yield* Effect.all([
            gitHub.workflowRun(repository, 30433642),
            gitHub.workflowRun(repository, 30433643),
            gitHub.workflowRun(repository, -1),
          ])
        }),
      )
      assert.strictEqual(Option.getOrUndefined(found)?.conclusion, "failure")
      assert.deepStrictEqual(
        Option.map(found, (run) => DateTime.formatIso(run.updatedAt)),
        Option.some("2026-10-22T10:04:30.000Z"),
      )
      assert.deepStrictEqual(missing, Option.none())
      assert.deepStrictEqual(nonsense, Option.none())
      assert.strictEqual(github.asked.length, 3)
    }),
  )

  it.effect("finds a repository's default branch, and refuses one the token can't see", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({ [`GET ${repo}`]: [visibleRepository] })
      const [branch, refused] = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          return yield* Effect.all([
            gitHub.defaultBranch(repository),
            gitHub.defaultBranch(Repository.make("octocat/private")).pipe(Effect.flip),
          ])
        }),
      )
      assert.strictEqual(branch, "main")
      assert.strictEqual(refused._tag, "GitHubRefused")
    }),
  )
})

const decodeWorkflowFile = (text: string) => Schema.decodeEffect(WorkflowFile)(text).pipe(Effect.result)

describe("GitHub's self-hosted runners", () => {
  it.effect("lists the organization's runners, online or not, with their labels", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        "GET /orgs/octocat/actions/runners": [
          {
            status: 200,
            body: {
              total_count: 2,
              runners: [
                {
                  id: 1,
                  name: "studio-mac",
                  os: "macOS",
                  status: "online",
                  busy: false,
                  labels: [
                    { id: 1, name: "self-hosted", type: "read-only" },
                    { id: 2, name: "local", type: "custom" },
                  ],
                },
                { id: 2, name: "old-box", os: "Linux", status: "offline", busy: false, labels: [] },
              ],
            },
          },
        ],
      })
      const runners = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          return yield* gitHub.selfHostedRunners(repository)
        }),
      )
      assert.deepStrictEqual(runners, [
        { name: "studio-mac", online: true, busy: false, labels: ["self-hosted", "local"] },
        { name: "old-box", online: false, busy: false, labels: [] },
      ])
    }),
  )

  it.effect("is refused for a user's repository, or without the permission", () =>
    Effect.gen(function* () {
      const github = fakeGitHub({
        "GET /orgs/octocat/actions/runners": [{ status: 404, body: errorJson("Not Found", 404) }],
      })
      const refused = yield* withGitHub(
        github,
        Effect.gen(function* () {
          const gitHub = yield* GitHub
          return yield* gitHub.selfHostedRunners(repository)
        }),
      ).pipe(Effect.flip)
      assert.strictEqual(refused._tag, "GitHubRefused")
    }),
  )
})

describe("WorkflowFile", () => {
  it.effect("takes a workflow's file name, and refuses a path or another kind of file", () =>
    Effect.gen(function* () {
      const results = yield* Effect.forEach(
        ["promote-to-prod.yml", "release.yaml", "../secrets.yml", ".github/workflows/ci.yml", "notes.txt", ".yml"],
        decodeWorkflowFile,
      )
      assert.deepStrictEqual(
        results.map((result) => result._tag),
        ["Success", "Success", "Failure", "Failure", "Failure", "Failure"],
      )
    }),
  )
})
