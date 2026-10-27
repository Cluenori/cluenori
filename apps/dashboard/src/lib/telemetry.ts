import type { Cluenori } from "@cluenori/sdk"

import type { Route } from "@/router"

// The dashboard measures itself with the deployment that serves it, when that deployment measures
// itself (`./cluenori self-telemetry on`): each page is a screen, by its kind alone (`operation`,
// never the operation), and each kind of page a feature, named as the CLI and the phone name it
// (docs/self-telemetry.md, "Features").
//
// Starting it, with the SDK, loads after start (`telemetry-start.ts`), as the later pages do, so
// the first load keeps its budget; the page shown by then is shown to it again. A page that shows
// its data before the SDK is there, the first of a cold load, has no ready time: one measured from
// the SDK's start would be wrong.

let cluenori: Cluenori | undefined
// The screen shown, shown to the SDK again as it starts.
let shown: { readonly screen: string; readonly feature: string | undefined; readonly visit: string } | undefined
let mark: { readonly end: () => void } | undefined
let member: string | undefined

/** Starts measuring the dashboard, if the deployment measures it. */
export const startTelemetry = () => {
  void import("@/lib/telemetry-start").then(({ started }) =>
    started((sdk) => {
      if (cluenori !== undefined) {
        return
      }
      cluenori = sdk
      if (member !== undefined) {
        sdk.identify(member)
      }
      if (shown !== undefined) {
        const replayed = shown
        shown = undefined
        showScreen(replayed.screen, replayed.feature, replayed.visit)
      }
    }),
  )
}

/** The feature each kind of page is; none for a page that is no feature, such as a mistyped address. */
export const featureOfPage: Readonly<Record<Route["page"] | "signIn", string | undefined>> = {
  now: "today",
  missing: undefined,
  kit: undefined,
  project: "projects.overview",
  tech: "tech",
  performance: "tech.performance",
  operation: "tech.performance",
  errors: "tech.errors",
  error: "tech.errors",
  occurrence: "tech.errors",
  logs: "tech.logs",
  logMessage: "tech.logs",
  logLine: "tech.logs",
  trace: "tech.traces",
  incidents: "incidents",
  incident: "incidents",
  uptime: "uptime",
  monitor: "uptime",
  releases: "releases",
  release: "releases",
  analytics: "analytics",
  appReleases: "analytics.releases",
  appRelease: "analytics.releases",
  features: "analytics.features",
  feature: "analytics.features",
  person: "analytics.people",
  feeds: "feeds",
  feed: "feeds",
  phones: "settings.phones",
  browsers: "settings.browsers",
  members: "settings.members",
  invite: "settings.members",
  github: "settings.github",
  signIn: "sign-in",
}

/**
 * A page shows: its screen, and its feature in effect until the next page shows. `visit` is the
 * page's address without its query; the same visit shown again, such as a period picked, is ignored.
 */
export const showScreen = (screen: string, feature: string | undefined, visit: string) => {
  if (shown?.visit === visit && shown.screen === screen) {
    return
  }
  shown = { screen, feature, visit }
  if (cluenori === undefined) {
    return
  }
  mark?.end()
  mark = feature === undefined ? undefined : cluenori.begin(feature)
  cluenori.screen(screen)
}

/** The page shows its first content: from what the browser kept, or from the network. */
export const screenReady = (kind: "kept" | "fresh") => cluenori?.screenReady(kind)

/** The member signed in, by their ID, the same in every client; none when signed out. */
export const signedIn = (id: string | undefined) => {
  if (id === member) {
    return
  }
  if (id === undefined) {
    cluenori?.reset()
  } else {
    cluenori?.identify(id)
  }
  member = id
}

/** A request to the API, with the release, a trace, and the page's feature and origin. */
export const telemetryHeaders = (existing: Record<string, string>) => cluenori?.headers(existing) ?? existing
