import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./styles.css"
import { App } from "@/app"
import { applyTheme, storedTheme } from "@/lib/theme"

applyTheme(storedTheme())

const root = document.getElementById("root")
if (root === null) {
  throw new Error("index.html has no #root to render into.")
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
