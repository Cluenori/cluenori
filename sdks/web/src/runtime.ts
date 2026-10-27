/**
 * Where the SDK keeps what it needs between page loads or runs: a few small texts by name. Reads and
 * writes are synchronous and may fail by doing nothing: the SDK then starts fresh, as a first run
 * does. `browser()` keeps them in `localStorage`; a program gives a store of its own.
 */
export interface KeptStore {
  readonly read: (name: string) => string | undefined
  /** Writes `text` under `name`, or removes it when `text` is undefined. */
  readonly write: (name: string, text: string | undefined) => void
}

/** The device and settings the app runs with, as each batch says. */
export interface Device {
  readonly platform: "web" | "macOS" | "linux" | "windows"
  /** The browser, `Chrome 141`, or the machine, `arm64`. */
  readonly model: string
  /** `15.1`, or `unknown`. */
  readonly osVersion: string
  /** BCP 47, `uk-UA`. */
  readonly locale: string
  /** IANA, `Europe/Kyiv`. */
  readonly timeZone: string
}

/** What a runtime tells the SDK about the app as it runs. */
export interface AppEvents {
  /** The app came into sight: a session starts or goes on. */
  readonly foreground: () => void
  /** The app left sight, as a tab hidden: its session ends 30 s later unless it comes back. */
  readonly background: () => void
  /** The main thread didn't answer for `ms`, 250 ms or more. */
  readonly hang: (ms: number) => void
  /** An error nothing handled reached the top. */
  readonly crash: (error: unknown) => void
}

/**
 * The platform the SDK runs on: its store, its device, and what it says as the app runs. Made by
 * `browser()` or `program()`; a test may make its own.
 */
export interface Runtime {
  readonly store: KeptStore
  readonly device: () => Device
  /** Whether the app is in sight as the SDK starts. */
  readonly visible: () => boolean
  /** Starts telling `events`; the function returned stops it. */
  readonly attach: (events: AppEvents) => () => void
}
