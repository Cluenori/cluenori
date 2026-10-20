import { cn } from "cn"
import { useState } from "react"

import { count } from "@/lib/format"
import type { StackFrame, ThrownException } from "@/project-facts"

type Run = { readonly start: number; readonly ours: boolean; readonly frames: ReadonlyArray<StackFrame> }

// Consecutive frames of the same kind, the app's own or libraries', as runs.
const runsOf = (frames: ReadonlyArray<StackFrame>): ReadonlyArray<Run> =>
  frames.reduce<Array<Run>>((runs, frame, index) => {
    const last = runs.at(-1)
    if (last !== undefined && last.ours === frame.ours) {
      runs[runs.length - 1] = { ...last, frames: [...last.frames, frame] }
    } else {
      runs.push({ start: index, ours: frame.ours, frames: [frame] })
    }
    return runs
  }, [])

const libraryFrames = (frames: number) => `${count(frames)} ${frames === 1 ? "frame" : "frames"} in libraries`

function FrameRow({ frame, culprit }: { readonly frame: StackFrame; readonly culprit: boolean }) {
  return (
    <li
      className={cn(
        "border-l-2 px-3 py-2",
        culprit ? "border-l-failure bg-failure/[0.07]" : "border-l-transparent",
        !frame.ours && "text-muted-foreground",
      )}
    >
      <span className="block wrap-anywhere">{frame.method}</span>
      {frame.place !== undefined && <span className="block wrap-anywhere text-muted-foreground">{frame.place}</span>}
    </li>
  )
}

/**
 * An exception's frames, the throwing one first: the app's own in full, the first of them marked as
 * where the error left the app's code; each run of library frames folded into one line that opens it.
 */
function StackTrace({ frames }: { readonly frames: ReadonlyArray<StackFrame> }) {
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set())
  if (frames.length === 0) {
    return <p className="text-sm text-muted-foreground">Sent without frames.</p>
  }
  const culprit = frames.findIndex((frame) => frame.ours)
  const toggle = (start: number) =>
    setOpened((current) => {
      const next = new Set(current)
      if (!next.delete(start)) {
        next.add(start)
      }
      return next
    })
  return (
    <ol className="divide-y border font-mono text-[12.5px] leading-relaxed">
      {runsOf(frames).map((run) =>
        run.ours ? (
          run.frames.map((frame, index) => (
            <FrameRow key={run.start + index} frame={frame} culprit={run.start + index === culprit} />
          ))
        ) : (
          <li key={run.start}>
            <button
              type="button"
              aria-expanded={opened.has(run.start)}
              onClick={() => toggle(run.start)}
              className="w-full px-3 py-2 text-left font-sans text-xs text-muted-foreground outline-none hover:bg-accent/60 hover:text-foreground focus-visible:bg-accent"
            >
              {opened.has(run.start) ? "Hide" : "Show"} {libraryFrames(run.frames.length)}
            </button>
            {opened.has(run.start) && (
              <ol className="divide-y border-t">
                {run.frames.map((frame, index) => (
                  <FrameRow key={index} frame={frame} culprit={false} />
                ))}
              </ol>
            )}
          </li>
        ),
      )}
    </ol>
  )
}

/**
 * An exception as it was thrown: its type, what it said in full, and its stack; then each exception
 * inside it, the one that caused it, the same way.
 */
export function ExceptionView({ chain }: { readonly chain: ReadonlyArray<ThrownException> }) {
  return (
    <div className="flex flex-col gap-6">
      {chain.map((thrown, index) => (
        <section key={index} aria-label={thrown.type} className="flex flex-col gap-3">
          {index > 0 && (
            <span className="text-sm text-muted-foreground">Inner exception, which caused the one above</span>
          )}
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[13px] wrap-anywhere text-failure">{thrown.type}</span>
            {thrown.message.length > 0 && (
              <p className="text-[15px] break-words whitespace-pre-wrap">{thrown.message}</p>
            )}
          </div>
          <StackTrace frames={thrown.frames} />
        </section>
      ))}
    </div>
  )
}
