import type { LifePoint, ReleaseLife } from "@cluenori/releases"
import { DateTime } from "effect"
import { useState } from "react"
import type { KeyboardEvent, PointerEvent } from "react"

import { failureColor, warningColor } from "@/lib/colors"
import { axisTime, calendarDayText, count, moment } from "@/lib/format"
import type { LifeWindow } from "@/release-facts"
import { isWhole, wholeLife, windowWithin } from "@/release-facts"
import type { BarRow, ColumnSpan } from "@/views/bar-rows"
import { BarRows } from "@/views/bar-rows"
import { Button } from "@/views/ui/button"

// How long each step of a life is.
const stepMs: Readonly<Record<ReleaseLife["step"], number>> = { "5m": 300_000, "1h": 3_600_000, "1d": 86_400_000 }

/** How a life is stepped, in words: "By UTC day", "By the hour", "By 5 minutes". */
export const stepWords: Readonly<Record<ReleaseLife["step"], string>> = {
  "5m": "By 5 minutes",
  "1h": "By the hour",
  "1d": "By UTC day",
}

// A row of the chart: what it counts, its color, and its value in a step; only the kinds its
// telemetry sent are drawn.
type Kind = { readonly label: string; readonly color: string; readonly of: (point: LifePoint) => number | undefined }

const kindsOf = (life: ReleaseLife): ReadonlyArray<Kind> => [
  ...(life.points.some((point) => point.people !== undefined)
    ? [{ label: "People", color: "var(--mint)", of: (point: LifePoint) => point.people }]
    : []),
  ...(life.totals.requests === undefined
    ? []
    : [
        { label: "Requests", color: "var(--sky)", of: (point: LifePoint) => point.requests },
        { label: "Failed", color: failureColor, of: (point: LifePoint) => point.failed },
      ]),
  ...(life.totals.warnings === undefined
    ? []
    : [
        { label: "Warnings", color: warningColor, of: (point: LifePoint) => point.warnings },
        { label: "Errors", color: failureColor, of: (point: LifePoint) => point.errors },
      ]),
]

// When a step starts, as the axis and the readout name it: a UTC day, or the viewer's clock.
const startOf = (point: LifePoint) => DateTime.toEpochMillis(point.start)
const dayText = (point: LifePoint) => calendarDayText(DateTime.formatIso(point.start).slice(0, 10))

/** When a zoom of a life is, in words: "Oct 20 – Oct 24", "Oct 20, 14:00 – 18:00". */
export const windowWords = (life: ReleaseLife, zoom: LifeWindow) => {
  const first = life.points[zoom.first]
  const last = life.points[zoom.last]
  if (first === undefined || last === undefined) {
    return ""
  }
  if (life.step === "1d") {
    return zoom.first === zoom.last ? dayText(first) : `${dayText(first)} – ${dayText(last)}`
  }
  return `${moment(startOf(first))} – ${axisTime(startOf(last) + stepMs[life.step])}`
}

/**
 * The whole life of a release in small bars, one a step, with the zoom the chart shows marked:
 * dragging across it zooms the chart to those steps, and the arrow keys move the zoom, `+` and `-`
 * narrow and widen it, and Escape shows the whole life again. It always shows everything, so a
 * zoomed chart never hides what is outside it.
 */
function Overview({
  values,
  zoom,
  valueText,
  onZoom,
}: {
  readonly values: ReadonlyArray<number | undefined>
  readonly zoom: LifeWindow
  /** When the zoom is, for a screen reader. */
  readonly valueText: string
  readonly onZoom: (zoom: LifeWindow) => void
}) {
  const steps = values.length
  const most = Math.max(1, ...values.map((value) => value ?? 0))
  const slot = 100 / Math.max(1, steps)
  const [dragFrom, setDragFrom] = useState<number | undefined>(undefined)
  const stepAt = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return Math.min(steps - 1, Math.max(0, Math.floor(((event.clientX - bounds.left) / bounds.width) * steps)))
  }
  const width = zoom.last - zoom.first + 1
  // The zoom moved by `by` steps, as wide as it is, kept within the life.
  const moved = (by: number) => {
    const first = Math.min(Math.max(0, zoom.first + by), Math.max(0, steps - width))
    return { first, last: first + width - 1 }
  }
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, () => LifeWindow> = {
      ArrowLeft: () => moved(-1),
      ArrowRight: () => moved(1),
      "+": () => windowWithin(zoom.first + 1, zoom.last - 1, steps),
      "=": () => windowWithin(zoom.first + 1, zoom.last - 1, steps),
      "-": () => windowWithin(zoom.first - 1, zoom.last + 1, steps),
      Escape: () => wholeLife(steps),
    }
    const next = moves[event.key]
    if (next !== undefined) {
      event.preventDefault()
      onZoom(next())
    }
  }
  return (
    <div
      // A slider over the life: its value is the zoom, which the keys move, narrow and widen.
      role="slider"
      tabIndex={0}
      aria-label="Its whole life. Drag across it to zoom the chart; the arrow keys move the zoom, + and - narrow and widen it, Escape shows the whole life."
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, steps - 1)}
      aria-valuenow={zoom.first}
      aria-valuetext={valueText}
      className="relative h-8 cursor-crosshair touch-none border-b border-foreground/15 outline-offset-4 select-none focus-visible:outline-1"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragFrom(stepAt(event))
      }}
      onPointerMove={(event) => {
        if (dragFrom !== undefined) {
          onZoom(windowWithin(dragFrom, stepAt(event), steps))
        }
      }}
      onPointerUp={(event) => {
        if (dragFrom !== undefined) {
          const to = stepAt(event)
          // A click without a drag zooms around the step clicked.
          onZoom(to === dragFrom ? windowWithin(to - 1, to + 1, steps) : windowWithin(dragFrom, to, steps))
        }
        setDragFrom(undefined)
      }}
      onKeyDown={key}
    >
      <svg width="100%" height="100%" aria-hidden className="block">
        {values.map((value, step) =>
          value === undefined || value === 0 ? null : (
            <rect
              key={step}
              x={`${step * slot + slot * 0.1}%`}
              width={`${slot * 0.8}%`}
              y={`${100 - Math.max(6, (value / most) * 92)}%`}
              height={`${Math.max(6, (value / most) * 92)}%`}
              fill="var(--muted-foreground)"
              fillOpacity={step >= zoom.first && step <= zoom.last ? 0.9 : 0.35}
            />
          ),
        )}
      </svg>
      {!isWhole(zoom, steps) && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 border-x border-foreground/60 bg-foreground/[0.07]"
          style={{ left: `${zoom.first * slot}%`, width: `${width * slot}%` }}
        />
      )}
    </div>
  )
}

/**
 * A release's life as rows of bars over one time axis, a step a bar: its app's people, its requests
 * and those that failed, its warnings and its errors, each row only when its telemetry sent it, a
 * step it didn't say hatched. The chart starts on its whole life; under it the whole life stays in
 * small bars, where dragging zooms the chart to some of it, and "Whole life" zooms back.
 */
export function LifeChart({ life }: { readonly life: ReleaseLife }) {
  const steps = life.points.length
  // None while it shows the whole life, which grows while the release runs.
  const [zoom, setZoom] = useState<LifeWindow | undefined>(undefined)
  const shown = zoom === undefined ? wholeLife(steps) : windowWithin(zoom.first, zoom.last, steps, 1)
  const zoomTo = (next: LifeWindow) => setZoom(isWhole(next, steps) ? undefined : next)
  const points = life.points.slice(shown.first, shown.last + 1)
  const kinds = kindsOf(life)
  const rows: ReadonlyArray<BarRow> = kinds.map((kind) => {
    const values = points.map(kind.of)
    const known = values.filter((value) => value !== undefined)
    return {
      label: kind.label,
      color: kind.color,
      values,
      note: known.length === 0 ? "unknown" : count(known.reduce((total, value) => total + value, 0)),
    }
  })
  // Every step named when there are few, else four evenly spaced.
  const ticks = (points.length <= 8 ? points.map((_, column) => column) : [0, 1, 2, 3])
    .map((place) => (points.length <= 8 ? place : Math.floor((place * points.length) / 4)))
    .filter((column, index, all) => all.indexOf(column) === index)
    .flatMap((column) => {
      const point = points[column]
      if (point === undefined) {
        return []
      }
      return [{ column, label: life.step === "1d" ? dayText(point) : axisTime(startOf(point)) }]
    })
  const timeOf = (span: ColumnSpan) =>
    windowWords(life, { first: shown.first + span.first, last: shown.first + span.last })
  const overviewKind = kinds.find((kind) => kind.label === "Requests") ?? kinds[0]
  const zoomed = !isWhole(shown, steps)
  return (
    <div className="flex flex-col gap-4 p-5">
      <BarRows
        rows={rows}
        ticks={ticks}
        timeOf={timeOf}
        rowHeight={48}
        label={`Its life ${stepWords[life.step].toLowerCase()}, ${windowWords(life, shown)}.`}
      />
      {steps > 1 && overviewKind !== undefined && (
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-end gap-x-4 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
          <div className="flex flex-col items-start gap-1 text-sm text-muted-foreground">
            {zoomed ? (
              <Button variant="outline" size="sm" onClick={() => setZoom(undefined)}>
                Whole life
              </Button>
            ) : (
              <span className="leading-tight">Drag to zoom</span>
            )}
          </div>
          <Overview
            values={life.points.map(overviewKind.of)}
            zoom={shown}
            valueText={zoomed ? `Zoomed to ${windowWords(life, shown)}` : `The whole life, ${windowWords(life, shown)}`}
            onZoom={zoomTo}
          />
        </div>
      )}
    </div>
  )
}
