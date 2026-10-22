import type { ComponentKey, EnvironmentKey } from "@cluenori/foundation"
import type { Component, DeployTarget } from "@cluenori/projects"
import type {
  ComponentDelivery,
  EnvironmentDelivery,
  NextStep,
  Promotion,
  ReleaseSummary,
  SemanticVersion,
} from "@cluenori/releases"
import { cn } from "cn"
import { DateTime } from "effect"
import { ArrowRightIcon, ArrowUpRightIcon, CornerDownRightIcon } from "lucide-react"

import { lasting } from "@/lib/format"
import { storeStageOf, verdictOf } from "@/project-facts"
import type { DeliveryGroup } from "@/release-facts"
import {
  distributionWords,
  failedEndingOf,
  nextStepWords,
  promotionStates,
  sinceWords,
  stageNoteOf,
} from "@/release-facts"
import type { Route } from "@/router"
import { Link } from "@/router"
import { CommitName } from "@/views/commit-name"
import { PromotionStateWords, toneMark, toneText } from "@/views/promotion-list"
import { verdictClass } from "@/views/release-list"
import { Button } from "@/views/ui/button"
import { VersionLine } from "@/views/version-line"

/** A release, as the page its link opens names it: its component, version and environment. */
type ReleaseOf = Pick<ReleaseSummary, "component" | "release" | "environment">

/** What the Releases page does when someone acts on a component's delivery. */
export type DeliveryActions = {
  /** Takes an environment's next step: confirms building the latest commit, or promoting a release. */
  readonly onNext: (component: ComponentKey, stage: EnvironmentDelivery, next: NextStep) => void
  /** Releases a promotion that App Store review approved, after asking. */
  readonly onReleaseNow: (promotion: Promotion) => void
  readonly onChangeLinks: (component: ComponentKey) => void
  readonly onBump: (component: ComponentKey, version: SemanticVersion) => void
  readonly onSetVersion: (component: ComponentKey) => void
}

// Wide, a component's environments are columns, left to right in the order releases go; on a
// narrower screen they stack, top to bottom.
const columnsOf = (count: number) => `repeat(${Math.max(1, count)}, minmax(0, 1fr))`

/** The release in an environment now: since when and for how long, its commit, its verdict, its store stage. */
function CurrentRelease({
  component,
  stage,
  current,
  asOf,
  linkOf,
}: {
  readonly component: ComponentKey
  readonly stage: EnvironmentKey
  readonly current: NonNullable<EnvironmentDelivery["current"]>
  readonly asOf: DateTime.Utc
  readonly linkOf: (release: ReleaseOf) => Route
}) {
  const { summary } = current
  const since = DateTime.toEpochMillis(current.since)
  const held = Math.max(0, DateTime.toEpochMillis(asOf) - since)
  const verdict = verdictOf(summary)
  const stageWords = summary.store === undefined ? undefined : storeStageOf(summary.store)
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Link
        to={linkOf(summary)}
        className="self-start font-mono text-xl tracking-[-0.01em] wrap-anywhere underline-offset-4 outline-none hover:underline focus-visible:underline"
      >
        {summary.release}
        <span className="sr-only">
          {" "}
          of {component} in {stage}
        </span>
      </Link>
      <p className="text-sm text-muted-foreground">
        For {lasting(held)}, since{" "}
        <time dateTime={DateTime.formatIso(current.since)} className="font-mono">
          {sinceWords(current.since, asOf)}
        </time>
      </p>
      {summary.commit !== undefined && (
        <p className="flex min-w-0 items-baseline gap-2 text-sm">
          <CommitName commit={summary.commit} className="shrink-0" />
          {summary.commit.message !== undefined && (
            <span className="min-w-0 truncate text-muted-foreground" title={summary.commit.message}>
              {summary.commit.message}
            </span>
          )}
        </p>
      )}
      <p
        className={cn(
          "text-sm",
          summary.verdict === "unmeasured" ? "text-muted-foreground" : verdictClass[verdict.tone],
        )}
      >
        {verdict.words}
      </p>
      {stageWords !== undefined && (
        <p className={cn("text-sm", stageWords.failed ? "text-failure" : "text-muted-foreground")}>
          {stageWords.words}
        </p>
      )}
    </div>
  )
}

/** How a deploy target takes a release to its environment: "deploy.yml", "ios.yml, then TestFlight". */
function TargetWords({ target }: { readonly target: DeployTarget }) {
  return (
    <span className="min-w-0 truncate text-[13px] text-muted-foreground">
      {target.workflow !== undefined && <span className="font-mono">{target.workflow}</span>}
      {target.workflow !== undefined && target.appStore !== undefined && ", then "}
      {target.appStore !== undefined && distributionWords[target.appStore.distribution]}
    </span>
  )
}

/** A promotion to an environment that hasn't ended: what goes there, where it stands, its run; one approved in review, to release. */
function PromotionUnderWay({
  promotion,
  linkOf,
  onReleaseNow,
}: {
  readonly promotion: Promotion
  readonly linkOf: (release: ReleaseOf) => Route
  readonly onReleaseNow: (promotion: Promotion) => void
}) {
  return (
    // A promotion just started appears at once, faded in so the change in the environment shows.
    <div className="flex min-w-0 flex-col gap-1.5 border-l-2 border-foreground/25 pl-3 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-150 motion-safe:ease-out">
      <p className="text-sm">
        Promoting{" "}
        <Link
          to={linkOf(promotion)}
          className="font-mono underline-offset-4 outline-none hover:underline focus-visible:underline"
        >
          {promotion.release}
        </Link>{" "}
        here
      </p>
      <PromotionStateWords state={promotion.state} className="text-sm" />
      {promotion.run !== undefined && (
        <a
          href={promotion.run.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 self-start text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
        >
          Run on GitHub
          <span className="sr-only"> of the promotion to {promotion.environment}</span>
          <ArrowUpRightIcon aria-hidden className="size-3.5 shrink-0" />
        </a>
      )}
      {promotion.state === "approved" && (
        <Button size="sm" className="self-start" onClick={() => onReleaseNow(promotion)}>
          Release {promotion.release} on the App Store
        </Button>
      )}
    </div>
  )
}

/**
 * The latest promotion to an environment, when it ended without its release getting there and
 * nothing came since: what went wrong, in its state's color, and its run, where to look. The next
 * step stays, to try again.
 */
function FailedPromotion({
  promotion,
  linkOf,
}: {
  readonly promotion: Promotion
  readonly linkOf: (release: ReleaseOf) => Route
}) {
  const { tone } = promotionStates[promotion.state]
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 border-l-2 border-current pl-3 text-sm", toneText[tone])}>
      <p className="flex min-w-0 items-baseline gap-2">
        <span aria-hidden className={cn("size-2 shrink-0 self-center", toneMark[tone])} />
        <span className="min-w-0">
          Promoting{" "}
          <Link
            to={linkOf(promotion)}
            className="font-mono underline-offset-4 outline-none hover:underline focus-visible:underline"
          >
            {promotion.release}
          </Link>{" "}
          to {promotion.environment} {failedEndingOf(promotion.state)}
        </span>
      </p>
      {promotion.run !== undefined && (
        <a
          href={promotion.run.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 self-start text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
        >
          Run on GitHub
          <span className="sr-only"> of the promotion to {promotion.environment}</span>
          <ArrowUpRightIcon aria-hidden className="size-3.5 shrink-0" />
        </a>
      )}
    </div>
  )
}

/**
 * One of a component's environments, as a stage releases go through: its name, marked when it is
 * production, how releases get there, the release there now, a promotion going there or the last
 * one that failed, and its one next step, a button that says what goes where.
 */
function Stage({
  component,
  stage,
  before,
  first,
  production,
  asOf,
  linkOf,
  actions,
}: {
  readonly component: ComponentKey
  readonly stage: EnvironmentDelivery
  readonly before: EnvironmentDelivery | undefined
  readonly first: boolean
  readonly production: boolean
  readonly asOf: DateTime.Utc
  readonly linkOf: (release: ReleaseOf) => Route
  readonly actions: DeliveryActions
}) {
  const note = stageNoteOf(stage, before)
  const { next } = stage
  return (
    <li
      aria-label={stage.environment}
      className="relative flex min-w-0 flex-col gap-3 border-t px-5 pt-6 pb-5 first:border-t-0 first:pt-4 lg:border-t-0 lg:border-l lg:pt-4 lg:first:border-l-0"
    >
      {/* Releases go from the environment before to this one: the arrow says so, down or across. */}
      {!first && (
        <span
          aria-hidden
          className="absolute -top-3 left-5 grid size-6 place-items-center border bg-card text-muted-foreground lg:top-[1.0625rem] lg:-left-3"
        >
          <ArrowRightIcon className="size-3.5 rotate-90 lg:rotate-0" />
        </span>
      )}
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[15px] font-medium">{stage.environment}</span>
          {production && <span className="border px-1.5 text-xs leading-5 text-muted-foreground">Production</span>}
        </span>
        {stage.target !== undefined && <TargetWords target={stage.target} />}
      </div>
      {stage.current === undefined ? (
        <p className="text-sm text-muted-foreground">Nothing here yet</p>
      ) : (
        <CurrentRelease
          component={component}
          stage={stage.environment}
          current={stage.current}
          asOf={asOf}
          linkOf={linkOf}
        />
      )}
      {stage.promotion !== undefined && (
        <PromotionUnderWay promotion={stage.promotion} linkOf={linkOf} onReleaseNow={actions.onReleaseNow} />
      )}
      {stage.failedPromotion !== undefined && <FailedPromotion promotion={stage.failedPromotion} linkOf={linkOf} />}
      {note !== undefined && <p className="text-sm text-muted-foreground">{note}</p>}
      {next !== undefined && (
        <Button
          variant={next._tag === "promote" ? "default" : "outline"}
          className="mt-auto h-auto min-h-9 self-start py-1.5 text-left whitespace-normal"
          onClick={() => actions.onNext(component, stage, next)}
        >
          {nextStepWords(next, stage.environment)}
        </Button>
      )}
    </li>
  )
}

/**
 * A component that ships with another, inside that one's block: what it runs in each environment,
 * under the parent's environments where they match; nothing to do of its own, as its parent's
 * deploys deploy it.
 */
function Shipping({
  delivery,
  parent,
  name,
  color,
  linkOf,
  asOf,
  onChangeLinks,
}: {
  readonly delivery: ComponentDelivery
  readonly parent: ComponentDelivery
  readonly name: string | undefined
  readonly color: string
  readonly linkOf: (release: ReleaseOf) => Route
  readonly asOf: DateTime.Utc
  readonly onChangeLinks: (component: ComponentKey) => void
}) {
  const parentEnvironments = parent.environments.map((stage) => stage.environment)
  const aligned = delivery.environments.every((stage) => parentEnvironments.includes(stage.environment))
  // Under the parent's columns when every environment it ran in is one of the parent's; else its own.
  const cells: ReadonlyArray<{ readonly environment: EnvironmentKey; readonly stage?: EnvironmentDelivery }> =
    aligned && parentEnvironments.length > 0
      ? parentEnvironments.map((environment) => {
          const stage = delivery.environments.find((each) => each.environment === environment)
          return stage === undefined ? { environment } : { environment, stage }
        })
      : delivery.environments.map((stage) => ({ environment: stage.environment, stage }))
  return (
    <section aria-label={delivery.component} className="border-t bg-background/40">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pt-3">
        <CornerDownRightIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span aria-hidden className="size-2 shrink-0" style={{ backgroundColor: color }} />
        <span className="text-[15px]">{name ?? delivery.component}</span>
        <span className="font-mono text-sm text-muted-foreground">{delivery.component}</span>
        <span className="text-sm text-muted-foreground">
          Ships with {parent.component}: its deploys deploy it, with the same release
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-3 text-muted-foreground lg:ml-auto"
          onClick={() => onChangeLinks(delivery.component)}
        >
          Change links<span className="sr-only"> of {delivery.component}</span>
        </Button>
      </div>
      {cells.length === 0 ? (
        <p className="px-5 pt-1 pb-3 text-sm text-muted-foreground">It hasn&apos;t run anywhere yet.</p>
      ) : (
        <ul className="grid lg:[grid-template-columns:var(--columns)]" style={{ "--columns": columnsOf(cells.length) }}>
          {cells.map(({ environment, stage }) => (
            <li
              key={environment}
              aria-label={environment}
              className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 px-5 py-1.5 text-sm last:pb-3 lg:py-2.5 lg:pb-3"
            >
              <span className="text-muted-foreground">{environment}</span>
              {stage?.current === undefined ? (
                <span className="text-muted-foreground">Not here yet</span>
              ) : (
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                  <Link
                    to={linkOf(stage.current.summary)}
                    className="font-mono wrap-anywhere underline-offset-4 outline-none hover:underline focus-visible:underline"
                  >
                    {stage.current.summary.release}
                    <span className="sr-only">
                      {" "}
                      of {delivery.component} in {environment}
                    </span>
                  </Link>
                  <span className="text-muted-foreground">
                    for{" "}
                    {lasting(Math.max(0, DateTime.toEpochMillis(asOf) - DateTime.toEpochMillis(stage.current.since)))}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * A component's delivery: its name, repository and version, a click from changing its links or its
 * version; each of its environments as a stage, in the order releases go through them; and the
 * components that ship with it. One without deploy targets lists where it ran, with nothing to do.
 */
function ComponentBlock({
  group,
  component,
  colorOf,
  production,
  asOf,
  linkOf,
  bumping,
  bumpProblem,
  actions,
  componentOf,
}: {
  readonly group: DeliveryGroup
  readonly component: Component | undefined
  readonly colorOf: (component: string) => string
  readonly production: ReadonlyArray<EnvironmentKey>
  readonly asOf: DateTime.Utc
  readonly linkOf: (release: ReleaseOf) => Route
  readonly bumping: ComponentKey | undefined
  readonly bumpProblem: { readonly component: ComponentKey; readonly text: string } | undefined
  readonly actions: DeliveryActions
  readonly componentOf: (component: ComponentKey) => Component | undefined
}) {
  const { delivery, shipping } = group
  const key = delivery.component
  const stages = delivery.environments
  const targeted = stages.some((stage) => stage.target !== undefined)
  // A component that ships with one the answer doesn't have stands alone, still with nothing to do.
  const shipsWith = delivery.shipsWith
  return (
    <section aria-label={key} className="flex min-w-0 flex-col">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
        <span className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="size-2.5 shrink-0" style={{ backgroundColor: colorOf(key) }} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-[17px] font-medium tracking-[-0.01em]">{component?.name ?? key}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              <span className="font-mono">{key}</span>
              {component?.repository !== undefined && (
                <a
                  href={`https://github.com/${component.repository}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-1 font-mono underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline"
                >
                  <span className="truncate">{component.repository}</span>
                  <span className="sr-only"> on GitHub</span>
                  <ArrowUpRightIcon aria-hidden className="size-3.5 shrink-0" />
                </a>
              )}
            </span>
          </span>
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 lg:ml-auto">
          {shipsWith === undefined && (
            <VersionLine
              component={key}
              line={delivery.version}
              bumping={bumping === key}
              problem={bumpProblem?.component === key ? bumpProblem.text : undefined}
              onBump={(version) => actions.onBump(key, version)}
              onSet={() => actions.onSetVersion(key)}
            />
          )}
          <Button variant="outline" size="sm" onClick={() => actions.onChangeLinks(key)}>
            Change links<span className="sr-only"> of {key}</span>
          </Button>
        </span>
      </header>
      {shipsWith !== undefined && (
        <p className="border-t px-5 py-3 text-sm text-muted-foreground">
          Ships with {shipsWith}: its deploys deploy it, with the same release.
        </p>
      )}
      {stages.length > 0 && (
        <ol
          aria-label={`Environments of ${key}`}
          className="grid border-t lg:[grid-template-columns:var(--columns)]"
          style={{ "--columns": columnsOf(stages.length) }}
        >
          {stages.map((stage, index) => (
            <Stage
              key={stage.environment}
              component={key}
              stage={stage}
              before={stages[index - 1]}
              first={index === 0}
              production={production.includes(stage.environment)}
              asOf={asOf}
              linkOf={linkOf}
              actions={actions}
            />
          ))}
        </ol>
      )}
      {!targeted && shipsWith === undefined && (
        <p className="border-t px-5 py-3 text-sm text-muted-foreground">
          {stages.length === 0
            ? "No deploy targets, and no release seen yet. Add a deploy target in its links to promote its releases from here."
            : "No deploy targets, so these are where it ran. Add one in its links to promote its releases from here."}
        </p>
      )}
      {shipping.map((child) => (
        <Shipping
          key={child.component}
          delivery={child}
          parent={delivery}
          name={componentOf(child.component)?.name}
          color={colorOf(child.component)}
          linkOf={linkOf}
          asOf={asOf}
          onChangeLinks={actions.onChangeLinks}
        />
      ))}
    </section>
  )
}

/**
 * How each component's releases reach its environments, the Releases page's lead: a block for each
 * component, with what runs in each of its environments now and since when, a promotion going there,
 * and the one next step, each a click away; the components that ship with it inside it, with
 * nothing to do of their own. With none, it says how components appear.
 */
export function DeliveryList({
  groups,
  components,
  colorOf,
  production,
  asOf,
  linkOf,
  bumping,
  bumpProblem,
  actions,
}: {
  readonly groups: ReadonlyArray<DeliveryGroup>
  /** The project's components, for their names and repositories. */
  readonly components: ReadonlyArray<Component>
  readonly colorOf: (component: string) => string
  /** The environments the project calls production, which are marked. */
  readonly production: ReadonlyArray<EnvironmentKey>
  /** When the delivery was asked, which "how long" is measured from. */
  readonly asOf: DateTime.Utc
  /** The page a release opens. */
  readonly linkOf: (release: ReleaseOf) => Route
  /** The component a bump is being saved for. */
  readonly bumping: ComponentKey | undefined
  /** Why the last bump of a component didn't happen, in words. */
  readonly bumpProblem: { readonly component: ComponentKey; readonly text: string } | undefined
  readonly actions: DeliveryActions
}) {
  if (groups.length === 0) {
    return (
      <p className="px-5 py-6 text-sm text-muted-foreground">
        No components yet. A component appears once it sends telemetry with its ingest key.
      </p>
    )
  }
  const componentOf = (key: ComponentKey) => components.find((each) => each.key === key)
  return (
    <div className="flex flex-col divide-y-4 divide-background">
      {groups.map((group) => (
        <ComponentBlock
          key={group.delivery.component}
          group={group}
          component={componentOf(group.delivery.component)}
          colorOf={colorOf}
          production={production}
          asOf={asOf}
          linkOf={linkOf}
          bumping={bumping}
          bumpProblem={bumpProblem}
          actions={actions}
          componentOf={componentOf}
        />
      ))}
    </div>
  )
}
