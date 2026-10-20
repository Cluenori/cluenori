// Dark or light. Dark is the default; a viewer's choice of light is remembered in this browser only.
// styles.css reads it from the `light` class on <html>.

export type Theme = "dark" | "light"

const storageKey = "cluenori.theme"

/** The theme this browser last chose, or dark. Storage can be unavailable, as in private windows. */
export const storedTheme = (): Theme => {
  try {
    return window.localStorage.getItem(storageKey) === "light" ? "light" : "dark"
  } catch {
    return "dark"
  }
}

export const applyTheme = (theme: Theme) => {
  document.documentElement.classList.toggle("light", theme === "light")
  try {
    window.localStorage.setItem(storageKey, theme)
  } catch {
    // The choice then lasts until the page reloads.
  }
}
