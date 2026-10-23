import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./styles.css"
import { App } from "@/app"
import { applyTheme, storedTheme } from "@/lib/theme"
import { movedAddressOf } from "@/router"

applyTheme(storedTheme())

// A link from before a project's pages moved under `/projects/` opens the page it named, at its
// address now, without a step in the history.
const moved = movedAddressOf(window.location.pathname)
if (moved !== undefined) {
  window.history.replaceState(null, "", `${moved}${window.location.search}${window.location.hash}`)
}

const root = document.getElementById("root")
if (root === null) {
  throw new Error("index.html has no #root to render into.")
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
