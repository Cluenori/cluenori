import { CommitSha, Repository, WorkflowFile } from "@bagatka/github"
import { ComponentKey, EnvironmentKey, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import { ComponentName, ProjectName } from "@cluenori/projects"
import { PromotionReason, SemanticVersion } from "@cluenori/releases"
import { assert, layer } from "@effect/vitest"
import { exports } from "cloudflare:workers"
import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

import { baseUrl, CluenoriClient } from "./cluenori-client.ts"

const project = ProjectKey.make("promotions")
const api = ComponentKey.make("notes-api")
const release = ReleaseVersion.make("2026.10.22-f00ba47")
const production = EnvironmentKey.make("production")
const dev = EnvironmentKey.make("dev")

const ManifestFields = Schema.fromJsonString(
  Schema.Struct({ redirect_url: Schema.String, setup_url: Schema.String, public: Schema.Boolean }),
)

// What a browser gets from GitHub's return, without following the redirect.
const githubReturn = (query: string) =>
  Effect.promise(() => exports.default.fetch(`${baseUrl}/api/github/connected${query}`, { redirect: "manual" })).pipe(
    Effect.map((response) => ({ status: response.status, location: response.headers.get("location") ?? "" })),
  )

layer(CluenoriClient.layer, { excludeTestServices: true })("github", (it) => {
  it.effect("starts connecting GitHub for an owner, and refuses a return it didn't start", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const before = yield* client.github.github()
      const form = yield* client.github.connectGitHub({ payload: {} })
      const manifest = yield* Schema.decodeEffect(ManifestFields)(form.manifest)
      const forged = yield* githubReturn("?code=made-up&state=made-up")
      const empty = yield* githubReturn("")

      assert.isUndefined(before.app)
      assert.isTrue(form.action.startsWith("https://github.com/settings/apps/new?state="))
      assert.deepStrictEqual(manifest, {
        redirect_url: `${baseUrl}/api/github/connected`,
        setup_url: `${baseUrl}/github`,
        public: true,
      })
      assert.strictEqual(forged.status, 303)
      assert.isTrue(forged.location.startsWith("/github?problem="))
      assert.include(decodeURIComponent(forged.location), "connect GitHub again")
      assert.strictEqual(empty.status, 303)
      assert.isTrue(empty.location.startsWith("/github?problem="))
      // Nothing was connected by either.
      assert.isUndefined((yield* client.github.github()).app)
    }),
  )

  it.effect("numbers each commit once from the version a member set, for CI asking with the ingest key", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const http = yield* HttpClient.HttpClient
      const numbered = ProjectKey.make("numbered")
      yield* client.projects.createProject({ payload: { key: numbered, name: ProjectName.make("Notes") } })
      const { ingestKey } = yield* client.projects.addComponent({
        params: { project: numbered },
        payload: { key: api, name: ComponentName.make("Notes API") },
      })
      const ask = (path: string, body: object) =>
        http
          .execute(
            HttpClientRequest.post(`${baseUrl}/ingest/v1/releases/${path}`).pipe(
              HttpClientRequest.bearerToken(ingestKey),
              HttpClientRequest.bodyJsonUnsafe(body),
            ),
          )
          .pipe(Effect.flatMap((response) => Effect.map(response.text, (text) => ({ status: response.status, text }))))
      const commit = "a".repeat(40)
      const before = yield* ask("number", { commit })
      const set = yield* client.releases.setVersion({
        params: { project: numbered, component: api },
        payload: { version: SemanticVersion.make("1.4.0"), firstBuild: 57 },
      })
      const first = yield* ask("number", { commit })
      const again = yield* ask("number", { commit })
      const runner = yield* ask("runner", {})
      const { versions } = yield* client.releases.versions({ params: { project: numbered } })

      assert.strictEqual(before.status, 422)
      assert.deepInclude(set, { version: SemanticVersion.make("1.4.0"), lastBuild: 56 })
      assert.strictEqual(first.status, 200)
      assert.include(first.text, '"release":"1.4.0+57"')
      assert.strictEqual(again.text, first.text)
      // Not linked to a repository, so no machine of the founder's can be asked about: the cloud.
      assert.include(runner.text, '"runner":"cloud"')
      assert.deepInclude(versions[0], { component: api, lastBuild: 57 })
    }),
  )

  it.effect("promotes only with a deploy target and GitHub connected, saying what to fix", () =>
    Effect.gen(function* () {
      const client = yield* CluenoriClient
      const http = yield* HttpClient.HttpClient
      yield* client.projects.createProject({ payload: { key: project, name: ProjectName.make("Notes") } })
      const { ingestKey } = yield* client.projects.addComponent({
        params: { project },
        payload: { key: api, name: ComponentName.make("Notes API") },
      })
      const linked = yield* client.projects.linkComponent({
        params: { project, component: api },
        payload: {
          repository: Repository.make("notes/notes-api"),
          deployTargets: [{ environment: production, workflow: WorkflowFile.make("deploy.yml") }],
        },
      })
      // CI reported the release deployed to dev.
      const reported = yield* http.execute(
        HttpClientRequest.post(`${baseUrl}/ingest/v1/releases/report`).pipe(
          HttpClientRequest.bearerToken(ingestKey),
          HttpClientRequest.bodyJsonUnsafe({ release, environment: dev, commit: CommitSha.make("f".repeat(40)) }),
        ),
      )
      const unconnected = yield* client.releases
        .promote({
          params: { project, component: api, release },
          payload: { environment: production, reason: PromotionReason.make("Faster notes") },
        })
        .pipe(Effect.flip)
      const noWorkflow = yield* client.releases
        .promote({ params: { project, component: api, release }, payload: { environment: dev } })
        .pipe(Effect.flip)
      const detail = yield* client.releases.release({ params: { project, component: api, release }, query: {} })

      assert.deepStrictEqual(linked.deployTargets, [
        { environment: production, workflow: WorkflowFile.make("deploy.yml") },
      ])
      assert.strictEqual(reported.status, 204)
      assert.strictEqual(unconnected._tag, "PromotionRefused")
      assert.include(unconnected._tag === "PromotionRefused" ? unconnected.reason : "", "isn't connected to GitHub")
      assert.strictEqual(noWorkflow._tag, "PromotionRefused")
      assert.include(noWorkflow._tag === "PromotionRefused" ? noWorkflow.reason : "", "no deploy target for dev")
      assert.isEmpty(detail.promotions)
      assert.deepStrictEqual(
        detail.deployTargets.map((each) => each.environment),
        [production],
      )
    }),
  )
})
