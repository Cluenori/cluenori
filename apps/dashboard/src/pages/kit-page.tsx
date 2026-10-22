import { KitActions } from "@/pages/kit-actions"
import { KitAhead } from "@/pages/kit-ahead"
import { KitAnalytics } from "@/pages/kit-analytics"
import { KitAssistant } from "@/pages/kit-assistant"
import { KitCharts } from "@/pages/kit-charts"
import { KitDisplay } from "@/pages/kit-display"
import { KitForms } from "@/pages/kit-forms"
import { KitOverlays } from "@/pages/kit-overlays"
import { KitTokens } from "@/pages/kit-tokens"
import { buttonVariants } from "@/views/ui/button"
import { Toaster } from "@/views/ui/toast"

const contents = [
  { id: "tokens", label: "Tokens" },
  { id: "actions", label: "Actions" },
  { id: "forms", label: "Forms" },
  { id: "overlays", label: "Overlays" },
  { id: "display", label: "Display" },
  { id: "charts", label: "Charts" },
  { id: "assistant", label: "Assistant" },
  { id: "analytics", label: "Analytics" },
  { id: "ahead", label: "Ahead of the API" },
] as const

/**
 * The design kit: nearly every view of shadcn/ui in Cluenori's theme, filled with Cluenori's own
 * kind of data, so a change to the theme or to a view can be judged everywhere at once. The page
 * has its own toaster, since the app root has none.
 */
export function KitPage() {
  return (
    <Toaster>
      <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-6 p-4 md:p-8">
        <header className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-3xl font-semibold tracking-tight">Design kit</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Every view in the dashboard's theme, filled with the kind of data Cluenori shows. Change a token or a
              view, then look here to see what it changes.
            </p>
          </div>
          <nav aria-label="Parts of the kit" className="flex flex-wrap gap-1.5">
            {contents.map((entry) => (
              <a key={entry.id} href={`#${entry.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                {entry.label}
              </a>
            ))}
          </nav>
        </header>
        <KitTokens />
        <KitActions />
        <KitForms />
        <KitOverlays />
        <KitDisplay />
        <KitCharts />
        <KitAssistant />
        <KitAnalytics />
        <KitAhead />
      </div>
    </Toaster>
  )
}
