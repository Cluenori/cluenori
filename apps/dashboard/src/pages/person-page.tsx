import { calendarDayOf } from "@cluenori/foundation"
import type { ProjectKey } from "@cluenori/foundation"
import type { AppUserId } from "@cluenori/signals"
import { useAtomValue } from "@effect/atom-react"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ArrowLeftIcon, CalendarDaysIcon, HistoryIcon, SmartphoneIcon, UserSearchIcon } from "lucide-react"
import { useState } from "react"

import { appColorOf, dayTicksOf, daySpanText, personDaysOf } from "@/app-facts"
import { count, moment } from "@/lib/format"
import { personAtom, useComponentKeys } from "@/project-data"
import { colorOf } from "@/project-facts"
import { Link } from "@/router"
import { BarRows } from "@/views/bar-rows"
import { Loaded } from "@/views/loaded"
import { Panel, PanelStats } from "@/views/panel"
import { InstallationList, Timeline } from "@/views/person-views"
import { Button, buttonVariants } from "@/views/ui/button"

// How many of a timeline's signals show at first, and how many more each "Show more" adds.
const timelinePage = 200

/**
 * One person of a project, found by the app's own user ID: the IDs linked to them, when they were
 * first and last seen, their installations, the days they were active with their sessions, and
 * what they did, newest first. A user ID the apps never sent says so.
 */
export function PersonPage({ project, user }: { readonly project: ProjectKey; readonly user: AppUserId }) {
  const answer = useAtomValue(personAtom({ project, user }))
  const keys = useComponentKeys(project)
  const [shown, setShown] = useState(timelinePage)

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
          <h1 className="font-mono text-2xl font-semibold tracking-[-0.02em] wrap-anywhere">{user}</h1>
          <p className="text-sm text-muted-foreground">A person, by your app&apos;s user ID</p>
        </div>
      </header>

      {/* A user ID the apps never sent, or a failed answer, said in a panel with the way back. */}
      {AsyncResult.isFailure(answer) ? (
        <Panel icon={UserSearchIcon} title="No one to show" subtitle={`For the user ID ${user}`}>
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
            const sessions = person.days.reduce((sum, day) => sum + day.sessions, 0)
            const color = appColorOf(
              undefined,
              person.installations.map((each) => each.component),
              keys,
            )
            return (
              <div className="flex flex-col gap-4">
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
                      { label: "Last seen", value: moment(DateTime.toEpochMillis(person.lastSeen)) },
                      {
                        label: person.users.length === 1 ? "User ID" : "User IDs",
                        value: person.users.join(", "),
                      },
                    ]}
                  />
                </Panel>
                <Panel
                  icon={CalendarDaysIcon}
                  title="Days active"
                  subtitle="Their sessions each UTC day, the latest 90 days they were active"
                  badge="UTC"
                >
                  {days.days.length === 0 ? (
                    <p className="px-5 py-6 text-sm text-muted-foreground">No session of theirs is kept.</p>
                  ) : (
                    <>
                      <div className="p-5">
                        <BarRows
                          rowHeight={56}
                          label={`${user}'s sessions by UTC day.`}
                          rows={[{ label: "Sessions", color, values: days.values }]}
                          ticks={dayTicksOf(days)}
                          timeOf={(span) => daySpanText(days, span)}
                        />
                      </div>
                      <PanelStats
                        stats={[
                          { label: "Days active", value: count(person.days.length) },
                          { label: "Sessions", value: count(sessions) },
                        ]}
                      />
                    </>
                  )}
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
                      <Timeline entries={person.timeline.slice(0, shown)} />
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
