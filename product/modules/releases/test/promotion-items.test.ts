import type { Actor } from "@cluenori/foundation"
import { ComponentKey, EnvironmentKey, MemberId, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import { CommitSha, Repository, WorkflowFile } from "@cluenori/github"
import { BundleId, ComponentName, ProjectName, Projects } from "@cluenori/projects"
import { assert, describe, it } from "@effect/vitest"
import { DateTime, Effect } from "effect"
import { TestClock } from "effect/testing"

import type { Promotion, PromotionState } from "../src/index.ts"
import { PromotionId, promotionItems, ReleaseRecords, releasesModule } from "../src/index.ts"
import { inProject } from "./in-object.ts"

// 2026-10-21T10:00:00Z, on a minute.
const start = 1792576800000
const minute = 60_000
const hour = 60 * minute

const api = ComponentKey.make("notes-api")
const ios = ComponentKey.make("notes-ios")
const jobs = ComponentKey.make("notes-jobs")
const web = ComponentKey.make("notes-web")
const dev = EnvironmentKey.make("dev")
const production = EnvironmentKey.make("production")
const release = ReleaseVersion.make("1.4.0+58")
const member: Actor = { _tag: "Member", id: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53") }
const workflow = WorkflowFile.make("deploy.yml")

// A promotion of `release` of `component` to `environment`, started at `start` and now in `state`;
// ended five minutes later when its state has ended.
const promotion = (
  digit: string,
  component: ComponentKey,
  environment: EnvironmentKey,
  state: PromotionState,
  ended: boolean,
): Promotion => ({
  id: PromotionId.make(`019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f5${digit}`),
  component,
  release,
  environment,
  workflow,
  startedBy: MemberId.make("0199f7a2-5c1e-7d3a-9b2f-4e8a1c6d0f53"),
  startedAt: DateTime.makeUnsafe(start),
  state,
  ...(ended ? { endedAt: DateTime.makeUnsafe(start + 5 * minute) } : {}),
})

// Today's items, as plain words, in one order.
const named = Effect.map(promotionItems, (items) =>
  items.map((item) => `${item.component} ${item.environment} ${item.state}`).toSorted(),
)

describe("Releases' Today detector", () => {
  it.effect("names promotions in production that wait for a member, and a failed one until a release gets there", () =>
    inProject(
      "promotion-items",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        const records = yield* ReleaseRecords
        yield* projects.create(member, ProjectName.make("Notes"))
        for (const component of [api, ios, jobs, web]) {
          yield* projects.addComponent(member, { key: component, name: ComponentName.make(component) })
        }
        yield* projects.linkComponent(member, api, {
          repository: Repository.make("notes/notes-api"),
          deployTargets: [
            { environment: dev, workflow },
            { environment: production, workflow },
          ],
        })
        yield* projects.linkComponent(member, ios, {
          repository: Repository.make("notes/notes-ios"),
          deployTargets: [
            {
              environment: production,
              workflow: WorkflowFile.make("ios.yml"),
              appStore: { bundleId: BundleId.make("com.example.notes"), distribution: "appStore" },
            },
          ],
        })
        for (const component of [jobs, web]) {
          yield* projects.linkComponent(member, component, {
            repository: Repository.make("notes/notes-api"),
            deployTargets: [{ environment: production, workflow }],
          })
        }
        const nothingYet = yield* promotionItems
        // Approved in App Store review; the API's run waits for approval, in production and in dev;
        // the jobs' run failed; the web's was cancelled.
        yield* records.startPromotion(promotion("1", ios, production, "approved", false), member)
        yield* records.startPromotion(promotion("2", api, production, "waiting", false), member)
        yield* records.startPromotion(promotion("3", api, dev, "waiting", false), member)
        yield* records.startPromotion(promotion("4", jobs, production, "failed", true), member)
        yield* records.startPromotion(promotion("5", web, production, "cancelled", true), member)
        yield* TestClock.setTime(start + 10 * minute)
        const waiting = yield* named
        const failed = yield* promotionItems
        const item = failed.find((each) => each.component === jobs)

        // Deployed after all, as by trying again: the failure is behind it.
        yield* TestClock.setTime(start + hour)
        yield* releasesModule.ingest.report.run(jobs, {
          release,
          environment: production,
          commit: CommitSha.make("b".repeat(40)),
        })
        const deployed = yield* named

        assert.deepStrictEqual(nothingYet, [])
        assert.deepStrictEqual(waiting, [
          "notes-api production waiting",
          "notes-ios production approved",
          "notes-jobs production failed",
        ])
        assert.deepStrictEqual(item, {
          _tag: "promotion",
          project: ProjectKey.make("promotion-items"),
          component: jobs,
          environment: production,
          release,
          promotion: PromotionId.make("019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f54"),
          state: "failed",
          startedAt: DateTime.makeUnsafe(start),
          endedAt: DateTime.makeUnsafe(start + 5 * minute),
        })
        assert.deepStrictEqual(deployed, ["notes-api production waiting", "notes-ios production approved"])
      }),
    ),
  )

  it.effect("names one in dev once the project calls dev production", () =>
    inProject(
      "promotion-items-dev",
      start,
      Effect.gen(function* () {
        const projects = yield* Projects
        const records = yield* ReleaseRecords
        yield* projects.create(member, ProjectName.make("Notes"))
        yield* projects.addComponent(member, { key: api, name: ComponentName.make("Notes API") })
        yield* projects.linkComponent(member, api, {
          repository: Repository.make("notes/notes-api"),
          deployTargets: [{ environment: dev, workflow }],
        })
        yield* records.startPromotion(promotion("6", api, dev, "lost", true), member)
        const before = yield* named
        yield* projects.updateSettings(member, { productionEnvironments: [production, dev] })
        const after = yield* named

        assert.deepStrictEqual(before, [])
        assert.deepStrictEqual(after, ["notes-api dev lost"])
      }),
    ),
  )
})
