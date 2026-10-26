import type { FeedEntries, FeedId, FeedInput } from "@cluenori/feeds"
import type { ProjectKey } from "@cluenori/foundation"
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { Exit } from "effect"
import { AsyncResult } from "effect/reactivity"
import { ChartBarIcon, ListIcon, PencilIcon, RssIcon, Trash2Icon } from "lucide-react"
import { useEffect, useState } from "react"

import { count } from "@/lib/format"
import { feedAtom, feedsAtom, meAtom, projectsAtom, removeFeedAtom, saveFeedAtom } from "@/project-data"
import { navigate } from "@/router"
import { FeedLevelLabel, FeedRows } from "@/views/feed-rows"
import { FeedByProject, FeedEntryList, FeedForm, FeedSources } from "@/views/feed-views"
import { failureText, Loaded } from "@/views/loaded"
import { Panel, PanelStats } from "@/views/panel"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/views/ui/alert-dialog"
import { Button } from "@/views/ui/button"

const page = "mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6"

// A feed's page asks for its newest entries this often, so new ones appear without a reload.
const askEvery = 60_000

// The deployment's projects, and their names by key: the key itself until they load.
const useProjects = () => {
  const projects = useAtomValue(projectsAtom)
  const list = AsyncResult.isSuccess(projects) ? projects.value.projects : []
  const nameOf = (key: ProjectKey) => list.find((project) => project.key === key)?.name ?? key
  return { list, nameOf }
}

const useOwner = () => {
  const me = useAtomValue(meAtom)
  return AsyncResult.isSuccess(me) && me.value.role === "owner"
}

/**
 * Saving a feed from its form: whether it is saving, why the last save failed, and `save`, which
 * calls `onSaved` with the feed once it is saved.
 */
const useSaveFeed = (feed: FeedId | undefined, onSaved: (saved: FeedId) => void) => {
  const saveFeed = useAtomSet(saveFeedAtom, { mode: "promiseExit" })
  const [state, setState] = useState<{ readonly saving: boolean; readonly problem?: string }>({ saving: false })
  const save = (input: FeedInput) => {
    setState({ saving: true })
    void saveFeed({ ...(feed === undefined ? {} : { feed }), input }).then((exit) => {
      if (Exit.isSuccess(exit)) {
        setState({ saving: false })
        onSaved(exit.value.id)
      } else {
        setState({ saving: false, problem: failureText(exit.cause) })
      }
    })
  }
  return { ...state, save }
}

/** Making a feed, in a panel above the list; it opens the feed once made. */
function NewFeed({ onClose }: { readonly onClose: () => void }) {
  const { list } = useProjects()
  const { saving, problem, save } = useSaveFeed(undefined, (feed) => navigate({ page: "feed", feed }))
  return (
    <Panel icon={RssIcon} title="New feed" subtitle="Chosen events from your projects, as they arrive">
      <div className="max-w-2xl px-5 py-6">
        <FeedForm projects={list} saving={saving} problem={problem} onSave={save} onCancel={onClose} />
      </div>
    </Panel>
  )
}

/**
 * Feeds: live lists of chosen events across projects, such as every registration in any of them,
 * each with how many arrived lately. An owner makes them.
 */
export function FeedsPage() {
  const feeds = useAtomValue(feedsAtom)
  const owner = useOwner()
  const { nameOf } = useProjects()
  const [making, setMaking] = useState(false)
  return (
    <div className={page}>
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 pb-2">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Feeds</h1>
          <p className="text-sm text-muted-foreground">Chosen events across your projects, as they arrive</p>
        </div>
        {owner && !making && (
          <Button className="ml-auto" onClick={() => setMaking(true)}>
            New feed
          </Button>
        )}
      </header>

      {making && <NewFeed onClose={() => setMaking(false)} />}

      <Panel icon={ListIcon} title="Feeds" subtitle="Entries in the last 24 hours and 7 days, in production">
        <Loaded result={feeds}>
          {(answer) =>
            answer.feeds.length === 0 ? (
              <p className="px-5 py-6 text-[15px] text-muted-foreground">
                {owner
                  ? "No feeds yet. A feed lists one moment from every project, such as each registration, however each project names it, and can alert your phone."
                  : "No feed lists the projects you see yet. An owner makes them."}
              </p>
            ) : (
              <FeedRows feeds={answer.feeds} now={answer.asOf} nameOf={nameOf} />
            )
          }
        </Loaded>
      </Panel>
    </div>
  )
}

/** An older page of a feed's entries, and the one before it on demand. */
function OlderEntries({
  feed,
  before,
  nameOf,
}: {
  readonly feed: FeedId
  readonly before: number
  readonly nameOf: (project: ProjectKey) => string
}) {
  const result = useAtomValue(feedAtom({ feed, before }))
  return <Loaded result={result}>{(answer) => <EntriesWithMore feed={feed} answer={answer} nameOf={nameOf} />}</Loaded>
}

// A page of entries, then a button that shows the older ones, when there are.
function EntriesWithMore({
  feed,
  answer,
  nameOf,
}: {
  readonly feed: FeedId
  readonly answer: FeedEntries
  readonly nameOf: (project: ProjectKey) => string
}) {
  const [more, setMore] = useState(false)
  return (
    <>
      <FeedEntryList entries={answer.entries} nameOf={nameOf} />
      {answer.next !== undefined &&
        (more ? (
          <OlderEntries feed={feed} before={answer.next} nameOf={nameOf} />
        ) : (
          <div className="border-t px-5 py-3">
            <Button variant="outline" size="sm" onClick={() => setMore(true)}>
              Show older
            </Button>
          </div>
        ))}
    </>
  )
}

function RemoveFeed({ feed, name }: { readonly feed: FeedId; readonly name: string }) {
  const [open, setOpen] = useState(false)
  const remove = useAtomSet(removeFeedAtom, { mode: "promiseExit" })
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
        <Trash2Icon />
        Delete
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its entries and alerts go with it. The events themselves stay in each project&apos;s analytics.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep the feed</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              setOpen(false)
              void remove(feed).then((exit) => {
                if (Exit.isSuccess(exit)) {
                  navigate({ page: "feeds" })
                }
              })
            }}
          >
            Delete the feed
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * One feed, live: what it watches and how it alerts, how many arrived in the last 24 hours and 7
 * days and from which projects, and its entries, newest first, asked for again each minute. An owner
 * changes or deletes it here.
 */
export function FeedPage({ feed }: { readonly feed: FeedId }) {
  const result = useAtomValue(feedAtom({ feed }))
  const askAgain = useAtomRefresh(feedAtom({ feed }))
  const owner = useOwner()
  const { list, nameOf } = useProjects()
  const [editing, setEditing] = useState(false)
  const { saving, problem, save } = useSaveFeed(feed, () => setEditing(false))

  // A timer is outside React: the newest entries are asked for each minute while the page is open.
  useEffect(() => {
    const timer = window.setInterval(askAgain, askEvery)
    return () => window.clearInterval(timer)
  }, [askAgain])

  if (!AsyncResult.isSuccess(result)) {
    return (
      <div className={page}>
        <Loaded result={result}>{() => null}</Loaded>
      </div>
    )
  }
  const { summary } = result.value
  return (
    <div className={page}>
      <header className="flex flex-wrap items-start gap-x-6 gap-y-3 pb-2">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">{summary.feed.name}</h1>
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <span aria-hidden className="size-2 animate-pulse rounded-full bg-mint" />
              Live
            </span>
            <FeedLevelLabel level={summary.feed.level} />
          </div>
          <FeedSources feed={summary.feed} nameOf={nameOf} />
        </div>
        {owner && !editing && (
          <div className="ml-auto flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <PencilIcon />
              Change
            </Button>
            <RemoveFeed feed={feed} name={summary.feed.name} />
          </div>
        )}
      </header>

      {editing && (
        <Panel icon={PencilIcon} title="Change the feed" subtitle="Its entries stay">
          <div className="max-w-2xl px-5 py-6">
            <FeedForm
              feed={summary.feed}
              projects={list}
              saving={saving}
              problem={problem}
              onSave={save}
              onCancel={() => setEditing(false)}
            />
          </div>
        </Panel>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <Panel icon={ChartBarIcon} title="By project" subtitle="Last 7 days" className="xl:col-start-2 xl:row-start-1">
          <FeedByProject summary={summary} nameOf={nameOf} />
          <PanelStats
            stats={[
              { label: "Last 24 hours", value: count(summary.lastDay) },
              { label: "Last 7 days", value: count(summary.lastWeek) },
            ]}
          />
        </Panel>
        <Panel
          icon={RssIcon}
          title="Entries"
          subtitle="Newest first, from production"
          className="xl:col-start-1 xl:row-start-1"
        >
          {result.value.entries.length === 0 ? (
            <p className="px-5 py-6 text-[15px] text-muted-foreground">
              Nothing yet. Each of these events the apps send from production appears here within a minute, and stays 90
              days.
            </p>
          ) : (
            <EntriesWithMore feed={feed} answer={result.value} nameOf={nameOf} />
          )}
        </Panel>
      </div>
    </div>
  )
}
