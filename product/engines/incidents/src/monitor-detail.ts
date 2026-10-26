import { Schema } from "effect"

import { Incident } from "./incident.ts"
import { MonitorCheck, MonitorState, MonitorStep } from "./monitor.ts"

/**
 * One monitor, whatever any period: how it is now and its days; its checks over the last 24 hours,
 * five minutes a step, oldest first, a step without checks not listed; its latest failed checks of
 * the 7 days checks are kept, at most 20, newest first; and its incidents, at most 20, the latest
 * opened first: those of its component and URL, whichever monitor of them found it.
 */
export const MonitorDetail = Schema.Struct({
  state: MonitorState,
  recent: Schema.Array(MonitorStep),
  failures: Schema.Array(MonitorCheck),
  incidents: Schema.Array(Incident),
}).annotate({ identifier: "MonitorDetail" })
export type MonitorDetail = typeof MonitorDetail.Type
