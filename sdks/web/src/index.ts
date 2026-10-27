/**
 * Cluenori for web apps and command-line programs: sessions, screens and commands, features,
 * events, errors, timings, the person, consent, and the headers that carry a trace, its feature and
 * its origin to your own API. `start` once; every call after returns at once and never throws.
 */
export { browser } from "./browser.ts"
export { telemetryChoice, telemetryNotice } from "./cli-telemetry.ts"
export type { TelemetryChoice } from "./cli-telemetry.ts"
export type {
  AnalyticsConsent,
  Cluenori,
  EventValue,
  FeatureMark,
  ScreenContent,
  StartOptions,
  Timing,
} from "./engine.ts"
export { program } from "./program.ts"
export type { ProgramOptions } from "./program.ts"
export type { AppEvents, Device, KeptStore, Runtime } from "./runtime.ts"
export { start } from "./start.ts"
