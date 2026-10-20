import { ComponentKey, EnvelopeName, ProjectKey, TraceId } from "@cluenori/foundation"
import { ErrorGroupId } from "@cluenori/signals"
import { DateTime, Option, Schema } from "effect"
import type { ComponentProps, MouseEvent } from "react"
import { useSyncExternalStore } from "react"

/** The areas of a project that have a page of their own. */
export type Area = "performance" | "errors" | "logs"

/**
 * Every page the dashboard has. The start, `/`, shows the first project; a project opens on its
 * overview; each area is a page that can show one component (`?component=notes-api`); performance
 * leads to every endpoint and then to one; an error opens in place on the errors page, so it has a
 * URL too; a request's trace is a page of its own, at the time it happened (`?around=<ISO 8601>`),
 * which the archive is read by. `hrefOf` and `routeOf` convert to and from URLs. An address is
 * untrusted input, so its keys are decoded here, once: one that isn't a page's is `missing`.
 */
export type Route =
  | { readonly page: "start" }
  | { readonly page: "missing" }
  | { readonly page: "overview"; readonly project: ProjectKey }
  | { readonly page: "performance"; readonly project: ProjectKey; readonly component?: ComponentKey }
  | { readonly page: "endpoints"; readonly project: ProjectKey; readonly component?: ComponentKey }
  | {
      readonly page: "endpoint"
      readonly project: ProjectKey
      readonly component?: ComponentKey
      readonly endpoint: EnvelopeName
    }
  | {
      readonly page: "errors"
      readonly project: ProjectKey
      readonly component?: ComponentKey
      readonly error?: ErrorGroupId
    }
  | { readonly page: "logs"; readonly project: ProjectKey; readonly component?: ComponentKey }
  | { readonly page: "trace"; readonly project: ProjectKey; readonly trace: TraceId; readonly around?: DateTime.Utc }
  | { readonly page: "kit" }

const withComponent = (path: string, component: string | undefined) =>
  component === undefined ? path : `${path}?component=${encodeURIComponent(component)}`

export const hrefOf = (route: Route): string => {
  switch (route.page) {
    case "start":
    case "missing":
      return "/"
    case "overview":
      return `/${route.project}`
    case "performance":
      return withComponent(`/${route.project}/performance`, route.component)
    case "endpoints":
      return withComponent(`/${route.project}/endpoints`, route.component)
    case "endpoint":
      return withComponent(`/${route.project}/endpoints/${encodeURIComponent(route.endpoint)}`, route.component)
    case "errors":
      return withComponent(
        route.error === undefined ? `/${route.project}/errors` : `/${route.project}/errors/${route.error}`,
        route.component,
      )
    case "logs":
      return withComponent(`/${route.project}/logs`, route.component)
    case "trace":
      return route.around === undefined
        ? `/${route.project}/traces/${route.trace}`
        : `/${route.project}/traces/${route.trace}?around=${encodeURIComponent(DateTime.formatIso(route.around))}`
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
  if (first === "kit") {
    return { page: "kit" }
  }
  const project = projectKey(first)
  const named = query.get("component") ?? undefined
  const component = componentKey(named)
  if (Option.isNone(project) || (named !== undefined && Option.isNone(component)) || rest.length > 0) {
    return { page: "missing" }
  }
  const scope = { project: project.value, ...(Option.isSome(component) ? { component: component.value } : {}) }
  if (page === undefined) {
    return id === undefined ? { page: "overview", project: project.value } : { page: "missing" }
  }
  if ((page === "performance" || page === "logs") && id === undefined) {
    return { page, ...scope }
  }
  if (page === "endpoints") {
    if (id === undefined) {
      return { page: "endpoints", ...scope }
    }
    const endpoint = keyOf(EnvelopeName, decoded(id))
    return Option.isSome(endpoint) ? { page: "endpoint", ...scope, endpoint: endpoint.value } : { page: "missing" }
  }
  if (page === "errors") {
    if (id === undefined) {
      return { page: "errors", ...scope }
    }
    const error = keyOf(ErrorGroupId, id)
    return Option.isSome(error) ? { page: "errors", ...scope, error: error.value } : { page: "missing" }
  }
  if (page === "traces") {
    const trace = keyOf(TraceId, id)
    // Without a time the trace page can't read the archive; it says so, rather than opening nothing.
    const around = keyOf(Schema.DateTimeUtcFromString, query.get("around") ?? undefined)
    return Option.isSome(trace)
      ? {
          page: "trace",
          project: project.value,
          trace: trace.value,
          ...(Option.isSome(around) ? { around: around.value } : {}),
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
