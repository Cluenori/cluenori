import type { AppUsage } from "@cluenori/signals"
import { DateTime } from "effect"
import { RocketIcon, TagIcon } from "lucide-react"

import { calendarDayText, count, ratio, share } from "@/lib/format"
import { Panel } from "@/views/panel"

// How a project's apps are used, as the analytics page shows it: what to do when none sends yet,
// the period's totals, and the releases in use.

/**
 * No app sent anything over the period: what to do, step by step, with the SDK's start for this
 * deployment, rather than empty charts.
 */
export function AppsStart({
  periodText,
  deployment,
}: {
  readonly periodText: string
  /** The deployment's address, which the app's SDK sends to. */
  readonly deployment: string
}) {
  return (
    <Panel
      icon={RocketIcon}
      title="No app sends to this project yet"
      subtitle={`Nothing arrived from an app in ${periodText}`}
    >
      <ol className="flex max-w-3xl list-decimal flex-col gap-3 py-5 pr-5 pl-10 text-[15px]">
        <li>
          Issue an SDK key for the app&apos;s component, under <span className="font-medium">Apps</span> below.
        </li>
        <li>
          Add the Cluenori Swift SDK to the app, and start it with that key, as early as the app starts:
          <pre className="mt-2 border bg-background px-3 py-2 font-mono text-sm whitespace-pre-wrap wrap-anywhere">
            {`Cluenori.start(
    key: "<the SDK key>",
    environment: "production",
    deployment: URL(string: "${deployment}")!)`}
          </pre>
        </li>
        <li>Run the app. Its sessions, releases and features show here as it sends them.</li>
      </ol>
      <p className="border-t px-5 py-3 text-sm text-muted-foreground">
        What an app sent before then shows with a longer period.
      </p>
    </Panel>
  )
}

/**
 * The period's totals under the people counters: everyone active in it, their sessions, sessions per
 * person and per person a day, and installations; and, when the apps first sent within the period,
 * since when it is counted.
 */
export function UsageTotals({
  usage,
  period,
  periodText,
}: {
  readonly usage: AppUsage
  readonly period: { readonly from: DateTime.Utc; readonly to: DateTime.Utc }
  readonly periodText: string
}) {
  const since =
    usage.covered !== undefined && DateTime.isGreaterThan(usage.covered.from, period.from)
      ? calendarDayText(DateTime.formatIso(usage.covered.from).slice(0, 10))
      : undefined
  const stats = [
    { label: `People in ${periodText}`, value: count(usage.people) },
    { label: "Sessions", value: count(usage.sessions) },
    ...(usage.sessionsPerPerson === undefined
      ? []
      : [{ label: "Sessions per person", value: ratio(usage.sessionsPerPerson) }]),
    ...(usage.sessionsPerPersonDay === undefined
      ? []
      : [{ label: "Per person a day", value: ratio(usage.sessionsPerPersonDay) }]),
    { label: "Installations", value: count(usage.installations) },
  ]
  return (
    <section aria-label="The period's totals" className="flex min-w-0 flex-col border bg-card">
      <dl className="grid grid-cols-2 sm:auto-cols-fr sm:grid-flow-col">
        {stats.map((stat) => (
          <div key={stat.label} className="flex min-w-0 flex-col gap-1 px-5 py-3">
            <dt className="truncate text-sm text-muted-foreground">{stat.label}</dt>
            <dd className="truncate font-mono text-lg">{stat.value}</dd>
          </div>
        ))}
      </dl>
      {since !== undefined && (
        <p className="border-t px-5 py-2.5 text-sm text-muted-foreground">
          Counted since {since}, when the apps first sent; earlier days are unknown, not none.
        </p>
      )}
    </section>
  )
}

/** Each release's share of the period's people, the most first. */
export function ReleasesInUse({
  usage,
  colorOfComponent,
}: {
  readonly usage: AppUsage
  readonly colorOfComponent: (component: string) => string
}) {
  const most = Math.max(1, ...usage.releases.map((each) => each.people))
  const environments = new Set(usage.releases.map((each) => each.environment))
  return (
    <Panel icon={TagIcon} title="Releases in use" subtitle="The people on each release over the period, the most first">
      {usage.releases.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">No release sent anything in this period.</p>
      ) : (
        <ul className="flex flex-col gap-3 px-5 py-5">
          {usage.releases.map((each) => (
            <li
              key={`${each.component} ${each.environment} ${each.release}`}
              className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-x-4 text-sm"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-mono text-[15px]">{each.release}</span>
                <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <span
                    aria-hidden
                    className="size-2 shrink-0"
                    style={{ backgroundColor: colorOfComponent(each.component) }}
                  />
                  <span className="truncate">
                    {each.component}
                    {environments.size > 1 && `, ${each.environment}`}
                  </span>
                </span>
              </span>
              <span aria-hidden className="h-2 bg-muted">
                <span
                  className="block h-full"
                  style={{ width: `${(each.people / most) * 100}%`, backgroundColor: colorOfComponent(each.component) }}
                />
              </span>
              <span className="text-right font-mono">
                {count(each.people)} <span className="font-sans text-muted-foreground">people</span>
                <span className="block text-[13px] text-muted-foreground">
                  {share(each.people, usage.people)} · {count(each.sessions)} sessions
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
