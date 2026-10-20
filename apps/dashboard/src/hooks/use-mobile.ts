import { useSyncExternalStore } from "react"

const MOBILE_BREAKPOINT = 768

const phoneSized = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)

const subscribe = (onChange: () => void) => {
  phoneSized.addEventListener("change", onChange)
  return () => phoneSized.removeEventListener("change", onChange)
}

/** Whether the viewport is phone-sized, read from the browser as it changes, right from the first render. */
export function useIsMobile() {
  return useSyncExternalStore(subscribe, () => phoneSized.matches)
}
