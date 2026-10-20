import { lazy, Suspense, useEffect, useState } from "react"

import { FiltersProvider } from "@/filters"
import { EndpointPage } from "@/pages/endpoint-page"
import { EndpointsPage } from "@/pages/endpoints-page"
import { ErrorsPage } from "@/pages/errors-page"
import { LogsPage } from "@/pages/logs-page"
import { OverviewPage } from "@/pages/overview-page"
import { PerformancePage } from "@/pages/performance-page"
import { TracePage } from "@/pages/trace-page"
import type { Route } from "@/router"
import { useRoute } from "@/router"
import { AppSidebar } from "@/views/app-sidebar"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/views/ui/sidebar"
import { TooltipProvider } from "@/views/ui/tooltip"

// The design kit shows every view, with libraries no other page needs, so it loads when opened.
// React.lazy takes a module with a default export; ours are named.
const KitPage = lazy(() => import("@/pages/kit-page").then((module) => ({ default: module.KitPage })))

// Search, with the command library only it uses, isn't part of the first load: it starts loading as
// the app starts, so it is there by the time anyone presses ⌘K.
const searchDialog = import("@/views/search-dialog")
const SearchDialog = lazy(() => searchDialog.then((module) => ({ default: module.SearchDialog })))

function PageOf({ route }: { readonly route: Route }) {
  switch (route.page) {
    case "overview":
      return <OverviewPage project={route.project} />
    case "performance":
      return (
        <PerformancePage
          project={route.project}
          {...(route.component === undefined ? {} : { component: route.component })}
        />
      )
    case "endpoints":
      return (
        <EndpointsPage
          project={route.project}
          {...(route.component === undefined ? {} : { component: route.component })}
        />
      )
    case "endpoint":
      return (
        <EndpointPage
          project={route.project}
          endpoint={route.endpoint}
          {...(route.component === undefined ? {} : { component: route.component })}
        />
      )
    case "errors":
      return (
        <ErrorsPage
          project={route.project}
          {...(route.component === undefined ? {} : { component: route.component })}
          {...(route.error === undefined ? {} : { error: route.error })}
        />
      )
    case "logs":
      return (
        <LogsPage project={route.project} {...(route.component === undefined ? {} : { component: route.component })} />
      )
    case "trace":
      return <TracePage key={route.trace} project={route.project} trace={route.trace} />
    case "kit":
      return (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Opening the design kit…</div>}>
          <KitPage />
        </Suspense>
      )
  }
}

/** The dashboard: the projects and their pages in the sidebar, the shared period, and the page the address names. */
export function App() {
  const route = useRoute()
  const [searching, setSearching] = useState(false)
  const project = route.page === "kit" ? "folio" : route.project

  // ⌘K opens search from anywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setSearching((open) => !open)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <TooltipProvider>
      <FiltersProvider>
        <SidebarProvider>
          <AppSidebar route={route} onSearch={() => setSearching(true)} />
          <SidebarInset className="min-w-0">
            <div className="flex h-12 items-center border-b px-3 md:hidden">
              <SidebarTrigger />
            </div>
            <PageOf route={route} />
          </SidebarInset>
          <Suspense fallback={null}>
            <SearchDialog open={searching} onOpenChange={setSearching} project={project} />
          </Suspense>
        </SidebarProvider>
      </FiltersProvider>
    </TooltipProvider>
  )
}
