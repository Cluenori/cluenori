import type { FeatureKey } from "@cluenori/foundation"
import type { AppInstallation, TimelineEntry } from "@cluenori/signals"
import { DateTime } from "effect"

import { timelineWordsOf } from "@/app-facts"
import { ago, clockTime, countryName, dayOf, moment } from "@/lib/format"
import type { Route } from "@/router"
import { Link } from "@/router"

/**
 * A person's installations, the latest seen first: each one's component in its color, environment and
 * release, its device and OS, its language and time zone, where it last sent from when known, and
 * when it was first and last seen.
 */
export function InstallationList({
  installations,
  asOf,
  colorOf,
}: {
  readonly installations: ReadonlyArray<AppInstallation>
  /** The time the answer is of, which "last seen" is counted back from. */
  readonly asOf: DateTime.Utc
  readonly colorOf: (component: string) => string
}) {
  const now = DateTime.toEpochMillis(asOf)
  return (
    <ul className="divide-y">
      {installations.map((each) => (
        <li
          key={each.installation}
          className="grid gap-x-6 gap-y-1 px-5 py-3 text-[15px] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
        >
          <span className="flex min-w-0 flex-col">
            <span className="truncate font-mono">{each.release}</span>
            <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <span aria-hidden className="size-2 shrink-0" style={{ backgroundColor: colorOf(each.component) }} />
              <span className="truncate">
                {each.component}, {each.environment}
              </span>
            </span>
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate">
              {each.device.model}, {each.device.platform} {each.device.osVersion}
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {[
                each.device.locale,
                each.device.timeZone,
                ...(each.country === undefined ? [] : [countryName(each.country)]),
              ].join(" · ")}
            </span>
          </span>
          <span className="flex min-w-0 flex-col">
            <span>Last seen {ago(DateTime.toEpochMillis(each.lastSeen), now)}</span>
            <span className="text-sm text-muted-foreground">
              First seen <span className="font-mono">{moment(DateTime.toEpochMillis(each.firstSeen))}</span>
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}

// The timeline's entries grouped by the viewer's day, newest first.
const byDay = (entries: ReadonlyArray<TimelineEntry>) => {
  const groups: Array<{ readonly day: string; readonly entries: Array<TimelineEntry> }> = []
  for (const entry of entries) {
    const day = dayOf(DateTime.toEpochMillis(entry.signal.at))
    const last = groups.at(-1)
    if (last !== undefined && last.day === day) {
      last.entries.push(entry)
    } else {
      groups.push({ day, entries: [entry] })
    }
  }
  return groups
}

/**
 * What a person did, newest first, by day in the viewer's time zone: each signal's time, what it was
 * in words with its details, the feature it was in when the app marked one, and its release when
 * the timeline has more than one.
 */
export function Timeline({
  entries,
  featureLinkOf,
}: {
  readonly entries: ReadonlyArray<TimelineEntry>
  /** The page of a feature, which its key opens. */
  readonly featureLinkOf?: (feature: FeatureKey) => Route
}) {
  const releases = new Set(entries.map((entry) => `${entry.component} ${entry.release}`))
  return (
    <ol className="flex flex-col">
      {byDay(entries).map((group) => (
        <li key={group.day} className="flex flex-col">
          <h2 className="border-b bg-background/40 px-5 py-2 text-sm text-muted-foreground">{group.day}</h2>
          <ol className="divide-y">
            {group.entries.map((entry) => {
              const words = timelineWordsOf(entry)
              const feature = "feature" in entry.signal ? entry.signal.feature : undefined
              return (
                <li
                  key={entry.signal.id}
                  className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 px-5 py-2 text-[15px] sm:grid-cols-[4.5rem_minmax(0,1fr)_auto]"
                >
                  <span className="font-mono text-sm whitespace-nowrap text-muted-foreground">
                    {clockTime(DateTime.toEpochMillis(entry.signal.at))}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="break-words">{words.title}</span>
                    {words.detail !== undefined && (
                      <span className="text-sm break-words text-muted-foreground">{words.detail}</span>
                    )}
                  </span>
                  <span className="col-start-2 flex flex-wrap gap-x-3 text-sm text-muted-foreground sm:col-start-3 sm:justify-end">
                    {feature !== undefined &&
                      (featureLinkOf === undefined ? (
                        <span className="font-mono">{feature}</span>
                      ) : (
                        <Link to={featureLinkOf(feature)} className="font-mono underline-offset-4 hover:underline">
                          {feature}
                        </Link>
                      ))}
                    {releases.size > 1 && <span className="font-mono">{entry.release}</span>}
                  </span>
                </li>
              )
            })}
          </ol>
        </li>
      ))}
    </ol>
  )
}
