import { ComponentKey, EnvironmentKey, ReleaseVersion } from "@cluenori/foundation"
import { DeployTarget } from "@cluenori/projects"
import type { ComponentDelivery, EnvironmentDelivery } from "@cluenori/releases"
import { PromotionId } from "@cluenori/releases"
import { assert, describe, it } from "@effect/vitest"
import { DateTime } from "effect"

import {
  deliveryGroupsOf,
  nextStepWords,
  promotionNextOf,
  rateOf,
  rateUnitOf,
  shipsWithOptionsOf,
  stageNoteOf,
  whereItRunsOf,
  windowWithin,
} from "@/release-facts"

const api = ComponentKey.make("notes-api")
const worker = ComponentKey.make("notes-worker")
const ios = ComponentKey.make("notes-ios")
const dev = EnvironmentKey.make("dev")
const prod = EnvironmentKey.make("prod")
const first = ReleaseVersion.make("1.0.0+1")
const dated = ReleaseVersion.make("2026.10.21-e91f09c")
const since = DateTime.makeUnsafe("2026-10-22T12:00:00Z")
const deployYml = DeployTarget.fields.workflow.schema.make("deploy.yml")

// An environment of the API's, with `release` there since noon, as delivery answers it.
const stage = (
  environment: EnvironmentKey,
  release: ReleaseVersion | undefined,
  rest: Partial<EnvironmentDelivery> = {},
) => ({
  environment,
  target: { environment, workflow: deployYml },
  ...(release === undefined
    ? {}
    : {
        current: {
          summary: {
            component: api,
            environment,
            release,
            verdict: "tooEarly" as const,
            slower: 0,
            failingMore: 0,
            newErrors: 0,
          },
          since,
        },
      }),
  ...rest,
})

// The API with 1.0.0+1 in dev and the dated release in prod, whose next step is the first.
const apiDelivery: ComponentDelivery = {
  component: api,
  environments: [
    stage(dev, first, { next: { _tag: "buildLatest" } }),
    stage(prod, dated, { next: { _tag: "promote", release: first, from: dev } }),
  ],
}

describe("deliveryGroupsOf", () => {
  it("puts a component that ships with another inside its group, in the project's order", () => {
    const groups = deliveryGroupsOf([
      apiDelivery,
      { component: ios, environments: [] },
      { component: worker, shipsWith: api, environments: [] },
    ])
    assert.deepStrictEqual(
      groups.map((group) => [group.delivery.component, group.shipping.map((each) => each.component)]),
      [
        [api, [worker]],
        [ios, []],
      ],
    )
  })

  it("follows a chain to the component with the deploys, and leaves one shipping with a missing one or a loop alone", () => {
    const jobs = ComponentKey.make("notes-jobs")
    const chain = deliveryGroupsOf([
      apiDelivery,
      { component: worker, shipsWith: api, environments: [] },
      { component: jobs, shipsWith: worker, environments: [] },
    ])
    assert.deepStrictEqual(
      chain[0]?.shipping.map((each) => each.component),
      [worker, jobs],
    )
    const gone = deliveryGroupsOf([{ component: worker, shipsWith: ComponentKey.make("notes-old"), environments: [] }])
    assert.deepStrictEqual(
      gone.map((group) => group.delivery.component),
      [worker],
    )
    const loop = deliveryGroupsOf([
      { component: worker, shipsWith: jobs, environments: [] },
      { component: jobs, shipsWith: worker, environments: [] },
    ])
    assert.deepStrictEqual(
      loop.map((group) => group.delivery.component),
      [worker, jobs],
    )
  })
})

describe("nextStepWords", () => {
  it("says what goes where", () => {
    assert.strictEqual(nextStepWords({ _tag: "buildLatest" }, dev), "Build the latest commit for dev")
    assert.strictEqual(
      nextStepWords({ _tag: "promote", release: first, from: dev }, prod),
      "Promote 1.0.0+1 from dev to prod",
    )
  })
})

describe("whereItRunsOf", () => {
  it("says where a release runs first, then that the environment whose next step it is hasn't it yet", () => {
    assert.deepStrictEqual(whereItRunsOf(apiDelivery, first), [
      { _tag: "runs", environment: dev, since },
      { _tag: "notYet", environment: prod },
    ])
  })

  it("says what runs elsewhere, a promotion of it going somewhere, and when it runs nowhere", () => {
    assert.deepStrictEqual(whereItRunsOf(apiDelivery, dated), [
      { _tag: "runs", environment: prod, since },
      { _tag: "other", environment: dev, release: first },
    ])
    const going: ComponentDelivery = {
      component: api,
      environments: [
        stage(dev, first),
        stage(prod, undefined, {
          promotion: {
            id: PromotionId.make("019a1000-0000-7000-8000-000000000001"),
            component: api,
            release: dated,
            environment: prod,
            startedAt: since,
            state: "running",
          },
        }),
      ],
    }
    assert.deepStrictEqual(whereItRunsOf(going, dated), [
      { _tag: "nowhere" },
      { _tag: "other", environment: dev, release: first },
      { _tag: "going", environment: prod, state: "running" },
    ])
  })
})

describe("promotionNextOf", () => {
  it("finds the environment whose next step promotes a release, and where it comes from; none for another", () => {
    assert.deepStrictEqual(promotionNextOf(apiDelivery, first), {
      target: { environment: prod, workflow: deployYml },
      from: dev,
    })
    assert.isUndefined(promotionNextOf(apiDelivery, dated))
  })
})

describe("stageNoteOf", () => {
  it("says an environment has the release of the one before, or that the one before has none yet", () => {
    assert.strictEqual(stageNoteOf(stage(prod, first), stage(dev, first)), "The same release as dev")
    assert.strictEqual(stageNoteOf(stage(prod, first), stage(dev, undefined)), "Nothing in dev to promote yet")
    // The first, and one with a next step, say nothing.
    assert.isUndefined(stageNoteOf(stage(dev, first), undefined))
    assert.isUndefined(
      stageNoteOf(stage(prod, dated, { next: { _tag: "promote", release: first, from: dev } }), stage(dev, first)),
    )
  })
})

describe("shipsWithOptionsOf", () => {
  it("offers the project's other components, but none that ships with it, directly or through another", () => {
    const jobs = ComponentKey.make("notes-jobs")
    const components = [{ key: api }, { key: ios }, { key: worker, shipsWith: api }, { key: jobs, shipsWith: worker }]
    assert.deepStrictEqual(shipsWithOptionsOf(components, api), [ios])
    assert.deepStrictEqual(shipsWithOptionsOf(components, worker), [api, ios])
    assert.deepStrictEqual(shipsWithOptionsOf(components, ios), [api, worker, jobs])
  })
})

describe("windowWithin", () => {
  it("keeps a zoom inside the life whichever way it was dragged, and at least 3 steps wide", () => {
    // Dragged right to left, past the end.
    assert.deepStrictEqual(windowWithin(12, 4, 10), { first: 4, last: 9 })
    // One step, at the end, widens back into the life rather than past it.
    assert.deepStrictEqual(windowWithin(9, 9, 10), { first: 7, last: 9 })
    assert.deepStrictEqual(windowWithin(-2, 0, 10), { first: 0, last: 2 })
    // A life shorter than that is shown whole.
    assert.deepStrictEqual(windowWithin(1, 1, 2), { first: 0, last: 1 })
  })
})

// A life of `hours`, from midnight UTC on October 20.
const life = (hours: number) => ({
  from: DateTime.makeUnsafe("2026-10-20T00:00:00Z"),
  to: DateTime.makeUnsafe(Date.parse("2026-10-20T00:00:00Z") + hours * 3_600_000),
})

describe("rateOf", () => {
  it("counts a life by the day once it ran a day, else by the hour, so lives of different lengths compare", () => {
    assert.strictEqual(rateUnitOf(life(30)).words, "a day")
    assert.strictEqual(rateUnitOf(life(3)).words, "an hour")
    // 600 over 3 days is 200 a day; over 12 hours, 50 an hour.
    assert.strictEqual(rateOf(600, life(72), rateUnitOf(life(72)).ms), 200)
    assert.strictEqual(rateOf(600, life(12), rateUnitOf(life(12)).ms), 50)
    // A life of minutes counts as an hour, not as a rate it never kept up.
    assert.strictEqual(rateOf(30, life(0.1), 3_600_000), 30)
  })

  it("counts warnings of a long life over the part whose logs are kept, not its whole life", () => {
    // 180 days, logs kept for the last 90: 900 warnings are 10 a day, not 5.
    const long = life(180 * 24)
    const logsFrom = DateTime.makeUnsafe(Date.parse("2026-10-20T00:00:00Z") + 90 * 86_400_000)
    assert.strictEqual(rateOf(900, long, 86_400_000, logsFrom), 10)
  })
})
