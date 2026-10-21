import type { ComponentProps } from "react"
import { useId } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts"

import { compact, count, dayOf, duration, share } from "@/lib/format"
import { KitCard, KitGroup } from "@/pages/kit-section"
import { loadSeries, sampleNow } from "@/sample/sample-project"
import type { ChartConfig } from "@/views/ui/chart"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/views/ui/chart"

const dayMillis = 86_400_000

// 1 January 1970 was a Thursday: day 4 of a week that starts on Sunday.
const isWeekend = (epochMillis: number) => {
  const weekday = (Math.floor(epochMillis / dayMillis) + 4) % 7
  return weekday === 0 || weekday === 6
}

// The load per day over the last 30 days, less at weekends.
const dailyLoad = loadSeries("30d").points.map((point) => ({
  day: dayOf(point.start),
  count: Math.round(point.count * (isWeekend(point.start) ? 0.62 : 1)),
}))

const loadConfig = { count: { label: "Count", color: "var(--chart-1)" } } satisfies ChartConfig

// Errors per day over the last two weeks, by component; today has the export incident.
const apiErrors = [18, 22, 15, 19, 24, 12, 9, 21, 17, 26, 19, 14, 23, 61] as const
const iosErrors = [6, 4, 7, 5, 9, 3, 2, 6, 8, 5, 7, 4, 6, 9] as const
const webErrors = [3, 2, 4, 1, 2, 1, 0, 3, 2, 4, 2, 1, 3, 2] as const

const dailyErrors = apiErrors.map((api, index) => ({
  day: dayOf(sampleNow - (apiErrors.length - 1 - index) * dayMillis),
  api,
  ios: iosErrors[index] ?? 0,
  web: webErrors[index] ?? 0,
}))

const componentConfig = {
  api: { label: "folio-api", color: "var(--chart-1)" },
  ios: { label: "folio-ios", color: "var(--chart-2)" },
  web: { label: "folio-web", color: "var(--chart-3)" },
} satisfies ChartConfig

// p95 latency in each release of folio-api.
const releaseLatency = [
  { release: "2.10.0+350", export: 3_900, feed: 610, notes: 90 },
  { release: "2.11.0+362", export: 3_600, feed: 580, notes: 88 },
  { release: "2.12.0+371", export: 3_700, feed: 540, notes: 80 },
  { release: "2.12.1+375", export: 3_100, feed: 520, notes: 76 },
  { release: "2.13.0+386", export: 2_800, feed: 470, notes: 70 },
  { release: "2.13.1+390", export: 2_900, feed: 455, notes: 66 },
  { release: "2.13.2+398", export: 2_700, feed: 430, notes: 64 },
  { release: "2.14.0+412", export: 4_200, feed: 420, notes: 64 },
] as const

const latencyConfig = {
  export: { label: "POST /api/export", color: "var(--chart-1)" },
  feed: { label: "GET /api/feed", color: "var(--chart-2)" },
  notes: { label: "GET /api/notes/{id}", color: "var(--chart-3)" },
} satisfies ChartConfig

const latencyLabels: Readonly<Record<string, string>> = {
  export: latencyConfig.export.label,
  feed: latencyConfig.feed.label,
  notes: latencyConfig.notes.label,
}

// The load in the last day, by component. A slice's fill names the chart's own variable, which only
// exists inside the chart; the legend beside it takes the color from the config.
const loadByComponent = [
  { component: "api", count: 141_211, fill: "var(--color-api)" },
  { component: "web", count: 52_880, fill: "var(--color-web)" },
  { component: "ios", count: 23_410, fill: "var(--color-ios)" },
] as const

const totalCount = loadByComponent.reduce((sum, entry) => sum + entry.count, 0)

const axisProps = { tickLine: false, axisLine: false } as const

function LoadArea() {
  const id = useId().replaceAll(":", "")
  return (
    <ChartContainer config={loadConfig} className="aspect-auto h-60 w-full">
      <AreaChart data={dailyLoad} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-count)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--color-count)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="day" {...axisProps} minTickGap={40} />
        <YAxis
          orientation="right"
          width={44}
          {...axisProps}
          tickCount={4}
          tickFormatter={(value: number) => compact(value)}
        />
        <ChartTooltip cursor={{ stroke: "var(--border)" }} content={<ChartTooltipContent indicator="line" />} />
        <Area
          dataKey="count"
          type="monotone"
          stroke="var(--color-count)"
          strokeWidth={2}
          fill={`url(#${id}-fill)`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}

function ErrorsStacked() {
  return (
    <ChartContainer config={componentConfig} className="aspect-auto h-60 w-full">
      <BarChart data={dailyErrors} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap="22%">
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="day" {...axisProps} minTickGap={24} />
        <YAxis orientation="right" width={32} {...axisProps} tickCount={4} allowDecimals={false} />
        <ChartTooltip cursor={{ fill: "var(--muted)", fillOpacity: 0.6 }} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar
          dataKey="api"
          stackId="errors"
          fill="var(--color-api)"
          stroke="var(--card)"
          strokeWidth={1}
          isAnimationActive={false}
        />
        <Bar
          dataKey="ios"
          stackId="errors"
          fill="var(--color-ios)"
          stroke="var(--card)"
          strokeWidth={1}
          isAnimationActive={false}
        />
        <Bar
          dataKey="web"
          stackId="errors"
          fill="var(--color-web)"
          stroke="var(--card)"
          strokeWidth={1}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ChartContainer>
  )
}

// One line of the latency tooltip: the operation's color, its name, and its p95.
const latencyLine: NonNullable<ComponentProps<typeof ChartTooltipContent>["formatter"]> = (value, name, item) => (
  <div className="flex w-full items-center gap-2">
    <span className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
    <span className="text-muted-foreground">{latencyLabels[String(name)] ?? String(name)}</span>
    <span className="ml-auto pl-3 font-medium text-foreground tabular-nums">
      {typeof value === "number" ? duration(value) : ""}
    </span>
  </div>
)

function LatencyLines() {
  return (
    <ChartContainer config={latencyConfig} className="aspect-auto h-60 w-full">
      <LineChart data={[...releaseLatency]} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="release" {...axisProps} minTickGap={24} padding={{ left: 12, right: 12 }} />
        <YAxis
          orientation="right"
          width={52}
          {...axisProps}
          tickCount={4}
          tickFormatter={(value: number) => duration(value)}
        />
        <ChartTooltip cursor={{ stroke: "var(--border)" }} content={<ChartTooltipContent formatter={latencyLine} />} />
        <ChartLegend content={<ChartLegendContent />} />
        {(["export", "feed", "notes"] as const).map((key) => (
          <Line
            key={key}
            dataKey={key}
            type="monotone"
            stroke={`var(--color-${key})`}
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--card)", strokeWidth: 2 }}
            activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  )
}

function LoadDonut() {
  return (
    <div className="grid items-center gap-6 sm:grid-cols-[auto_1fr]">
      <div className="relative mx-auto size-52">
        <ChartContainer config={componentConfig} className="aspect-square size-52">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent hideLabel nameKey="component" />} />
            <Pie
              data={[...loadByComponent]}
              dataKey="count"
              nameKey="component"
              innerRadius={64}
              outerRadius={96}
              paddingAngle={2}
              cornerRadius={4}
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
            />
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tracking-tight tabular-nums">{compact(totalCount)}</span>
          <span className="text-xs text-muted-foreground">in all</span>
        </div>
      </div>
      <ul className="flex flex-col gap-3 text-sm">
        {loadByComponent.map((entry) => (
          <li key={entry.component} className="flex items-center gap-3">
            <span
              className="size-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: componentConfig[entry.component].color }}
            />
            <span>{componentConfig[entry.component].label}</span>
            <span className="ml-auto text-muted-foreground tabular-nums">{count(entry.count)}</span>
            <span className="w-12 text-right tabular-nums">{share(entry.count, totalCount)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Recharts in the theme: the chart tokens, the chart container and its tooltip and legend. */
export function KitCharts() {
  return (
    <KitGroup
      id="charts"
      title="Charts"
      description="Recharts inside the chart container, colored with var(--chart-1) to var(--chart-5) in order. Hover them."
    >
      <KitCard
        title="Load per day"
        description="An area chart of the last 30 days, fewer at weekends."
        files={["chart.tsx"]}
      >
        <LoadArea />
      </KitCard>
      <KitCard
        title="Errors by component"
        description="A stacked bar for each of the last 14 days. Today has the export incident."
        files={["chart.tsx"]}
      >
        <ErrorsStacked />
      </KitCard>
      <KitCard
        title="p95 latency by release"
        description="A line for each operation of folio-api. Exports got slower in 2.14.0+412."
        files={["chart.tsx"]}
      >
        <LatencyLines />
      </KitCard>
      <KitCard
        title="Load by component"
        description="A donut of the last day, with the numbers beside it."
        files={["chart.tsx"]}
      >
        <LoadDonut />
      </KitCard>
    </KitGroup>
  )
}
