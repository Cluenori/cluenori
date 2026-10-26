import type { Feed, FeedEntry, FeedInput, FeedLevel, FeedSummary } from "@cluenori/feeds"
import { sourcesPerFeed } from "@cluenori/feeds"
import type { ProjectKey } from "@cluenori/foundation"
import { EnvelopeName } from "@cluenori/foundation"
import { DateTime, Option, Schema } from "effect"
import { PlusIcon, XIcon } from "lucide-react"
import { useState } from "react"

import { clockTime, count, countryName, dayOf } from "@/lib/format"
import { Link } from "@/router"
import { levelWords, ProjectMark } from "@/views/feed-rows"
import { Segmented } from "@/views/segmented"
import { Button } from "@/views/ui/button"
import { Input } from "@/views/ui/input"
import { NativeSelect, NativeSelectOption } from "@/views/ui/native-select"

const decodeEvent = Schema.decodeUnknownOption(EnvelopeName)

/** The last 7 days' entries by project, the most first, each as a bar against the most. */
export function FeedByProject({
  summary,
  nameOf,
}: {
  readonly summary: FeedSummary
  readonly nameOf: (project: ProjectKey) => string
}) {
  const most = Math.max(1, ...summary.byProject.map((each) => each.lastWeek))
  if (summary.byProject.length === 0) {
    return <p className="px-5 py-6 text-sm text-muted-foreground">Nothing arrived in the last 7 days.</p>
  }
  return (
    <ul className="flex flex-col gap-3 px-5 py-4">
      {summary.byProject.map((each) => (
        <li key={each.project} className="grid grid-cols-[8rem_minmax(0,1fr)_3.5rem] items-center gap-3 text-sm">
          <ProjectMark name={nameOf(each.project)} />
          <span className="h-2 bg-muted">
            <span className="block h-full bg-mint" style={{ width: `${(each.lastWeek / most) * 100}%` }} />
          </span>
          <span className="text-right font-mono">{count(each.lastWeek)}</span>
        </li>
      ))}
    </ul>
  )
}

/** A feed's sources: each project, and the name its apps send the event by there. */
export function FeedSources({
  feed,
  nameOf,
}: {
  readonly feed: Feed
  readonly nameOf: (project: ProjectKey) => string
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {feed.sources.map((source) => (
        <li
          key={`${source.project} ${source.event}`}
          className="inline-flex items-center gap-2 border bg-card px-2.5 py-1 text-sm"
        >
          <ProjectMark name={nameOf(source.project)} />
          <span className="font-mono text-[13px] text-muted-foreground">{source.event}</span>
        </li>
      ))}
    </ul>
  )
}

// Entries grouped by the viewer's day, in the order they were recorded: an event that arrived late
// starts a run of its own day, so each run is known by its first entry, not its day.
const byDay = (entries: ReadonlyArray<FeedEntry>) => {
  const groups: Array<{ readonly day: string; readonly entries: Array<FeedEntry> }> = []
  for (const entry of entries) {
    const day = dayOf(DateTime.toEpochMillis(entry.at))
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
 * A feed's entries, newest first, by day: when, the project and the event its apps sent, the person,
 * who opens their page, where they were, and the app and release it came from, which opens that
 * release's health.
 */
export function FeedEntryList({
  entries,
  nameOf,
}: {
  readonly entries: ReadonlyArray<FeedEntry>
  readonly nameOf: (project: ProjectKey) => string
}) {
  return (
    <ol className="flex flex-col">
      {byDay(entries).map((group) => (
        <li key={group.entries[0]?.id} className="flex flex-col">
          <h2 className="border-b bg-background/40 px-5 py-2 text-sm text-muted-foreground">{group.day}</h2>
          <ol className="divide-y">
            {group.entries.map((entry) => (
              <li
                key={entry.id}
                className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-4 gap-y-1 px-5 py-2.5 text-[15px] md:grid-cols-[3.5rem_minmax(0,14rem)_minmax(0,1fr)_auto] md:items-center"
              >
                <span className="font-mono text-sm text-muted-foreground">
                  {clockTime(DateTime.toEpochMillis(entry.at))}
                </span>
                <span className="flex min-w-0 flex-col">
                  <ProjectMark name={nameOf(entry.project)} />
                  <span className="truncate pl-6 font-mono text-[13px] text-muted-foreground">{entry.event}</span>
                </span>
                <span className="col-start-2 flex min-w-0 flex-wrap items-center gap-x-4 text-sm md:col-start-3">
                  {entry.user === undefined ? (
                    <span className="text-muted-foreground">Not signed in</span>
                  ) : (
                    <Link
                      to={{ page: "person", project: entry.project, user: entry.user }}
                      className="truncate font-mono text-[13px] underline-offset-4 hover:underline"
                    >
                      {entry.user}
                    </Link>
                  )}
                  {entry.country !== undefined && (
                    <span className="text-muted-foreground">{countryName(entry.country)}</span>
                  )}
                </span>
                <Link
                  to={{
                    page: "appRelease",
                    project: entry.project,
                    component: entry.component,
                    release: entry.release,
                    environment: entry.environment,
                  }}
                  className="col-start-2 truncate font-mono text-[13px] text-muted-foreground underline-offset-4 hover:underline md:col-start-4 md:text-right"
                >
                  {entry.component} {entry.release}
                </Link>
              </li>
            ))}
          </ol>
        </li>
      ))}
    </ol>
  )
}

type SourceDraft = { readonly key: number; readonly project: string; readonly event: string }

/** What the form holds, as a feed's input when it is one; why not, when it isn't. */
const inputOf = (
  name: string,
  level: FeedLevel,
  sources: ReadonlyArray<SourceDraft>,
  projects: ReadonlyArray<{ readonly key: ProjectKey }>,
): FeedInput | string => {
  const trimmed = name.trim()
  if (trimmed.length === 0 || trimmed.length > 60) {
    return "Name the feed, in up to 60 characters."
  }
  const chosen: Array<FeedInput["sources"][number]> = []
  for (const source of sources) {
    const project = projects.find((each) => each.key === source.project)
    const event = decodeEvent(source.event.trim())
    if (project === undefined || Option.isNone(event)) {
      return "Each source needs a project and the event's name."
    }
    if (chosen.some((each) => each.project === project.key && each.event === event.value)) {
      return "Each source can be in the feed once."
    }
    chosen.push({ project: project.key, event: event.value })
  }
  if (chosen.length === 0) {
    return "Add a source: a project and the event its apps send."
  }
  return { name: trimmed, level, sources: chosen }
}

/**
 * A feed as its owner writes it: its name, its alert level, and its sources, each a project and the
 * name its apps send the event by there. `feed` fills it in to change one. `onSave` gets the feed's
 * input; `problem` is why the last save failed, and `saving` holds the button while one runs.
 */
export function FeedForm({
  feed,
  projects,
  saving,
  problem,
  onSave,
  onCancel,
}: {
  readonly feed?: Feed
  readonly projects: ReadonlyArray<{ readonly key: ProjectKey; readonly name: string }>
  readonly saving: boolean
  readonly problem: string | undefined
  readonly onSave: (input: FeedInput) => void
  readonly onCancel: () => void
}) {
  const [name, setName] = useState(feed?.name ?? "")
  const [level, setLevel] = useState<FeedLevel>(feed?.level ?? "timeSensitive")
  const [sources, setSources] = useState<ReadonlyArray<SourceDraft>>(() =>
    feed === undefined
      ? [{ key: 0, project: projects[0]?.key ?? "", event: "" }]
      : feed.sources.map((source, index) => ({ key: index, project: source.project, event: source.event })),
  )
  const [tried, setTried] = useState(false)
  const input = inputOf(name, level, sources, projects)
  const change = (key: number, next: Partial<SourceDraft>) =>
    setSources(sources.map((source) => (source.key === key ? { ...source, ...next } : source)))
  const nextKey = Math.max(-1, ...sources.map((source) => source.key)) + 1
  const saveWord = feed === undefined ? "Make the feed" : "Save"
  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        setTried(true)
        if (typeof input !== "string") {
          onSave(input)
        }
      }}
    >
      <label htmlFor="feed-name" className="flex flex-col gap-2 text-sm">
        Name
        <Input
          id="feed-name"
          autoComplete="off"
          maxLength={60}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Registrations"
        />
      </label>
      <div className="flex flex-col gap-2 text-sm">
        <span>Alerts on phones</span>
        <Segmented
          label="Alerts on phones"
          options={(["timeSensitive", "quiet", "none"] as const).map((value) => ({
            value,
            label: levelWords[value].label,
            description: levelWords[value].description,
          }))}
          value={level}
          onChange={setLevel}
          className="self-start"
        />
        <span className="text-muted-foreground">{levelWords[level].description}. At most one a minute.</span>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm">Sources</legend>
        <p className="text-sm text-muted-foreground">
          Each project names the moment its own way: <span className="font-mono">user.registered</span> in one,{" "}
          <span className="font-mono">signup_completed</span> in another. Only production counts.
        </p>
        {sources.map((source, index) => (
          <div key={source.key} className="grid grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] items-center gap-2">
            <NativeSelect
              aria-label={`Project of source ${index + 1}`}
              value={source.project}
              onChange={(event) => change(source.key, { project: event.target.value })}
              className="w-full"
            >
              {projects.map((project) => (
                <NativeSelectOption key={project.key} value={project.key}>
                  {project.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Input
              aria-label={`Event of source ${index + 1}`}
              autoComplete="off"
              className="font-mono"
              value={source.event}
              onChange={(event) => change(source.key, { event: event.target.value })}
              placeholder="user.registered"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove source ${index + 1}`}
              disabled={sources.length === 1}
              onClick={() => setSources(sources.filter((each) => each.key !== source.key))}
            >
              <XIcon />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={sources.length >= sourcesPerFeed}
          onClick={() => setSources([...sources, { key: nextKey, project: projects[0]?.key ?? "", event: "" }])}
        >
          <PlusIcon />
          Add a source
        </Button>
      </fieldset>
      {((tried && typeof input === "string") || problem !== undefined) && (
        <p role="alert" className="text-sm text-failure">
          {tried && typeof input === "string" ? input : problem}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : saveWord}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
