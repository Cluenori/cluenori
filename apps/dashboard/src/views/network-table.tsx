import { compact, count, duration } from "@/lib/format"
import type { Route } from "@/router"
import { Link } from "@/router"
import { EndpointName } from "@/views/endpoint-name"

/** A backend endpoint as an app saw it: how often it called it, and its p95 there and at the backend. */
export type NetworkCall = {
  readonly endpoint: string
  readonly calls: number
  /** From the app's side: the backend's time, the network, and the app's own. */
  readonly p95Ms: number
  /** At the backend; absent when the backend sent nothing for it. */
  readonly backendP95Ms?: number
}

/**
 * The backend endpoints an app calls, as the app saw them: each one's p95 in the app, and a bar of
 * where that time went, the backend's part in its color and the rest, the network and the app, in
 * gray. Every row opens the endpoint.
 */
export function NetworkTable({
  rows,
  backendColor,
  linkOf,
}: {
  readonly rows: ReadonlyArray<NetworkCall>
  readonly backendColor: string
  readonly linkOf: (row: NetworkCall) => Route
}) {
  const longest = Math.max(1, ...rows.map((row) => row.p95Ms))
  const grid =
    "grid grid-cols-[minmax(0,1fr)_4.5rem] gap-x-4 md:grid-cols-[minmax(0,1fr)_4.5rem_minmax(8rem,16rem)_4rem]"
  return (
    <div className="flex flex-col">
      <div className={`${grid} border-b pb-2 text-sm text-muted-foreground`}>
        <span>Endpoint</span>
        <span className="font-mono">p95</span>
        <span className="hidden md:block">Backend and network</span>
        <span className="hidden justify-self-end md:block">Calls</span>
      </div>
      {rows.map((row) => {
        const backend = row.backendP95Ms === undefined ? undefined : Math.min(row.backendP95Ms, row.p95Ms)
        return (
          <Link
            key={row.endpoint}
            to={linkOf(row)}
            className={`${grid} min-h-12 items-center border-b py-2 outline-none hover:bg-accent/60 focus-visible:bg-accent`}
          >
            <EndpointName endpoint={row.endpoint} className="text-[15px]" />
            <span className="font-mono text-[13px]">{duration(row.p95Ms)}</span>
            <span
              className="hidden h-3 md:flex"
              title={
                backend === undefined
                  ? "The backend sent no time for it"
                  : `${duration(backend)} at the backend, ${duration(row.p95Ms - backend)} in the network and the app`
              }
            >
              <span className="flex h-full" style={{ width: `${(row.p95Ms / longest) * 100}%` }}>
                {backend !== undefined && (
                  <span
                    className="h-full"
                    style={{ width: `${(backend / row.p95Ms) * 100}%`, backgroundColor: backendColor }}
                  />
                )}
                <span className="h-full flex-1 bg-muted-foreground/40" />
              </span>
            </span>
            <span
              className="hidden text-right font-mono text-[13px] text-muted-foreground md:block"
              title={`${count(row.calls)} calls`}
            >
              {row.calls >= 10_000 ? compact(row.calls) : count(row.calls)}
            </span>
          </Link>
        )
      })}
    </div>
  )
}
