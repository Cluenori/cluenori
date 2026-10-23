import type { ProjectKey } from "@cluenori/foundation"
import {
  BellDotIcon,
  ChartNoAxesColumnIcon,
  GitBranchIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  SearchIcon,
  ServerIcon,
  SmartphoneIcon,
  SunIcon,
  TagIcon,
  UsersIcon,
} from "lucide-react"
import { useState } from "react"

import type { Theme } from "@/lib/theme"
import { applyTheme, storedTheme } from "@/lib/theme"
import type { Door, Route } from "@/router"
import { doorOf, Link } from "@/router"
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

// A project's doors, in the order its page shows them.
const doors: ReadonlyArray<{ readonly door: Door; readonly label: string; readonly icon: typeof TagIcon }> = [
  { door: "product", label: "Product", icon: ChartNoAxesColumnIcon },
  { door: "tech", label: "Tech", icon: ServerIcon },
  { door: "releases", label: "Releases", icon: TagIcon },
]

/**
 * The sidebar: Now, then every project, one click away, with the open project's three doors under
 * it, marked while a page behind one is open; search; and the viewer's settings. An environment
 * chosen on one page stays chosen on the others, and a component on Product's and Releases'.
 */
export function AppSidebar({
  route,
  current,
  projects,
  owner,
  onSearch,
  onSignOut,
}: {
  readonly route: Route
  /** Whether who is signed in is an owner, who manages the members and connects GitHub. */
  readonly owner: boolean
  /** The project the page shows, if any. */
  readonly current: ProjectKey | undefined
  readonly projects: ReadonlyArray<{ readonly key: ProjectKey; readonly name: string }>
  readonly onSearch: () => void
  readonly onSignOut: () => void
}) {
  const [theme, setTheme] = useState<Theme>(storedTheme)
  const component = "component" in route ? route.component : undefined
  const environment = "environment" in route ? route.environment : undefined
  const inEnvironment = environment === undefined ? {} : { environment }
  const filters = { ...(component === undefined ? {} : { component }), ...inEnvironment }
  const opened = doorOf(route)
  const doorRoute = (door: Door, project: ProjectKey): Route => {
    switch (door) {
      case "product":
        return { page: "analytics", project, ...filters }
      case "tech":
        return { page: "tech", project, ...inEnvironment }
      case "releases":
        return { page: "releases", project, ...filters }
    }
  }

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
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={route.page === "now"}
                  tooltip="Now"
                  render={<Link to={{ page: "now" }} />}
                  className="h-9"
                >
                  <BellDotIcon />
                  <span>Now</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.map((project) => {
                return (
                  <SidebarMenuItem key={project.key}>
                    <SidebarMenuButton
                      isActive={current === project.key && route.page === "project"}
                      tooltip={project.name}
                      render={<Link to={{ page: "project", project: project.key }} />}
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
                        {doors.map((entry) => (
                          <SidebarMenuSubItem key={entry.door}>
                            <SidebarMenuSubButton
                              isActive={opened === entry.door}
                              render={<Link to={doorRoute(entry.door, project.key)} />}
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
              isActive={route.page === "phones"}
              tooltip="Phones"
              render={<Link to={{ page: "phones" }} />}
              className="text-muted-foreground"
            >
              <SmartphoneIcon />
              <span>Phones</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={route.page === "browsers"}
              tooltip="Browsers"
              render={<Link to={{ page: "browsers" }} />}
              className="text-muted-foreground"
            >
              <MonitorIcon />
              <span>Browsers</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {owner && (
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={route.page === "members"}
                tooltip="Members"
                render={<Link to={{ page: "members" }} />}
                className="text-muted-foreground"
              >
                <UsersIcon />
                <span>Members</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          {owner && (
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={route.page === "github"}
                tooltip="GitHub"
                render={<Link to={{ page: "github" }} />}
                className="text-muted-foreground"
              >
                <GitBranchIcon />
                <span>GitHub</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
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
