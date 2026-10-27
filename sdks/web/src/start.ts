import type { Cluenori, StartOptions } from "./engine.ts"
import { makeEngine } from "./engine.ts"

/**
 * Starts Cluenori: call it once, as the app or program starts, and keep what it returns.
 *
 * ```ts
 * const cluenori = start({
 *   key: "cluenori-sdk.notes.notes-web.2Fq8…",
 *   environment: "production",
 *   deployment: "https://cluenori.example.com",
 *   release: "1.4.0+52",
 *   runtime: browser(),
 * })
 * ```
 *
 * Options that aren't valid, such as a key that isn't one, are logged, and a Cluenori that does
 * nothing is returned, so the app carries on.
 */
export const start = (options: StartOptions): Cluenori => makeEngine(options, { schedules: true })
