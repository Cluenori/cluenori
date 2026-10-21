import type { ComparedOperation } from "@cluenori/releases"
import { cn } from "cn"

import { count, duration, share } from "@/lib/format"
import type { Route } from "@/router"
import { Link } from "@/router"
import { OperationName } from "@/views/operation-name"

/** What moved in a list of compared operations, and whether for the worse, which colors it. */
export type Moved = { readonly measure: "p95" | "errorRate"; readonly worse: boolean }

// Wide, each measure is two columns, now and before, under one name; on a phone, they follow the
// operation's name on a line, each named.
const grid = "sm:grid sm:grid-cols-[minmax(0,1fr)_4.5rem_6.5rem_4rem_5.5rem_4.5rem_6.5rem] sm:items-baseline sm:gap-x-3"

/** One measure in a release and in the one before: "210 ms" and "was 106 ms". */
function Measure({
  label,
  now,
  before,
  worse,
}: {
  readonly label: string
  readonly now: string
  readonly before: string
  /** The color of the value when it moved for the worse: yellow for slower, red for failing. */
  readonly worse: "text-yellow" | "text-failure" | undefined
}) {
  return (
    <span className="flex items-baseline gap-1.5 sm:contents">
      <span className="text-muted-foreground sm:hidden">{label}</span>
      <span className={cn("font-mono", worse)}>{now}</span>
      <span className="font-mono text-muted-foreground">was {before}</span>
    </span>
  )
}

/**
 * Operations in a release beside the release before it: p95, error rate, and runs, now and before,
 * each pair side by side, the one that moved in color when it moved for the worse. Each row opens
 * its operation.
 */
export function ComparedTable({
  rows,
  moved,
  linkOf,
}: {
  readonly rows: ReadonlyArray<ComparedOperation>
  readonly moved: Moved
  /** The page each row opens. */
  readonly linkOf: (row: ComparedOperation) => Route
}) {
  const worse = (measure: Moved["measure"], color: "text-yellow" | "text-failure") =>
    moved.worse && moved.measure === measure ? color : undefined
  return (
    <div className="flex flex-col">
      <div className={cn(grid, "hidden border-b px-5 py-2.5 text-sm text-muted-foreground")}>
        <span>Operation</span>
        <span className="col-span-2 font-mono">p95</span>
        <span className="col-span-2">Error rate</span>
        <span className="col-span-2">Runs</span>
      </div>
      {rows.map((row) => (
        <Link
          key={row.operation}
          to={linkOf(row)}
          className={cn(
            grid,
            "flex flex-col gap-1 border-b px-5 py-2.5 text-[13px] outline-none last:border-b-0 hover:bg-accent/60 focus-visible:bg-accent",
          )}
        >
          <OperationName name={row.operation} className="text-[15px]" />
          <span className="flex flex-wrap gap-x-4 gap-y-0.5 sm:contents">
            <Measure
              label="p95"
              now={duration(row.p95Ms)}
              before={duration(row.previousP95Ms)}
              worse={worse("p95", "text-yellow")}
            />
            <Measure
              label="Error rate"
              now={share(row.errors, row.count)}
              before={share(row.previousErrors, row.previousCount)}
              worse={worse("errorRate", "text-failure")}
            />
            <Measure label="Runs" now={count(row.count)} before={count(row.previousCount)} worse={undefined} />
          </span>
        </Link>
      ))}
    </div>
  )
}
