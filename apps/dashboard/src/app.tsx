import type { ProjectKey } from "@cluenori/foundation"
import { RegistryProvider, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { Cause, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { FolderPlusIcon, SearchXIcon } from "lucide-react"
import { lazy, Suspense, useEffect, useState } from "react"

import { ErrorsPage } from "@/pages/errors-page"
import { LogsPage } from "@/pages/logs-page"
import { OperationPage } from "@/pages/operation-page"
import { OperationsPage } from "@/pages/operations-page"
import { OverviewPage } from "@/pages/overview-page"
import { PerformancePage } from "@/pages/performance-page"
import { meAtom, projectsAtom, signOutAtom } from "@/project-data"
import type { Route } from "@/router"
import { Link, useRoute } from "@/router"
import { AppSidebar } from "@/views/app-sidebar"
import { failureText } from "@/views/loaded"
import { Panel } from "@/views/panel"
import { SignIn } from "@/views/sign-in"
import { Button, buttonVariants } from "@/views/ui/button"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/views/ui/sidebar"
import { TooltipProvider } from "@/views/ui/tooltip"

// The design kit shows every view, with libraries no other page needs, so it loads when opened.
// React.lazy takes a module with a default export; ours are named.
const KitPage = lazy(() => import("@/pages/kit-page").then((module) => ({ default: module.KitPage })))

// Search, with the command library only it uses, isn't part of the first load: it starts loading as
// the app starts, so it is there by the time anyone presses ⌘K.
const searchDialog = import("@/views/search-dialog")
const SearchDialog = lazy(() => searchDialog.then((module) => ({ default: module.SearchDialog })))

// One error's page and one trace load after start too: most visits begin on a summary,
// and they are there by the time anyone opens one.
const errorPage = import("@/pages/error-page")
const ErrorPage = lazy(() => errorPage.then((module) => ({ default: module.ErrorPage })))
const tracePage = import("@/pages/trace-page")
const TracePage = lazy(() => tracePage.then((module) => ({ default: module.TracePage })))
// Phones, with the QR code encoder, are a page of the deployment, opened now and then.
const phonesPage = import("@/pages/phones-page")
const PhonesPage = lazy(() => phonesPage.then((module) => ({ default: module.PhonesPage })))

// Browsers and members, deployment pages too, and accepting an invitation, which a visit opens on.
const browsersPage = import("@/pages/browsers-page")
const BrowsersPage = lazy(() => browsersPage.then((module) => ({ default: module.BrowsersPage })))
const membersPage = import("@/pages/members-page")
const MembersPage = lazy(() => membersPage.then((module) => ({ default: module.MembersPage })))
const invitePage = import("@/pages/invite-page")
const InvitePage = lazy(() => invitePage.then((module) => ({ default: module.InvitePage })))

// While a page that loads after start isn't there yet, on a visit that opens on it.
const opening = <div className="p-8 text-sm text-muted-foreground">Opening the page…</div>

const page = "mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6"

/** The start of a workspace without projects: how to create the first. */
function NoProjects() {
  return (
    <div className={page}>
      <Panel
        icon={FolderPlusIcon}
        title="No projects yet"
        subtitle="A project is one product, with the components that ship separately"
      >
        <div className="flex max-w-2xl flex-col gap-3 px-5 py-6">
          <p className="text-[15px]">Create the first from a terminal, in Cluenori&apos;s folder:</p>
          <pre className="border bg-background px-3 py-2 font-mono text-sm">
            ./cluenori project create notes --name Notes
          </pre>
          <p className="text-sm text-muted-foreground">
            Then add its components, each with the ingest key its telemetry is sent with:{" "}
            <span className="font-mono">./cluenori component add notes notes-api --name &quot;Notes API&quot;</span>.
            Reload this page to see it.
          </p>
        </div>
      </Panel>
    </div>
  )
}

/** An address no page has, such as a mistyped link. */
function NoSuchPage() {
  return (
    <div className={page}>
      <Panel
        icon={SearchXIcon}
        title="There is no page at this address"
        subtitle="The link may be mistyped or cut short"
      >
        <div className="flex flex-col gap-4 px-5 py-6">
          <Link to={{ page: "start" }} className={buttonVariants({ variant: "outline", className: "self-start" })}>
            Open the first project
          </Link>
        </div>
      </Panel>
    </div>
  )
}

function PageOf({ route, first }: { readonly route: Route; readonly first: ProjectKey | undefined }) {
  switch (route.page) {
    case "start":
      return first === undefined ? <NoProjects /> : <OverviewPage project={first} />
    case "missing":
      return <NoSuchPage />
    case "overview":
      return <OverviewPage project={route.project} />
    case "performance":
      return (
        <PerformancePage
          project={route.project}
          {...(route.component === undefined ? {} : { component: route.component })}
        />
      )
    case "operations":
      return (
        <OperationsPage
          project={route.project}
          {...(route.component === undefined ? {} : { component: route.component })}
        />
      )
    case "operation":
      return (
        <OperationPage
          project={route.project}
          operation={route.operation}
          {...(route.component === undefined ? {} : { component: route.component })}
        />
      )
    case "errors":
      return (
        <ErrorsPage
          project={route.project}
          {...(route.component === undefined ? {} : { component: route.component })}
        />
      )
    case "error":
      return (
        <Suspense fallback={opening}>
          <ErrorPage
            key={route.error}
            project={route.project}
            error={route.error}
            {...(route.component === undefined ? {} : { component: route.component })}
          />
        </Suspense>
      )
    case "logs":
      return (
        <LogsPage project={route.project} {...(route.component === undefined ? {} : { component: route.component })} />
      )
    case "trace":
      return (
        <Suspense fallback={opening}>
          <TracePage
            key={route.trace}
            project={route.project}
            trace={route.trace}
            {...(route.around === undefined ? {} : { around: route.around })}
          />
        </Suspense>
      )
    case "phones":
      return (
        <Suspense fallback={opening}>
          <PhonesPage />
        </Suspense>
      )
    case "browsers":
      return (
        <Suspense fallback={opening}>
          <BrowsersPage />
        </Suspense>
      )
    case "members":
      return (
        <Suspense fallback={opening}>
          <MembersPage />
        </Suspense>
      )
    case "invite":
      return <NoSuchPage />
    case "kit":
      return (
        <Suspense fallback={<div className="p-8 text-sm text-muted-foreground">Opening the design kit…</div>}>
          <KitPage />
        </Suspense>
      )
  }
}

// Signed out: the API refused the call for want of the API token.
const isSignedOut = <A, E extends { readonly _tag: string }>(result: AsyncResult.AsyncResult<A, E>) =>
  AsyncResult.isFailure(result) &&
  Option.exists(Cause.findErrorOption(result.cause), (error) => error._tag === "Unauthorized")

/**
 * The dashboard: the projects and their pages in the sidebar, the shared period, and the page the
 * address names. It asks for the projects first; signed out, it shows the sign-in instead. The
 * design kit, on sample data, opens either way.
 */
function Dashboard() {
  const route = useRoute()
  const projects = useAtomValue(projectsAtom)
  const me = useAtomValue(meAtom)
  const retry = useAtomRefresh(projectsAtom)
  const signOut = useAtomSet(signOutAtom)
  const [searching, setSearching] = useState(false)

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

  // An invitation is accepted signed out, or signed in as someone else: it signs this browser in.
  if (route.page === "invite") {
    return (
      <Suspense fallback={opening}>
        <InvitePage />
      </Suspense>
    )
  }
  if (route.page !== "kit" && isSignedOut(projects)) {
    return <SignIn />
  }
  if (route.page !== "kit" && !AsyncResult.isSuccess(projects)) {
    return (
      <main className="grid min-h-svh place-items-center bg-background p-4">
        {AsyncResult.isFailure(projects) ? (
          <div className="flex max-w-md flex-col items-start gap-4">
            <p role="alert" className="text-[15px] text-failure">
              {failureText(projects.cause)}
            </p>
            <Button variant="outline" onClick={retry}>
              Try again
            </Button>
          </div>
        ) : (
          <p aria-busy className="text-sm text-muted-foreground">
            Loading…
          </p>
        )}
      </main>
    )
  }

  const list = AsyncResult.isSuccess(projects) ? projects.value.projects : []
  const first = list[0]?.key
  // The project the page shows: the first one at the start.
  const shown = "project" in route ? route.project : undefined
  const current = route.page === "start" ? first : shown

  return (
    <SidebarProvider>
      <AppSidebar
        route={route}
        current={current}
        projects={list}
        owner={AsyncResult.isSuccess(me) && me.value.role === "owner"}
        onSearch={() => setSearching(true)}
        onSignOut={() => signOut()}
      />
      <SidebarInset className="min-w-0">
        <div className="flex h-12 items-center border-b px-3 md:hidden">
          <SidebarTrigger />
        </div>
        <PageOf route={route} first={first} />
      </SidebarInset>
      <Suspense fallback={null}>
        <SearchDialog open={searching} onOpenChange={setSearching} project={current} projects={list} />
      </Suspense>
    </SidebarProvider>
  )
}

export function App() {
  return (
    <RegistryProvider>
      <TooltipProvider>
        <Dashboard />
      </TooltipProvider>
    </RegistryProvider>
  )
}
