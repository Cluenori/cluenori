import {
  ComponentKey,
  EnvelopeName,
  EnvironmentKey,
  Instant,
  ProjectKey,
  ReleaseVersion,
  TraceId,
} from "@cluenori/foundation"
import { ErrorGroupId } from "@cluenori/signals"
import { DateTime, Option, Schema } from "effect"
import type { ComponentProps, MouseEvent } from "react"
import { useSyncExternalStore } from "react"

/** The areas of a project that have a page of their own. */
export type Area = "performance" | "errors" | "logs" | "releases"

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
 * Every page the dashboard has. The start, `/`, shows the first project; a project opens on its
 * overview; each area is a page with its `Filters`; performance leads to every operation and then
 * to one; the errors page leads to one error, with all it was sent with; the releases page leads to
 * one release, by its component and version, and its environment when it has one
 * (`/notes/releases/notes-api/2.4.0+312?environment=production`); a trace is a page of its own, by
 * its ID, with the time it happened when a link knows it (`?around=<ISO 8601>`), keeping the
 * environment and release of the page it came from; the GitHub page says what GitHub sent the
 * browser back with (`GitHubReturn`). `hrefOf` and `routeOf` convert to and from
 * URLs. An address is untrusted input, so its keys are decoded here, once: one that isn't a page's
 * is `missing`.
 */
export type Route =
  | { readonly page: "start" }
  | { readonly page: "missing" }
  | { readonly page: "overview"; readonly project: ProjectKey; readonly environment?: EnvironmentKey }
  | ({ readonly page: "performance"; readonly project: ProjectKey } & Filters)
  | ({ readonly page: "operations"; readonly project: ProjectKey } & Filters)
  | ({ readonly page: "operation"; readonly project: ProjectKey; readonly operation: EnvelopeName } & Filters)
  | ({ readonly page: "errors"; readonly project: ProjectKey } & Filters)
  | ({ readonly page: "error"; readonly project: ProjectKey; readonly error: ErrorGroupId } & Filters)
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
      readonly page: "trace"
      readonly project: ProjectKey
      readonly trace: TraceId
      readonly around?: DateTime.Utc
      readonly environment?: EnvironmentKey
      readonly release?: ReleaseVersion
    }
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

export const hrefOf = (route: Route): string => {
  switch (route.page) {
    case "start":
    case "missing":
      return "/"
    case "overview":
      return withQuery(`/${route.project}`, route)
    case "performance":
    case "operations":
    case "errors":
    case "logs":
    case "releases":
      return withQuery(`/${route.project}/${route.page}`, route)
    case "operation":
      return withQuery(`/${route.project}/operations/${operationPath(route.operation)}`, route)
    case "error":
      return withQuery(`/${route.project}/errors/${route.error}`, route)
    case "release": {
      const { component: _, release: __, ...query } = route
      return withQuery(`/${route.project}/releases/${route.component}/${encodeURIComponent(route.release)}`, query)
    }
    case "trace":
      return withQuery(`/${route.project}/traces/${route.trace}`, route)
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
const componentKey = (text: string | undefined) => keyOf(ComponentKey, text)

export const routeOf = (path: string, search: string): Route => {
  const [first, page, id, ...rest] = path.split("/").filter((part) => part.length > 0)
  const query = new URLSearchParams(search)
  if (first === undefined) {
    return { page: "start" }
  }
  // Not handled: a project whose key is `kit`, `phones`, `browsers`, `members`, `github` or `invite`
  // opens these pages instead of its own; reserving them at project creation would take an error in
  // Projects.
  if (first === "kit") {
    return { page: "kit" }
  }
  if (first === "github") {
    const returned = gitHubReturnOf(query)
    return page === undefined
      ? { page: "github", ...(returned === undefined ? {} : { returned }) }
      : { page: "missing" }
  }
  if (first === "phones" || first === "browsers" || first === "members" || first === "invite") {
    return page === undefined ? { page: first } : { page: "missing" }
  }
  const project = projectKey(first)
  const component = componentKey(query.get("component") ?? undefined)
  const environment = keyOf(EnvironmentKey, query.get("environment") ?? undefined)
  const release = keyOf(ReleaseVersion, query.get("release") ?? undefined)
  // A filter named that isn't a key makes the address no page's.
  const mistyped =
    (query.has("component") && Option.isNone(component)) ||
    (query.has("environment") && Option.isNone(environment)) ||
    (query.has("release") && Option.isNone(release))
  const operationsAt = `/${first}/operations/`
  const isOperation = page === "operations" && id !== undefined && path.startsWith(operationsAt)
  const isRelease = page === "releases" && rest.length === 1
  if (Option.isNone(project) || mistyped || (rest.length > 0 && !isOperation && !isRelease)) {
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
    return id === undefined ? { page: "overview", project: project.value, ...ofEnvironment } : { page: "missing" }
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
    return Option.isSome(error) ? { page: "error", ...filters, error: error.value } : { page: "missing" }
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
