import type { FeatureUse } from "@cluenori/signals"

import { bytes, count, share } from "@/lib/format"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/views/ui/table"

/** What a feature row is called: its key, or "(no feature)" for what the app marked with none. */
export const featureName = (row: FeatureUse) => row.feature ?? "(no feature)"

/**
 * Features by use: each one's key, the people who did anything in it with a bar of their share of
 * the period's people, its events and screens, and the app's peak memory there (p95) where it was
 * measured. The row without a key is what the app marked with no feature.
 */
export function FeatureTable({
  rows,
  people,
  color,
}: {
  readonly rows: ReadonlyArray<FeatureUse>
  /** Everyone active in the period, which each feature's people are a share of; absent when unknown. */
  readonly people: number | undefined
  /** The color of the component the features are of, or of the apps. */
  readonly color: string
}) {
  const most = Math.max(1, ...rows.map((row) => row.people))
  return (
    <Table className="text-[15px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-auto py-2.5 pr-4 pl-5 text-sm font-normal">Feature</TableHead>
          <TableHead className="h-auto w-[38%] px-4 py-2.5 text-sm font-normal">People</TableHead>
          <TableHead className="hidden h-auto px-4 py-2.5 text-right text-sm font-normal sm:table-cell">
            Events
          </TableHead>
          <TableHead className="hidden h-auto px-4 py-2.5 text-right text-sm font-normal sm:table-cell">
            Screens
          </TableHead>
          <TableHead className="hidden h-auto py-2.5 pr-5 pl-4 text-right text-sm font-normal md:table-cell">
            Peak memory p95
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={featureName(row)}>
            <TableHead
              scope="row"
              className="h-auto py-2.5 pr-4 pl-5 text-[15px] font-normal whitespace-normal text-foreground"
            >
              <span className={row.feature === undefined ? "text-muted-foreground" : "font-mono"}>
                {featureName(row)}
              </span>
              {/* On a phone the counts the columns hide follow the name. */}
              <span className="block font-mono text-[13px] text-muted-foreground sm:hidden">
                {count(row.events)} events, {count(row.screens)} screens
              </span>
            </TableHead>
            <TableCell className="px-4 py-2.5">
              <span className="flex items-center gap-3">
                <span aria-hidden className="h-2 min-w-0 flex-1 bg-muted">
                  <span
                    className="block h-full"
                    style={{ width: `${(row.people / most) * 100}%`, backgroundColor: color }}
                  />
                </span>
                <span className="w-20 shrink-0 text-right font-mono">
                  {count(row.people)}
                  {people !== undefined && (
                    <span className="block text-[13px] text-muted-foreground">{share(row.people, people)}</span>
                  )}
                </span>
              </span>
            </TableCell>
            <TableCell className="hidden px-4 py-2.5 text-right font-mono sm:table-cell">{count(row.events)}</TableCell>
            <TableCell className="hidden px-4 py-2.5 text-right font-mono sm:table-cell">
              {count(row.screens)}
            </TableCell>
            <TableCell className="hidden py-2.5 pr-5 pl-4 text-right font-mono md:table-cell">
              {row.memory === undefined ? (
                <span className="font-sans text-muted-foreground">not measured</span>
              ) : (
                bytes(row.memory.peakP95Bytes)
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
