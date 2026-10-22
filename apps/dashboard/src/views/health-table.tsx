import { cn } from "cn"

import type { HealthRow } from "@/app-facts"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/views/ui/table"

/**
 * A release's app health beside the release before it's, a measure a row: its value now and before,
 * in yellow when it moved for the worse and mint for the better. A value a release didn't send is
 * "unknown", never zero; without a release before, that column is left out. On a phone the value
 * before follows each value, "was 780 ms", as there is no room for its column.
 */
export function HealthTable({
  rows,
  release,
  previous,
}: {
  readonly rows: ReadonlyArray<HealthRow>
  /** The release's version, naming the first column. */
  readonly release: string
  /** The version of the release before it, naming the second; absent when there is none. */
  readonly previous: string | undefined
}) {
  const unknown = <span className="font-sans text-muted-foreground">unknown</span>
  return (
    <Table className="text-[15px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-auto py-2.5 pr-4 pl-5 text-sm font-normal">Measure</TableHead>
          <TableHead className="h-auto px-4 py-2.5 text-right font-mono text-sm font-normal">{release}</TableHead>
          {previous !== undefined && (
            <TableHead className="hidden h-auto py-2.5 pr-5 pl-4 text-right text-sm font-normal sm:table-cell">
              <span className="font-mono">{previous}</span>
              <span className="block text-[13px]">release before</span>
            </TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.label} className="hover:bg-transparent">
            <TableHead
              scope="row"
              className="h-auto py-2.5 pr-4 pl-5 text-[15px] font-normal whitespace-normal text-foreground"
            >
              {row.label}
            </TableHead>
            <TableCell
              className={cn(
                "py-2.5 pr-5 pl-4 text-right font-mono sm:pr-4",
                row.moved === "worse" && "text-yellow-ink",
                row.moved === "better" && "text-mint-ink",
              )}
            >
              {row.now ?? unknown}
              {row.moved !== undefined && <span className="sr-only">, {row.moved}</span>}
              {/* On a phone the release before's value follows, as the column it has is hidden. */}
              {previous !== undefined && (
                <span className="block text-[13px] text-muted-foreground sm:hidden">was {row.before ?? "unknown"}</span>
              )}
            </TableCell>
            {previous !== undefined && (
              <TableCell className="hidden py-2.5 pr-5 pl-4 text-right font-mono text-muted-foreground sm:table-cell">
                {row.before ?? unknown}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
