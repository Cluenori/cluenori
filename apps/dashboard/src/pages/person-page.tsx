import { calendarDayOf } from "@cluenori/foundation"
import type { PersonId, ProjectKey } from "@cluenori/foundation"
import type { AppPerson, AppUserId } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ArrowLeftIcon, CalendarDaysIcon, HistoryIcon, ShapesIcon, SmartphoneIcon, UserSearchIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { appColorOf, dayTicksOf, daySpanText, lastDaysSum, personDaysOf } from "@/app-facts"
import { ago, calendarDayText, count, moment } from "@/lib/format"
import { personAtom, useComponentKeys } from "@/project-data"
import { colorOf } from "@/project-facts"
import { Link, navigate } from "@/router"
import { BarRows } from "@/views/bar-rows"
import { CopyButton } from "@/views/copy-button"
import { Loaded } from "@/views/loaded"
import { Panel, PanelStats } from "@/views/panel"
import { InstallationList, Timeline } from "@/views/person-views"
import { Button, buttonVariants } from "@/views/ui/button"

// How many of a timeline's signals show at first, and how many more each "Show more" adds.
const timelinePage = 200

// The page's heading: the user ID it was found by, else their first, else that they have none.
const headingOf = (lookup: { readonly user: AppUserId } | object, found: AppPerson | undefined) => {
  if ("user" in lookup) {
    return lookup.user
  }
  if (found === undefined) {
    return "A person"
  }
  return found.users[0] ?? "Without a user ID"
}

/**
 * One person of a project, as an item: by Cluenori's ID for them, their page's permanent address,
 * or found by the app's own user ID, which then moves to it. First the answer: when they were last
 * seen, how active they were in the last 30 days, and how many features they used; then the
 * features they use, each opening its story; the days they were active; their installations; what
 * they did, newest first; and a brief to copy for an agent. A person the apps never sent says so.
 */
export function PersonPage(
  props: { readonly project: ProjectKey } & ({ readonly person: PersonId } | { readonly user: AppUserId }),
) {
  const { project } = props
  const answer = useAtomValue(
    personAtom("user" in props ? { project, user: props.user } : { project, person: props.person }),
  )
  const keys = useComponentKeys(project)
  const [shown, setShown] = useState(timelinePage)
  const found = AsyncResult.isSuccess(answer) ? answer.value.person : undefined
  // Found by a user ID: the page moves to the person's own address, which opens them next month too.
  const foundBy = "user" in props ? found?.person : undefined
  useEffect(() => {
    if (foundBy !== undefined) {
      navigate({ page: "person", project, person: foundBy }, { replace: true })
    }
  }, [foundBy, project])

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3 pb-2">
        <Link
          to={{ page: "analytics", project }}
          aria-label="Back to analytics"
          className={buttonVariants({ variant: "outline", size: "icon", className: "mt-0.5" })}
        >
          <ArrowLeftIcon />
        </Link>
        <div className="flex min-w-0 flex-[1_1_16rem] flex-col">
          <h1
            className={
              found !== undefined && found.users.length === 0
                ? "text-2xl font-semibold tracking-[-0.02em]"
                : "font-mono text-2xl font-semibold tracking-[-0.02em] wrap-anywhere"
            }
          >
            {headingOf(props, found)}
          </h1>
          <p className="text-sm break-words text-muted-foreground">
            {found === undefined
              ? "A person of the project"
              : `A person, first seen ${moment(DateTime.toEpochMillis(found.firstSeen))}${found.users.length > 1 ? `, also ${found.users.slice(1).join(", ")}` : ""}`}
          </p>
        </div>
        {found !== undefined && (
          <div className="ml-auto flex items-center gap-3">
            <CopyButton text={agentBrief(project, found)} label="Copy for an agent" />
          </div>
        )}
      </header>

      {/* Someone the apps never sent, or a failed answer, said in a panel with the way back. */}
      {AsyncResult.isFailure(answer) ? (
        <Panel
          icon={UserSearchIcon}
          title="No one to show"
          subtitle={"user" in props ? `For the user ID ${props.user}` : `For the person ${props.person}`}
        >
          <Loaded result={answer}>{() => null}</Loaded>
          <div className="px-5 pb-5">
            <Link to={{ page: "analytics", project }} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Find another person
            </Link>
          </div>
        </Panel>
      ) : (
        <Loaded result={answer}>
          {({ person, asOf }) => {
            const days = personDaysOf(person.days, calendarDayOf(asOf))
            const color = appColorOf(
              undefined,
              person.installations.map((each) => each.component),
              keys,
            )
            const lastMonth = lastDaysSum(days.values, 30) ?? 0
            // Each day the deployment lists is one they were active on, a session that crossed
            // midnight's second day too, though no session started on it.
            const lastThirty = new Set(days.days.slice(-30))
            const activeDays = person.days.filter((each) => lastThirty.has(each.day)).length
            return (
              <div className="flex flex-col gap-4">
                <section aria-label="How active they are" className="border bg-card">
                  <dl className="grid divide-y sm:grid-cols-4 sm:divide-x sm:divide-y-0">
                    {[
                      {
                        label: "Last seen",
                        value: ago(DateTime.toEpochMillis(person.lastSeen), DateTime.toEpochMillis(asOf)),
                        note: moment(DateTime.toEpochMillis(person.lastSeen)),
                      },
                      { label: "Days active", value: count(activeDays), note: "Of the last 30 UTC days" },
                      { label: "Sessions", value: count(lastMonth), note: "In the last 30 UTC days" },
                      {
                        label: "Features",
                        value: count(person.features.filter((each) => each.feature !== undefined).length),
                        note: "Used in 15 months",
                      },
                    ].map((stat) => (
                      <div key={stat.label} className="flex min-w-0 flex-col gap-1 px-5 pt-4 pb-3.5">
                        <dt className="truncate text-sm text-muted-foreground">{stat.label}</dt>
                        <dd className="font-mono text-3xl break-words">{stat.value}</dd>
                        <dd className="truncate text-sm text-muted-foreground">{stat.note}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
                <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <Features project={project} person={person} />
                  <Panel
                    icon={CalendarDaysIcon}
                    title="Days active"
                    subtitle="Their sessions each UTC day, the latest 90 days they were active"
                    badge="UTC"
                  >
                    {days.days.length === 0 ? (
                      <p className="px-5 py-6 text-sm text-muted-foreground">No session of theirs is kept.</p>
                    ) : (
                      <div className="p-5">
                        <BarRows
                          rowHeight={56}
                          label={`${person.users[0] ?? person.person}'s sessions by UTC day.`}
                          rows={[{ label: "Sessions", color, values: days.values }]}
                          ticks={dayTicksOf(days)}
                          timeOf={(span) => daySpanText(days, span)}
                        />
                      </div>
                    )}
                  </Panel>
                </div>
                <Panel
                  icon={SmartphoneIcon}
                  title="Installations"
                  subtitle="The app on each of their devices, the latest seen first"
                >
                  <InstallationList
                    installations={person.installations.toSorted(
                      (left, right) => DateTime.toEpochMillis(right.lastSeen) - DateTime.toEpochMillis(left.lastSeen),
                    )}
                    asOf={asOf}
                    colorOf={(of) => colorOf(of, keys)}
                  />
                  <PanelStats
                    stats={[
                      { label: "First seen", value: moment(DateTime.toEpochMillis(person.firstSeen)) },
                      {
                        label: person.users.length === 1 ? "User ID" : "User IDs",
                        value: person.users.length === 0 ? "none" : person.users.join(", "),
                      },
                      { label: "Person", value: person.person },
                    ]}
                  />
                </Panel>
                <Panel
                  icon={HistoryIcon}
                  title="Timeline"
                  subtitle="What they did, newest first: sessions, launches, screens, events and MetricKit's reports"
                >
                  {person.timeline.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-muted-foreground">Nothing of theirs is kept.</p>
                  ) : (
                    <>
                      <Timeline
                        entries={person.timeline.slice(0, shown)}
                        featureLinkOf={(feature) => ({ page: "feature", project, feature })}
                      />
                      {person.timeline.length > shown && (
                        <div className="flex items-center gap-4 border-t px-5 py-3">
                          <Button variant="outline" size="sm" onClick={() => setShown(shown + timelinePage)}>
                            Show more
                          </Button>
                          <span className="text-sm text-muted-foreground">
                            {count(shown)} of {count(person.timeline.length)}
                          </span>
                        </div>
                      )}
                    </>
                  )}
                </Panel>
              </div>
            )
          }}
        </Loaded>
      )}
    </div>
  )
}

/** The features they used, the last used first, each opening its story. */
function Features({ project, person }: { readonly project: ProjectKey; readonly person: AppPerson }) {
  return (
    <Panel icon={ShapesIcon} title="Features they use" subtitle="Over 15 months, the last used first">
      {person.features.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">The app marked nothing of theirs with a feature.</p>
      ) : (
        <ul className="divide-y">
          {person.features.map((each) => {
            const line = (
              <>
                <span className="flex min-w-0 flex-col">
                  <span
                    className={each.feature === undefined ? "truncate text-muted-foreground" : "truncate font-mono"}
                  >
                    {each.feature ?? "(no feature)"}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {count(each.days)} {each.days === 1 ? "day" : "days"}, {count(each.events)}{" "}
                    {each.events === 1 ? "event" : "events"}, {count(each.screens)}{" "}
                    {each.screens === 1 ? "screen" : "screens"}
                  </span>
                </span>
                <span className="text-right text-sm text-muted-foreground">
                  last on <span className="font-mono">{calendarDayText(each.lastDay)}</span>
                </span>
              </>
            )
            const row = "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 px-5 py-2.5 text-[15px]"
            return (
              <li key={each.feature ?? ""}>
                {each.feature === undefined ? (
                  <div className={row}>{line}</div>
                ) : (
                  <Link to={{ page: "feature", project, feature: each.feature }} className={`${row} hover:bg-muted/40`}>
                    {line}
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

// What an agent needs to look into one person: who they are, where they are, and how to read the rest.
const agentBrief = (project: ProjectKey, person: AppPerson) => {
  const latest = person.installations.toSorted(
    (left, right) => DateTime.toEpochMillis(right.lastSeen) - DateTime.toEpochMillis(left.lastSeen),
  )[0]
  return [
    `Look into a person of Cluenori project ${project}: ${person.person}${person.users.length === 0 ? ", whom the app never identified" : `, the app's user ${person.users.join(", ")}`}.`,
    `First seen ${DateTime.formatIso(person.firstSeen)}, last seen ${DateTime.formatIso(person.lastSeen)}` +
      (latest === undefined
        ? "."
        : `, on ${latest.component} ${latest.release} (${latest.environment}), ${latest.device.model}, ${latest.device.platform} ${latest.device.osVersion}.`),
    ...(person.features.length === 0
      ? []
      : [
          `Features they used, the last first: ${person.features.flatMap((each) => (each.feature === undefined ? [] : [each.feature])).join(", ")}; read one with ./cluenori feature ${project} <feature>.`,
        ]),
    `Read them with the API: GET /api/projects/${project}/people/${person.person}, or ./cluenori person ${project} ${person.person}: their installations, days, features and their latest 1,000 signals.`,
  ].join("\n")
}
