import { FeedId } from "@cluenori/feeds"
import {
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  FeatureKey,
  Instant,
  PersonId,
  ProjectKey,
  ReleaseVersion,
  TraceId,
} from "@cluenori/foundation"
import { AppUserId, ErrorGroupId } from "@cluenori/signals"
import { DateTime, Option, Schema } from "effect"
import type { ComponentProps, MouseEvent } from "react"
import { useSyncExternalStore } from "react"

/** The areas of a project that have a page of their own. */
export type Area = "performance" | "errors" | "logs" | "releases" | "analytics"

/**
 * The three doors of a project's page, each a level of its own: Product, how the apps are used;
 * Tech, operations, errors, logs and incidents; and Releases.
 */
export type Door = "product" | "tech" | "releases"

/**
 * What a page of numbers is narrowed to, in its address: one component, one environment, and one
 * release (`?component=notes-api&environment=staging&release=2.4.0%2B312`). Pages that lead to
 * others keep them, so an operation, an error, or a trace opened from a filtered page is of the same.
 */
export type Filters = {
  readonly component?: ComponentKey
  readonly environment?: EnvironmentKey
  readonly release?: ReleaseVersion
}

/**
 * What GitHub sent the browser back to the GitHub page with: the app connected
 * (`/github?connected`), why connecting didn't finish (`?problem=<what to do>`), the app installed
 * on an account (`?installation_id=…&setup_action=install`), or an organization's owners asked to
 * approve it (`?setup_action=request`).
 */
export type GitHubReturn =
  | { readonly _tag: "connected" }
  | { readonly _tag: "installed" }
  | { readonly _tag: "requested" }
  | { readonly _tag: "problem"; readonly problem: string }

/**
 * Every page the dashboard has, as a tree (`trailOf`). Now, `/`, is what needs the founder across
 * every project, and each project's state. A project, `/projects/notes`, is its people, its load,
 * what needs the founder there, and three doors (`Door`): Product, for now the analytics pages; Tech,
 * `/projects/notes/tech`, a summary of operations, errors, logs and incidents, each leading to its
 * full page; and Releases. Each area is a page with its `Filters`; performance leads to every
 * operation and then to one; the errors page leads to one error and its occurrences over the period,
 * and each occurrence to its own page, by its ID, with no filters, since it is one thing
 * (`/projects/notes/errors/<error>/<line>`, `concept/Experience.md`); the
 * releases page leads to one release, by its component and version, and its environment when it has
 * one (`/projects/notes/releases/notes-api/2.4.0+312?environment=production`); a trace is a page of
 * its own, by its ID, with the time it happened when a link knows it (`?around=<ISO 8601>`), keeping
 * the environment and release of the page it came from; the GitHub page says what GitHub sent the
 * browser back with (`GitHubReturn`). `hrefOf` and `routeOf` convert to and from URLs. An address is
 * untrusted input, so its keys are decoded here, once: one that isn't a page's is `missing`.
 */
export type Route =
  | { readonly page: "now" }
  | { readonly page: "missing" }
  | { readonly page: "project"; readonly project: ProjectKey }
  | { readonly page: "tech"; readonly project: ProjectKey; readonly environment?: EnvironmentKey }
  | { readonly page: "incidents"; readonly project: ProjectKey }
  | ({ readonly page: "performance"; readonly project: ProjectKey } & Filters)
  | ({ readonly page: "operations"; readonly project: ProjectKey } & Filters)
  | ({ readonly page: "operation"; readonly project: ProjectKey; readonly operation: EnvelopeName } & Filters)
  | ({ readonly page: "errors"; readonly project: ProjectKey } & Filters)
  | ({ readonly page: "error"; readonly project: ProjectKey; readonly error: ErrorGroupId } & Filters)
  | { readonly page: "occurrence"; readonly project: ProjectKey; readonly error: ErrorGroupId; readonly line: number }
  | ({ readonly page: "logs"; readonly project: ProjectKey } & Filters)
  | {
      readonly page: "releases"
      readonly project: ProjectKey
      readonly component?: ComponentKey
      readonly environment?: EnvironmentKey
    }
  | {
      readonly page: "release"
      readonly project: ProjectKey
      readonly component: ComponentKey
      readonly release: ReleaseVersion
      readonly environment?: EnvironmentKey
    }
  | {
      readonly page: "analytics" | "appReleases" | "features"
      readonly project: ProjectKey
      readonly component?: ComponentKey
      readonly environment?: EnvironmentKey
    }
  | {
      readonly page: "appRelease"
      readonly project: ProjectKey
      readonly component: ComponentKey
      readonly release: ReleaseVersion
      readonly environment?: EnvironmentKey
    }
  | {
      readonly page: "feature"
      readonly project: ProjectKey
      readonly feature: FeatureKey
      readonly environment?: EnvironmentKey
    }
  | ({ readonly page: "person"; readonly project: ProjectKey } & (
      | { readonly person: PersonId }
      | { readonly user: AppUserId }
    ))
  | {
      readonly page: "trace"
      readonly project: ProjectKey
      readonly trace: TraceId
      readonly around?: DateTime.Utc
      readonly environment?: EnvironmentKey
      readonly release?: ReleaseVersion
    }
  | { readonly page: "feeds" }
  | { readonly page: "feed"; readonly feed: FeedId }
  | { readonly page: "phones" }
  | { readonly page: "browsers" }
  | { readonly page: "members" }
  | { readonly page: "github"; readonly returned?: GitHubReturn }
  | { readonly page: "invite" }
  | { readonly page: "kit" }

// An operation's name often holds slashes (`GET /api/notes/{id}`). An address keeps them as its own:
// Cloudflare turns an escaped slash, `%2F`, back into one before the page sees it. So a name is
// written as path segments, each escaped, and read back from everything after `/operations/`, a
// trailing slash included (`POST /api/profile/`).
const operationPath = (operation: string) => operation.split("/").map(encodeURIComponent).join("/")

// A page's query, in a fixed order: `?component=notes-api&environment=staging&release=2.4.0%2B312`.
const withQuery = (path: string, query: Filters & { readonly around?: DateTime.Utc }) => {
  const pairs = [
    ...(query.around === undefined ? [] : [`around=${encodeURIComponent(DateTime.formatIso(query.around))}`]),
    ...(query.component === undefined ? [] : [`component=${encodeURIComponent(query.component)}`]),
    ...(query.environment === undefined ? [] : [`environment=${encodeURIComponent(query.environment)}`]),
    ...(query.release === undefined ? [] : [`release=${encodeURIComponent(query.release)}`]),
  ]
  return pairs.length === 0 ? path : `${path}?${pairs.join("&")}`
}

// What GitHub sends the browser back with, as its address says it.
const gitHubQuery = (returned: GitHubReturn) => {
  switch (returned._tag) {
    case "connected":
      return "connected"
    case "installed":
      return "setup_action=install"
    case "requested":
      return "setup_action=request"
    case "problem":
      return `problem=${encodeURIComponent(returned.problem)}`
  }
}

// The longest problem the GitHub page shows from its address: the Worker's say what to do in a
// sentence; anyone can put text in a link, so a long one is cut, and it is only ever shown as text.
const problemLength = 500

// What GitHub sent the browser back with, if anything: the Worker's redirect after connecting, or
// GitHub's after installing the app.
const gitHubReturnOf = (query: URLSearchParams): GitHubReturn | undefined => {
  const problem = query.get("problem")?.trim()
  if (problem !== undefined && problem !== "") {
    return { _tag: "problem", problem: problem.slice(0, problemLength) }
  }
  if (query.has("connected")) {
    return { _tag: "connected" }
  }
  if (query.get("setup_action") === "request") {
    return { _tag: "requested" }
  }
  if (query.has("installation_id") || query.get("setup_action") === "install") {
    return { _tag: "installed" }
  }
  return undefined
}

// Where a project's pages are: under `/projects/`, as in the API, so no project's key can be one of
// the deployment's pages.
const projectPath = (project: ProjectKey) => `/projects/${project}`

export const hrefOf = (route: Route): string => {
  switch (route.page) {
    case "now":
    case "missing":
      return "/"
    case "project":
      return projectPath(route.project)
    case "tech":
      return withQuery(`${projectPath(route.project)}/tech`, route)
    case "incidents":
      return `${projectPath(route.project)}/incidents`
    case "performance":
    case "operations":
    case "errors":
    case "logs":
    case "releases":
      return withQuery(`${projectPath(route.project)}/${route.page}`, route)
    case "operation":
      return withQuery(`${projectPath(route.project)}/operations/${operationPath(route.operation)}`, route)
    case "error":
      return withQuery(`${projectPath(route.project)}/errors/${route.error}`, route)
    case "occurrence":
      return `${projectPath(route.project)}/errors/${route.error}/${route.line}`
    case "release": {
      const { component: _, release: __, ...query } = route
      return withQuery(
        `${projectPath(route.project)}/releases/${route.component}/${encodeURIComponent(route.release)}`,
        query,
      )
    }
    case "analytics":
      return withQuery(`${projectPath(route.project)}/analytics`, route)
    case "appReleases":
      return withQuery(`${projectPath(route.project)}/analytics/releases`, route)
    case "features":
      return withQuery(`${projectPath(route.project)}/analytics/features`, route)
    case "appRelease": {
      const { component: _, release: __, ...query } = route
      return withQuery(
        `${projectPath(route.project)}/analytics/releases/${route.component}/${encodeURIComponent(route.release)}`,
        query,
      )
    }
    case "feature":
      return withQuery(`${projectPath(route.project)}/analytics/features/${route.feature}`, route)
    case "person":
      return "person" in route
        ? `${projectPath(route.project)}/analytics/people/${route.person}`
        : `${projectPath(route.project)}/analytics/people?user=${encodeURIComponent(route.user)}`
    case "trace":
      return withQuery(`${projectPath(route.project)}/traces/${route.trace}`, route)
    case "feeds":
      return "/feeds"
    case "feed":
      return `/feeds/${route.feed}`
    case "phones":
      return "/phones"
    case "browsers":
      return "/browsers"
    case "members":
      return "/members"
    case "github":
      return route.returned === undefined ? "/github" : `/github?${gitHubQuery(route.returned)}`
    case "invite":
      return "/invite"
    case "kit":
      return "/kit"
  }
}

// A path segment as typed or pasted: a malformed escape such as `%E0` is kept as it is.
const decoded = (segment: string) => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

// Each part of an address as the key it names, or absent when it isn't one.
const keyOf = <T,>(schema: Schema.Codec<T, string>, text: string | undefined): Option.Option<T> =>
  text === undefined ? Option.none() : Schema.decodeOption(schema)(text)

const projectKey = (text: string) => keyOf(ProjectKey, text)
// A warning's or error's ID, as the API numbers them: a whole number from 1.
const LineId = Schema.FiniteFromString.pipe(Schema.decodeTo(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))))
const componentKey = (text: string | undefined) => keyOf(ComponentKey, text)

// The deployment's own pages, which are no project's: the first part of their addresses.
const deploymentPages: ReadonlySet<string> = new Set([
  "kit",
  "github",
  "feeds",
  "phones",
  "browsers",
  "members",
  "invite",
])

export const routeOf = (path: string, search: string): Route => {
  const [first, key, page, id, ...rest] = path.split("/").filter((part) => part.length > 0)
  const query = new URLSearchParams(search)
  if (first === undefined) {
    return { page: "now" }
  }
  if (first === "kit") {
    return key === undefined ? { page: "kit" } : { page: "missing" }
  }
  if (first === "github") {
    const returned = gitHubReturnOf(query)
    return key === undefined ? { page: "github", ...(returned === undefined ? {} : { returned }) } : { page: "missing" }
  }
  if (first === "feeds") {
    if (key === undefined) {
      return { page: "feeds" }
    }
    const feed = keyOf(FeedId, key)
    return Option.isSome(feed) && page === undefined ? { page: "feed", feed: feed.value } : { page: "missing" }
  }
  if (first === "phones" || first === "browsers" || first === "members" || first === "invite") {
    return key === undefined ? { page: first } : { page: "missing" }
  }
  if (first !== "projects") {
    return { page: "missing" }
  }
  // `/projects` alone: every project, which Now lists.
  if (key === undefined) {
    return { page: "now" }
  }
  const project = projectKey(key)
  const component = componentKey(query.get("component") ?? undefined)
  const environment = keyOf(EnvironmentKey, query.get("environment") ?? undefined)
  const release = keyOf(ReleaseVersion, query.get("release") ?? undefined)
  // A filter named that isn't a key makes the address no page's.
  const mistyped =
    (query.has("component") && Option.isNone(component)) ||
    (query.has("environment") && Option.isNone(environment)) ||
    (query.has("release") && Option.isNone(release))
  const operationsAt = `/projects/${key}/operations/`
  const isOperation = page === "operations" && id !== undefined && path.startsWith(operationsAt)
  const isRelease = page === "releases" && rest.length === 1
  const isAppRelease = page === "analytics" && id === "releases" && rest.length === 2
  const isOccurrence = page === "errors" && rest.length === 1
  const isAnalyticsItem = page === "analytics" && (id === "features" || id === "people") && rest.length === 1
  if (
    Option.isNone(project) ||
    mistyped ||
    (rest.length > 0 && !isOperation && !isRelease && !isAppRelease && !isOccurrence && !isAnalyticsItem)
  ) {
    return { page: "missing" }
  }
  const ofEnvironment = Option.isSome(environment) ? { environment: environment.value } : {}
  const ofRelease = Option.isSome(release) ? { release: release.value } : {}
  const filters = {
    project: project.value,
    ...(Option.isSome(component) ? { component: component.value } : {}),
    ...ofEnvironment,
    ...ofRelease,
  }
  if (page === undefined) {
    return { page: "project", project: project.value }
  }
  if (page === "tech" && id === undefined) {
    return { page: "tech", project: project.value, ...ofEnvironment }
  }
  if (page === "incidents" && id === undefined) {
    return { page: "incidents", project: project.value }
  }
  if ((page === "performance" || page === "logs") && id === undefined) {
    return { page, ...filters }
  }
  if (page === "releases") {
    if (id === undefined) {
      const { release: _, ...releasesFilters } = filters
      return { page: "releases", ...releasesFilters }
    }
    // A release is named by its component and version, in the path as the API names it.
    const of = componentKey(id)
    const version = keyOf(ReleaseVersion, rest[0] === undefined ? undefined : decoded(rest[0]))
    if (Option.isNone(of) || Option.isNone(version)) {
      return { page: "missing" }
    }
    return { page: "release", project: project.value, component: of.value, release: version.value, ...ofEnvironment }
  }
  if (page === "analytics") {
    return analyticsRouteOf(project.value, id, rest, query, filters)
  }
  if (page === "operations") {
    if (id === undefined) {
      return { page: "operations", ...filters }
    }
    const operation = keyOf(EnvelopeName, path.slice(operationsAt.length).split("/").map(decoded).join("/"))
    return Option.isSome(operation)
      ? { page: "operation", ...filters, operation: operation.value }
      : { page: "missing" }
  }
  if (page === "errors") {
    if (id === undefined) {
      return { page: "errors", ...filters }
    }
    const error = keyOf(ErrorGroupId, id)
    if (Option.isNone(error)) {
      return { page: "missing" }
    }
    if (rest[0] !== undefined) {
      const line = keyOf(LineId, rest[0])
      return Option.isSome(line)
        ? { page: "occurrence", project: project.value, error: error.value, line: line.value }
        : { page: "missing" }
    }
    return { page: "error", ...filters, error: error.value }
  }
  if (page === "traces") {
    const trace = keyOf(TraceId, id)
    const around = keyOf(Instant, query.get("around") ?? undefined)
    return Option.isSome(trace)
      ? {
          page: "trace",
          project: project.value,
          trace: trace.value,
          ...(Option.isSome(around) ? { around: around.value } : {}),
          ...ofEnvironment,
          ...ofRelease,
        }
      : { page: "missing" }
  }
  return { page: "missing" }
}

/**
 * Where an address from before a project's pages moved under `/projects/` is now: `/notes/errors`
 * is `/projects/notes/errors`, so a link kept from then still opens its page. Undefined for any
 * other address, the deployment's own pages among them.
 * Not handled: a project whose key is `projects` had its overview at `/projects`, which is Now.
 */
export const movedAddressOf = (path: string): string | undefined => {
  const first = path.split("/").find((part) => part.length > 0)
  if (first === undefined || first === "projects" || deploymentPages.has(first) || Option.isNone(projectKey(first))) {
    return undefined
  }
  return `/projects${path}`
}

/** One step of the way from Now to a page: its name, and the page, for every step but the last. */
export type TrailStep = { readonly label: string; readonly to?: Route }

/**
 * The door of its project a page is behind, if any: Tech's pages are about operations, errors, logs
 * and incidents; Product's, how the apps are used; Releases', the releases.
 */
export const doorOf = (route: Route): Door | undefined => {
  switch (route.page) {
    case "tech":
    case "incidents":
    case "performance":
    case "operations":
    case "operation":
    case "errors":
    case "error":
    case "occurrence":
    case "logs":
    case "trace":
      return "tech"
    case "analytics":
    case "appReleases":
    case "appRelease":
    case "features":
    case "feature":
    case "person":
      return "product"
    case "releases":
    case "release":
      return "releases"
    case "now":
    case "missing":
    case "project":
    case "feeds":
    case "feed":
    case "phones":
    case "browsers":
    case "members":
    case "github":
    case "invite":
    case "kit":
      return undefined
  }
}

// What the last step of a page's trail says: the page's own name, short, as its heading says the rest.
const pageNames: Readonly<Record<Exclude<Route["page"], "now" | "project" | "missing">, string>> = {
  tech: "Tech",
  incidents: "Incidents",
  performance: "Performance",
  operations: "Operations",
  operation: "Operation",
  errors: "Errors",
  error: "Error",
  occurrence: "Occurrence",
  logs: "Logs",
  trace: "Trace",
  analytics: "Product",
  appReleases: "App health",
  appRelease: "Release",
  features: "Features",
  feature: "Feature",
  person: "Person",
  releases: "Releases",
  release: "Release",
  feeds: "Feeds",
  feed: "Feed",
  phones: "Phones",
  browsers: "Browsers",
  members: "Members",
  github: "GitHub",
  invite: "Invitation",
  kit: "Design kit",
}

// A door's own page: Tech's summary, Product's analytics, Releases' delivery.
const doorPageOf = (door: Door, project: ProjectKey): Route => {
  switch (door) {
    case "tech":
      return { page: "tech", project }
    case "product":
      return { page: "analytics", project }
    case "releases":
      return { page: "releases", project }
  }
}

const doorNames: Readonly<Record<Door, string>> = { tech: "Tech", product: "Product", releases: "Releases" }

// The steps between a door, or Now, and a page further down: a feed is one of Feeds, an operation one of Operations, an error one
// of Errors, an occurrence one of its error's, a release's app health one of App health's; each keeps
// the page's filters, which an occurrence has none of.
const betweenOf = (route: Route): ReadonlyArray<TrailStep> => {
  if (route.page === "operation") {
    const { operation: _, ...filters } = route
    return [{ label: pageNames.operations, to: { ...filters, page: "operations" } }]
  }
  if (route.page === "error") {
    const { error: _, ...filters } = route
    return [{ label: pageNames.errors, to: { ...filters, page: "errors" } }]
  }
  if (route.page === "occurrence") {
    return [
      { label: pageNames.errors, to: { page: "errors", project: route.project } },
      { label: pageNames.error, to: { page: "error", project: route.project, error: route.error } },
    ]
  }
  if (route.page === "feed") {
    return [{ label: pageNames.feeds, to: { page: "feeds" } }]
  }
  if (route.page === "appRelease") {
    const { release: _, ...shown } = route
    return [{ label: pageNames.appReleases, to: { ...shown, page: "appReleases" } }]
  }
  if (route.page === "feature") {
    const { feature: _, ...shown } = route
    return [{ label: pageNames.features, to: { ...shown, page: "features" } }]
  }
  return []
}

/**
 * The way from Now to a page, a step a level, so every level above it is one click away: Now, the
 * project, its door, the page between when there is one, and the page itself, last, which links
 * nowhere. Now has none. `projectName` names a project by its key.
 */
export const trailOf = (route: Route, projectName: (project: ProjectKey) => string): ReadonlyArray<TrailStep> => {
  if (route.page === "now" || route.page === "missing") {
    return []
  }
  const now: TrailStep = { label: "Now", to: { page: "now" } }
  if (!("project" in route)) {
    return [now, ...betweenOf(route), { label: pageNames[route.page] }]
  }
  if (route.page === "project") {
    return [now, { label: projectName(route.project) }]
  }
  const project: TrailStep = { label: projectName(route.project), to: { page: "project", project: route.project } }
  const here: TrailStep = { label: pageNames[route.page] }
  const door = doorOf(route)
  const doorPage = door === undefined ? undefined : { label: doorNames[door], to: doorPageOf(door, route.project) }
  // The door's own page is the last step on it.
  const doorStep = doorPage === undefined || doorPage.to.page === route.page ? [] : [doorPage]
  return [now, project, ...doorStep, ...betweenOf(route), here]
}

// The analytics pages: the summary, its releases' app health and one release's, every feature and
// one, and one person, by their ID or the app's user ID. They show a component and an environment,
// never a release; a feature, an item, only its environment, and a person neither.
const analyticsRouteOf = (
  project: ProjectKey,
  id: string | undefined,
  rest: ReadonlyArray<string>,
  query: URLSearchParams,
  filters: Filters,
): Route => {
  const { release: _, ...shown } = filters
  if (id === undefined) {
    return { page: "analytics", project, ...shown }
  }
  if (id === "features" && rest.length === 0) {
    return { page: "features", project, ...shown }
  }
  if (id === "features") {
    const feature = keyOf(FeatureKey, rest[0])
    return Option.isSome(feature)
      ? {
          page: "feature",
          project,
          feature: feature.value,
          ...(shown.environment === undefined ? {} : { environment: shown.environment }),
        }
      : { page: "missing" }
  }
  if (id === "people" && rest.length === 0) {
    const user = keyOf(AppUserId, query.get("user") ?? undefined)
    return Option.isSome(user) ? { page: "person", project, user: user.value } : { page: "missing" }
  }
  if (id === "people") {
    const person = keyOf(PersonId, rest[0])
    return Option.isSome(person) ? { page: "person", project, person: person.value } : { page: "missing" }
  }
  if (id !== "releases") {
    return { page: "missing" }
  }
  if (rest.length === 0) {
    return { page: "appReleases", project, ...shown }
  }
  const of = componentKey(rest[0])
  const version = keyOf(ReleaseVersion, rest[1] === undefined ? undefined : decoded(rest[1]))
  if (Option.isNone(of) || Option.isNone(version)) {
    return { page: "missing" }
  }
  return {
    page: "appRelease",
    project,
    component: of.value,
    release: version.value,
    ...(shown.environment === undefined ? {} : { environment: shown.environment }),
  }
}

const subscribe = (onChange: () => void) => {
  window.addEventListener("popstate", onChange)
  return () => window.removeEventListener("popstate", onChange)
}

const currentAddress = () => `${window.location.pathname}${window.location.search}`

/** The page the address bar shows; the view re-renders when it changes. */
export const useRoute = (): Route => {
  const address = useSyncExternalStore(subscribe, currentAddress)
  const query = address.indexOf("?")
  return query === -1 ? routeOf(address, "") : routeOf(address.slice(0, query), address.slice(query))
}

/**
 * Opens `route` as a new entry in this tab's history. `replace` changes the current entry instead,
 * for changes within a page, such as opening an error in place or picking a component, that Back
 * shouldn't step through.
 */
export const navigate = (route: Route, { replace = false }: { readonly replace?: boolean } = {}) => {
  if (replace) {
    window.history.replaceState(null, "", hrefOf(route))
  } else {
    window.history.pushState(null, "", hrefOf(route))
    window.scrollTo({ top: 0 })
  }
  window.dispatchEvent(new PopStateEvent("popstate"))
}

const opensElsewhere = (event: MouseEvent<HTMLAnchorElement>) =>
  event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey

/**
 * A link to a page of the dashboard. A plain click opens it without reloading; ⌘-click and the
 * others keep their usual meaning, such as a new tab.
 */
export function Link({ to, onClick, children, ...props }: { readonly to: Route } & Omit<ComponentProps<"a">, "href">) {
  return (
    <a
      href={hrefOf(to)}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented || opensElsewhere(event)) {
          return
        }
        event.preventDefault()
        navigate(to)
      }}
      {...props}
    >
      {children}
    </a>
  )
}
