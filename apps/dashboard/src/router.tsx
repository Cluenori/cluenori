import type { ComponentProps, MouseEvent } from "react"
import { useSyncExternalStore } from "react"

/** The areas of a project that have a page of their own. */
export type Area = "performance" | "errors" | "logs"

/**
 * Every page the dashboard has. A project opens on its overview; each area is a page that can show
 * one component (`?component=folio-ios`); a backend's performance leads to every endpoint and then
 * to one; an error opens in place on the errors page, so it has a URL too; a request's trace is a
 * page of its own. `hrefOf` and `routeOf` convert to and from URLs; anything else opens the first
 * project's overview.
 */
export type Route =
  | { readonly page: "overview"; readonly project: string }
  | { readonly page: "performance"; readonly project: string; readonly component?: string }
  | { readonly page: "endpoints"; readonly project: string; readonly component?: string }
  | { readonly page: "endpoint"; readonly project: string; readonly component?: string; readonly endpoint: string }
  | { readonly page: "errors"; readonly project: string; readonly component?: string; readonly error?: string }
  | { readonly page: "logs"; readonly project: string; readonly component?: string }
  | { readonly page: "trace"; readonly project: string; readonly trace: string }
  | { readonly page: "kit" }

const firstProject = "folio"

const withComponent = (path: string, component: string | undefined) =>
  component === undefined ? path : `${path}?component=${encodeURIComponent(component)}`

export const hrefOf = (route: Route): string => {
  switch (route.page) {
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
      return `/${route.project}/traces/${route.trace}`
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

export const routeOf = (path: string, search: string): Route => {
  const [project = firstProject, page, id] = path.split("/").filter((part) => part.length > 0)
  const component = new URLSearchParams(search).get("component") ?? undefined
  const filtered = component === undefined ? {} : { component }
  if (project === "kit") {
    return { page: "kit" }
  }
  if (page === "performance" || page === "logs") {
    return { page, project, ...filtered }
  }
  if (page === "endpoints") {
    return id === undefined
      ? { page: "endpoints", project, ...filtered }
      : { page: "endpoint", project, ...filtered, endpoint: decoded(id) }
  }
  if (page === "errors") {
    return { page: "errors", project, ...filtered, ...(id === undefined ? {} : { error: id }) }
  }
  if (page === "traces" && id !== undefined) {
    return { page: "trace", project, trace: id }
  }
  return { page: "overview", project }
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
