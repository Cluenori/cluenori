import type { ProjectKey } from "@cluenori/foundation"
import {
  ActivityIcon,
  BugIcon,
  LayoutGridIcon,
  LogOutIcon,
  MoonIcon,
  PaletteIcon,
  ScrollTextIcon,
  SearchIcon,
  SunIcon,
} from "lucide-react"
import { useState } from "react"

import type { Theme } from "@/lib/theme"
import { applyTheme, storedTheme } from "@/lib/theme"
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
export function AppSidebar({
  route,
  current,
  projects,
  onSearch,
  onSignOut,
}: {
  readonly route: Route
  /** The project the page shows, if any. */
  readonly current: ProjectKey | undefined
  readonly projects: ReadonlyArray<{ readonly key: ProjectKey; readonly name: string }>
  readonly onSearch: () => void
  readonly onSignOut: () => void
}) {
  const [theme, setTheme] = useState<Theme>(storedTheme)
  const component = "component" in route ? route.component : undefined
  const onOverview = route.page === "overview" || route.page === "start"

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-3 px-3 pt-4">
        <div className="flex items-center gap-2.5 px-1 group-data-[collapsible=icon]:hidden">
          <span className="grid size-7 place-items-center bg-primary font-mono text-sm font-semibold text-primary-foreground">
            C
          </span>
          <span className="text-[15px] font-semibold">Cluenori</span>
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
                return (
                  <SidebarMenuItem key={project.key}>
                    <SidebarMenuButton
                      isActive={current === project.key && onOverview}
                      tooltip={project.name}
                      render={<Link to={{ page: "overview", project: project.key }} />}
                      className="h-9"
                    >
                      {/* The project's initial, so a collapsed sidebar still tells projects apart. */}
                      <span
                        aria-hidden
                        className="grid size-4 shrink-0 place-items-center border font-mono text-[10px] uppercase"
                      >
                        {project.name.slice(0, 1)}
                      </span>
                      <span>{project.name}</span>
                    </SidebarMenuButton>
                    {current === project.key && (
                      <SidebarMenuSub>
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            isActive={onOverview}
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
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Sign out" className="text-muted-foreground" onClick={onSignOut}>
              <LogOutIcon />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
