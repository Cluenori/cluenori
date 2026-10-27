import type { AppEvents, Device, KeptStore, Runtime } from "./runtime.ts"

// The browser's runtime: what it keeps in `localStorage`, under `cluenori:`; the app in sight while
// its page is visible; hangs from the Long Tasks API; crashes from errors and rejections nothing
// handled.

const prefix = "cluenori:"

// `localStorage`, when the page may use it: private windows and some settings refuse it, even
// throwing as it is read, and then the SDK keeps nothing between loads (the engine contains what a
// store throws).
const storage = (): Storage | undefined => {
  const found = "localStorage" in globalThis ? globalThis.localStorage : undefined
  return found
}

const store: KeptStore = {
  read: (name) => storage()?.getItem(prefix + name) ?? undefined,
  write: (name, text) => {
    const kept = storage()
    if (text === undefined) {
      kept?.removeItem(prefix + name)
    } else {
      kept?.setItem(prefix + name, text)
    }
  },
}

// The browser and its version from the user agent's brands where it gives them, else its string.
const browserName = (): string => {
  const data = "userAgentData" in navigator ? navigator.userAgentData : undefined
  const brands =
    typeof data === "object" && data !== null && "brands" in data && Array.isArray(data.brands) ? data.brands : []
  for (const brand of brands) {
    if (typeof brand === "object" && brand !== null && "brand" in brand && "version" in brand) {
      const name = String(brand.brand)
      if (!/not.?a.?brand|chromium/i.test(name)) {
        return `${name} ${String(brand.version)}`
      }
    }
  }
  const agent = navigator.userAgent
  const match = /(Firefox|Edg|OPR|Chrome|Safari)\/(\d+)/.exec(agent)
  return match === null ? "unknown" : `${match[1] === "Edg" ? "Edge" : match[1]} ${match[2]}`
}

const device = (): Device => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return {
    platform: "web",
    model: browserName(),
    osVersion: "unknown",
    locale: navigator.language.length > 0 ? navigator.language : "und",
    timeZone: zone,
  }
}

const attach = (events: AppEvents) => {
  const visibility = () => (document.visibilityState === "visible" ? events.foreground() : events.background())
  const hidden = () => events.background()
  const error = (event: ErrorEvent) => events.crash(event.error ?? event.message)
  const rejection = (event: PromiseRejectionEvent) => events.crash(event.reason)
  document.addEventListener("visibilitychange", visibility)
  globalThis.addEventListener("pagehide", hidden)
  globalThis.addEventListener("error", error)
  globalThis.addEventListener("unhandledrejection", rejection)
  // Tasks of 250 ms or more held the page's main thread: the person's input waited.
  const observer =
    typeof PerformanceObserver === "function" && PerformanceObserver.supportedEntryTypes.includes("longtask")
      ? new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration >= 250) {
              events.hang(entry.duration)
            }
          }
        })
      : undefined
  observer?.observe({ type: "longtask", buffered: false })
  return () => {
    document.removeEventListener("visibilitychange", visibility)
    globalThis.removeEventListener("pagehide", hidden)
    globalThis.removeEventListener("error", error)
    globalThis.removeEventListener("unhandledrejection", rejection)
    observer?.disconnect()
  }
}

/** The runtime of a web app in a browser: pass it to `start`. */
export const browser = (): Runtime => ({
  store,
  device,
  visible: () => document.visibilityState === "visible",
  attach,
})
