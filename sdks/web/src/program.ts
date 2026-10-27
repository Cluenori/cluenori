import type { Device, KeptStore, Runtime } from "./runtime.ts"

/** What a command-line program tells the SDK: where it keeps its files, and the machine it runs on. */
export interface ProgramOptions {
  /** Where the SDK keeps its installation and what waits to be sent, such as a folder of the program's own. */
  readonly store: KeptStore
  readonly platform: "macOS" | "linux" | "windows"
  /** The machine's architecture, `arm64`, or its model. */
  readonly model: string
  readonly osVersion: string
}

/**
 * The runtime of a command-line program: each run is a session, from `start` to `shutdown`, which
 * the program calls before it exits, and each command a screen. The locale and time zone are the
 * machine's, as `Intl` reads them.
 */
export const program = (options: ProgramOptions): Runtime => ({
  store: options.store,
  device: (): Device => {
    const resolved = Intl.DateTimeFormat().resolvedOptions()
    return {
      platform: options.platform,
      model: options.model,
      osVersion: options.osVersion,
      locale: resolved.locale,
      timeZone: resolved.timeZone,
    }
  },
  visible: () => true,
  // A program has no lifecycle to tell beyond its run; its own crashes are its to report.
  attach: () => () => undefined,
})
