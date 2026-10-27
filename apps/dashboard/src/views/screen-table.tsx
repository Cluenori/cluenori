import type { DurationSpread, ScreenUse, TimingUse } from "@cluenori/signals"

import { count, duration, ratio } from "@/lib/format"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/views/ui/table"

const head = "h-auto px-4 py-2.5 text-right text-sm font-normal"
const cell = "px-4 py-2.5 text-right font-mono"
const unknown = <span className="font-sans text-muted-foreground">—</span>

/** p50 over p95, as the apps measured it; a dash when they didn't. */
function Spread({ spread }: { readonly spread: DurationSpread | undefined }) {
  if (spread === undefined) {
    return unknown
  }
  return (
    <span>
      {duration(spread.p50Ms)}
      <span className="block text-[13px] text-muted-foreground">p95 {duration(spread.p95Ms)}</span>
    </span>
  )
}

/**
 * Screens as the apps measured them: how long each took to show its first content from what the
 * device kept and from the network (p50, and p95 under it), its visits with their time in sight,
 * the CPU time the app used per minute in sight, its hitches while scrolling in ms per second
 * scrolled, and its hangs. A dash is a measure the apps didn't send, never zero.
 */
export function ScreenTable({ rows }: { readonly rows: ReadonlyArray<ScreenUse> }) {
  // Columns follow the table's own width, not the window's: it is a full panel on Analytics and a
  // half-width card in the kit.
  return (
    <div className="@container">
      <Table className="text-[15px]">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="h-auto py-2.5 pr-4 pl-5 text-sm font-normal">Screen</TableHead>
            <TableHead className={head}>Ready, kept</TableHead>
            <TableHead className={head}>Ready, fresh</TableHead>
            <TableHead className={`hidden @xl:table-cell ${head}`}>Visits</TableHead>
            <TableHead className={`hidden @3xl:table-cell ${head}`}>CPU a minute</TableHead>
            <TableHead className={`hidden @3xl:table-cell ${head}`}>Hitches</TableHead>
            <TableHead className={`hidden @lg:table-cell ${head} pr-5`}>Hangs</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.screen ?? ""}>
              <TableHead scope="row" className="h-auto py-2.5 pr-4 pl-5 text-[15px] font-normal whitespace-normal">
                {row.screen === undefined ? (
                  <span className="text-muted-foreground">(no screen)</span>
                ) : (
                  <span className="font-mono text-foreground [overflow-wrap:anywhere]">{row.screen}</span>
                )}
              </TableHead>
              <TableCell className={cell}>
                <Spread spread={row.readyKept} />
              </TableCell>
              <TableCell className={cell}>
                <Spread spread={row.readyFresh} />
              </TableCell>
              <TableCell className={`hidden @xl:table-cell ${cell}`}>
                {row.visible === undefined ? (
                  unknown
                ) : (
                  <span>
                    {count(row.visible.count)}
                    <span className="block text-[13px] text-muted-foreground">{duration(row.visible.p50Ms)} each</span>
                  </span>
                )}
              </TableCell>
              <TableCell className={`hidden @3xl:table-cell ${cell}`}>
                {row.cpuMsPerMinute === undefined ? unknown : duration(row.cpuMsPerMinute)}
              </TableCell>
              <TableCell className={`hidden @3xl:table-cell ${cell}`}>
                {row.hitchMsPerSecond === undefined ? unknown : `${ratio(row.hitchMsPerSecond)} ms/s`}
              </TableCell>
              <TableCell className={`hidden @lg:table-cell ${cell} pr-5`}>
                {/* No hang sent: none happened, or the app can't tell (a command-line program). */}
                {row.hangs === undefined ? (
                  unknown
                ) : (
                  <span className="text-failure">
                    {count(row.hangs.count)}
                    <span className="block text-[13px] text-muted-foreground">p95 {duration(row.hangs.p95Ms)}</span>
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** Timings the apps measured, by the name they gave each: how many, and their p50 and p95. */
export function TimingTable({ rows }: { readonly rows: ReadonlyArray<TimingUse> }) {
  return (
    <Table className="text-[15px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-auto py-2.5 pr-4 pl-5 text-sm font-normal">Timing</TableHead>
          <TableHead className={head}>Measured</TableHead>
          <TableHead className={head}>p50</TableHead>
          <TableHead className={`${head} pr-5`}>p95</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name}>
            <TableHead scope="row" className="h-auto py-2.5 pr-4 pl-5 font-mono text-[15px] font-normal">
              {row.name}
            </TableHead>
            <TableCell className={cell}>{count(row.count)}</TableCell>
            <TableCell className={cell}>{duration(row.p50Ms)}</TableCell>
            <TableCell className={`${cell} pr-5`}>{duration(row.p95Ms)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
