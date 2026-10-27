import type { OriginRow } from "@cluenori/signals"

import { count, duration, share } from "@/lib/format"

/**
 * One operation's requests by the client that asked for them, the most first: each client's bar of
 * the requests, how many failed, and their average; then the requests that named no client, when
 * `total` says how many there were in all and the clients' fit in it (they are counted by the
 * hour, so a short period's clients may count a little more than its total).
 */
export function ClientSplit({
  rows,
  total,
  colorOf,
}: {
  readonly rows: ReadonlyArray<OriginRow>
  /** Every request of the operation in the period, the clients' and the rest; absent when unknown. */
  readonly total: number | undefined
  readonly colorOf: (component: string) => string
}) {
  const named = rows.reduce((sum, row) => sum + row.count, 0)
  const rest = total !== undefined && total >= named ? total - named : undefined
  const most = Math.max(1, rest ?? 0, ...rows.map((row) => row.count))
  const line = (key: string, label: string, value: number, color: string, detail: string) => (
    <li key={key} className="grid grid-cols-[minmax(7rem,12rem)_1fr_auto] items-center gap-4 px-5 py-2.5">
      <span className="truncate font-mono text-[15px]">{label}</span>
      <span aria-hidden className="h-2 bg-muted">
        <span className="block h-full" style={{ width: `${(value / most) * 100}%`, backgroundColor: color }} />
      </span>
      <span className="text-right font-mono text-[15px]">
        {count(value)}
        <span className="block text-[13px] text-muted-foreground">{detail}</span>
      </span>
    </li>
  )
  return (
    <ul className="flex flex-col py-2">
      {rows.map((row) =>
        line(
          row.origin,
          row.origin,
          row.count,
          colorOf(row.origin),
          `${row.errors === 0 ? "none failed" : `${share(row.errors, row.count)} failed`}, ${duration(row.averageMs)} avg`,
        ),
      )}
      {rest !== undefined && rest > 0 && line("", "no client named", rest, "var(--muted-foreground)", "direct calls")}
    </ul>
  )
}
