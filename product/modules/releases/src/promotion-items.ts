import { isProduction, Projects } from "@cluenori/projects"
import type { PromotionItem, PromotionItemState } from "@cluenori/today"
import { Effect } from "effect"

import { stagesOf } from "./delivery-query.ts"
import type { Promotion } from "./promotion.ts"
import { ReleaseRecords } from "./records.ts"

// What a promotion in its state needs of a member, in Today's words; nothing for the rest. One under
// way needs no one until it is approved in review or its run waits for approval; a cancelled one
// needs no one, since someone chose to stop it.
const needOf = (promotion: Promotion): PromotionItemState | undefined => {
  switch (promotion.state) {
    case "approved":
    case "waiting":
    case "failed":
    case "rejected":
    case "lost":
      return promotion.state
    case "starting":
    case "queued":
    case "running":
    case "processing":
    case "inReview":
    case "releasing":
    case "succeeded":
    case "cancelled":
      return undefined
  }
}

/**
 * Releases' Today detector: the promotions that need a member, in the environments the project calls
 * production, as Today's items, in no order. Each environment's promotion that hasn't ended, when it
 * is approved in App Store review and waits for a member to release it (`approved`), or its run waits
 * for someone to approve its environment on GitHub (`waiting`); and its latest promotion, when it
 * ended without its release getting there (`failed`, `rejected` in App Store review, or `lost`) and
 * nothing reached the environment since it started, as delivery's `failedPromotion` says. A
 * cancelled one needs no one. Reads only the project's database: its settings and promotions, and,
 * when one of them may need a member, its components and the releases the module knows; never
 * GitHub or App Store Connect. Fails with `ProjectNotFound`.
 */
export const promotionItems = Effect.gen(function* () {
  const projects = yield* Projects
  const records = yield* ReleaseRecords
  const project = yield* projects.project
  const settings = yield* projects.settings
  // Every item is one of these promotions, and most projects have none that needs anyone, so the
  // releases, the costly read, are read only when one may.
  const unended = yield* records.unendedPromotions()
  const latest = yield* records.latestPromotions
  const mayNeedMember = [...unended, ...latest].some(
    (promotion) => isProduction(settings, promotion.environment) && needOf(promotion) !== undefined,
  )
  if (!mayNeedMember) {
    return []
  }
  const { components } = yield* stagesOf
  return components.flatMap(({ component, stages }) =>
    stages
      .flatMap((stage) => (isProduction(settings, stage.environment) ? [stage.promotion, stage.failedPromotion] : []))
      .flatMap((promotion): ReadonlyArray<PromotionItem> => {
        const state = promotion === undefined ? undefined : needOf(promotion)
        return promotion === undefined || state === undefined
          ? []
          : [
              {
                _tag: "promotion",
                project: project.key,
                component: component.key,
                environment: promotion.environment,
                release: promotion.release,
                promotion: promotion.id,
                state,
                startedAt: promotion.startedAt,
                ...(promotion.endedAt === undefined ? {} : { endedAt: promotion.endedAt }),
              },
            ]
      }),
  )
}).pipe(Effect.withSpan("Releases.promotionItems"))
