import type { InstallationId } from "@cluenori/foundation"

/**
 * How many batches a project takes in each minute: from one SDK key, and from one installation.
 * A batch past either waits for the next minute.
 */
export interface AppRateLimits {
  readonly perKey: number
  readonly perInstallation: number
}

/**
 * The limits a project's object keeps to: 1,200 batches a minute from one key, about 20 a second,
 * what one object writes comfortably; and 20 a minute from one installation, which an SDK sending
 * every 30 seconds stays far below.
 */
export const defaultAppRateLimits: AppRateLimits = { perKey: 1200, perInstallation: 20 }

const windowMillis = 60_000

/** The batches taken in the current minute, from the start of it, by key and by installation. */
export interface RateWindow {
  readonly start: number
  readonly keys: ReadonlyMap<string, number>
  readonly installations: ReadonlyMap<InstallationId, number>
}

/** A window with nothing taken yet. */
export const emptyWindow: RateWindow = { start: 0, keys: new Map(), installations: new Map() }

/** Whether a batch may be taken, and the window after: one more for its key and installation if so. */
export type RateDecision =
  | { readonly _tag: "Taken"; readonly window: RateWindow }
  | { readonly _tag: "Refused"; readonly retryAfterSeconds: number }

/**
 * Takes one batch from `key` and `installation` at `now` (Unix ms), or refuses it until the minute
 * ends. Windows are fixed minutes, and only the current one is kept, so memory holds at most a
 * minute's keys and installations.
 */
export const takeBatch = (
  window: RateWindow,
  limits: AppRateLimits,
  key: string,
  installation: InstallationId,
  now: number,
): RateDecision => {
  const start = now - (now % windowMillis)
  const current = window.start === start ? window : { ...emptyWindow, start }
  const fromKey = current.keys.get(key) ?? 0
  const fromInstallation = current.installations.get(installation) ?? 0
  if (fromKey >= limits.perKey || fromInstallation >= limits.perInstallation) {
    return { _tag: "Refused", retryAfterSeconds: Math.max(1, Math.ceil((start + windowMillis - now) / 1000)) }
  }
  return {
    _tag: "Taken",
    window: {
      start,
      keys: new Map(current.keys).set(key, fromKey + 1),
      installations: new Map(current.installations).set(installation, fromInstallation + 1),
    },
  }
}
