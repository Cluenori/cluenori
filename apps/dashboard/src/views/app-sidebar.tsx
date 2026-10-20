import {
  ActivityIcon,
  BugIcon,
  LayoutGridIcon,
  MoonIcon,
  PaletteIcon,
  ScrollTextIcon,
  SearchIcon,
  SunIcon,
} from "lucide-react"
import { useState } from "react"

import type { Theme } from "@/lib/theme"
import { applyTheme, storedTheme } from "@/lib/theme"
import { projects } from "@/project-facts"
import type { Area, Route } from "@/router"
import { Link } from "@/router"
import { Kbd } from "@/views/ui/kbd"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/views/ui/sidebar"

// The sample's state of each project: failing now, receiving data, or quiet.
const sampleState: Readonly<Record<string, "failing" | "receiving" | "quiet">> = {
  folio: "failing",
  notes: "receiving",
  landing: "quiet",
}

const stateColor = { failing: "var(--failure)", receiving: "var(--mint)", quiet: "var(--dot)" } as const
const stateWords = { failing: "failing now", receiving: "receiving data", quiet: "nothing reported lately" } as const

// Pages that open from the performance page, so Performance stays marked on them.
const underPerformance = (route: Route) =>
  route.page === "endpoints" || route.page === "endpoint" || route.page === "trace"

const areas: ReadonlyArray<{ readonly area: Area; readonly label: string; readonly icon: typeof BugIcon }> = [
  { area: "performance", label: "Performance", icon: ActivityIcon },
  { area: "errors", label: "Errors", icon: BugIcon },
  { area: "logs", label: "Logs", icon: ScrollTextIcon },
]

/**
 * The sidebar: every project, one click away, with the open project's pages under it, search, and
 * the viewer's settings. A component chosen on one page stays chosen on the others.
 */
export function AppSidebar({ route, onSearch }: { readonly route: Route; readonly onSearch: () => void }) {
  const [theme, setTheme] = useState<Theme>(storedTheme)
  const current = route.page === "kit" ? undefined : route.project
  const component = "component" in route ? route.component : undefined

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 px-3 pt-4">
        <div className="flex items-center gap-2.5 px-1 group-data-[collapsible=icon]:hidden">
          <span className="grid size-7 place-items-center bg-primary font-mono text-sm font-semibold text-primary-foreground">
            C
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[15px] font-semibold">Cluenori</span>
            <span className="text-xs text-muted-foreground">Bagatka</span>
          </span>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onSearch} tooltip="Search" className="border text-muted-foreground">
              <SearchIcon />
              <span>Search</span>
              <Kbd className="ml-auto bg-transparent font-mono group-data-[collapsible=icon]:hidden">⌘K</Kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.map((project) => {
                const state = sampleState[project.key] ?? "quiet"
                return (
                  <SidebarMenuItem key={project.key}>
                    <SidebarMenuButton
                      isActive={current === project.key && route.page === "overview"}
                      tooltip={project.name}
                      render={<Link to={{ page: "overview", project: project.key }} />}
                      className="h-9"
                    >
                      <span
                        aria-label={stateWords[state]}
                        className="size-2.5 shrink-0"
                        style={{ backgroundColor: stateColor[state] }}
                      />
                      <span>{project.name}</span>
                    </SidebarMenuButton>
                    {current === project.key && (
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            isActive={route.page === "overview"}
                            render={<Link to={{ page: "overview", project: project.key }} />}
                          >
                            <LayoutGridIcon />
                            <span>Overview</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                        {areas.map((entry) => (
                          <SidebarMenuSubItem key={entry.area}>
                            <SidebarMenuSubButton
                              isActive={
                                route.page === entry.area || (entry.area === "performance" && underPerformance(route))
                              }
                              render={
                                <Link
                                  to={{
                                    page: entry.area,
                                    project: project.key,
                                    ...(component === undefined ? {} : { component }),
                                  }}
                                />
                              }
                            >
                              <entry.icon />
                              <span>{entry.label}</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="pb-4">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={route.page === "kit"}
              tooltip="Design kit"
              render={<Link to={{ page: "kit" }} />}
              className="text-muted-foreground"
            >
              <PaletteIcon />
              <span>Design kit</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={theme === "dark" ? "Light" : "Dark"}
              className="text-muted-foreground"
              onClick={() => {
                const next = theme === "dark" ? "light" : "dark"
                applyTheme(next)
                setTheme(next)
              }}
            >
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
              <span>{theme === "dark" ? "Light" : "Dark"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
