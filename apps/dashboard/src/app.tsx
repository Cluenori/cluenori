import type { EnvironmentKey, ProjectKey } from "@cluenori/foundation"
import { RegistryProvider, useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react"
import { cn } from "cn"
import { Cause, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { SearchXIcon } from "lucide-react"
import type { ReactNode } from "react"
import { lazy, Suspense, useEffect, useState } from "react"

import { useEnvironments } from "@/hooks/use-environments"
import type { ListedProject } from "@/pages/now-page"
import { NowPage } from "@/pages/now-page"
import { ProjectPage } from "@/pages/project-page"
import { TechPage } from "@/pages/tech-page"
import { meAtom, projectsAtom, signOutAtom } from "@/project-data"
import type { Environments } from "@/project-facts"
import type { Filters, Route } from "@/router"
import { Link, trailOf, useRoute } from "@/router"
import { AppSidebar } from "@/views/app-sidebar"
import { failureText } from "@/views/loaded"
import { PageTrail } from "@/views/page-trail"
import { Panel } from "@/views/panel"
import { Button, buttonVariants } from "@/views/ui/button"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/views/ui/sidebar"
import { TooltipProvider } from "@/views/ui/tooltip"

// The design kit shows every view, with libraries no other page needs, so it loads when opened.
// React.lazy takes a module with a default export; ours are named.
const KitPage = lazy(() => import("@/pages/kit-page").then((module) => ({ default: module.KitPage })))

// Signing in, which a visit signed in already doesn't need, loads after start too, so it is there
// by the time the API says a visit is signed out.
const signIn = import("@/views/sign-in")
const SignIn = lazy(() => signIn.then((module) => ({ default: module.SignIn })))

// Search, with the command library only it uses, isn't part of the first load: it starts loading as
// the app starts, so it is there by the time anyone presses ⌘K.
const searchDialog = import("@/views/search-dialog")
const SearchDialog = lazy(() => searchDialog.then((module) => ({ default: module.SearchDialog })))

// Each of Tech's full pages loads after start too, and every operation's, one error's and one
// trace: most visits begin on Now, a project, or Tech's summary, and they are there by the time
// anyone opens one.
const performancePage = import("@/pages/performance-page")
const PerformancePage = lazy(() => performancePage.then((module) => ({ default: module.PerformancePage })))
const errorsPage = import("@/pages/errors-page")
const ErrorsPage = lazy(() => errorsPage.then((module) => ({ default: module.ErrorsPage })))
const logsPage = import("@/pages/logs-page")
const LogsPage = lazy(() => logsPage.then((module) => ({ default: module.LogsPage })))
const incidentsPage = import("@/pages/incidents-page")
const IncidentsPage = lazy(() => incidentsPage.then((module) => ({ default: module.IncidentsPage })))
const operationPage = import("@/pages/operation-page")
const OperationPage = lazy(() => operationPage.then((module) => ({ default: module.OperationPage })))
const errorPage = import("@/pages/error-page")
const ErrorPage = lazy(() => errorPage.then((module) => ({ default: module.ErrorPage })))
const OccurrencePage = lazy(() => errorPage.then((module) => ({ default: module.OccurrencePage })))
const tracePage = import("@/pages/trace-page")
const TracePage = lazy(() => tracePage.then((module) => ({ default: module.TracePage })))
// Releases, and one release, load after start too, so the first load holds its budget.
const releasesPage = import("@/pages/releases-page")
const ReleasesPage = lazy(() => releasesPage.then((module) => ({ default: module.ReleasesPage })))
const releasePage = import("@/pages/release-page")
const ReleasePage = lazy(() => releasePage.then((module) => ({ default: module.ReleasePage })))
// Analytics and its pages load after start too: how apps are used, their releases' health, and
// their keys and version policies.
const analyticsPage = import("@/pages/analytics-page")
const AnalyticsPage = lazy(() => analyticsPage.then((module) => ({ default: module.AnalyticsPage })))
const appReleasesPage = import("@/pages/app-releases-page")
const AppReleasesPage = lazy(() => appReleasesPage.then((module) => ({ default: module.AppReleasesPage })))
const appReleasePage = import("@/pages/app-release-page")
const AppReleasePage = lazy(() => appReleasePage.then((module) => ({ default: module.AppReleasePage })))
const featuresPage = import("@/pages/features-page")
const FeaturesPage = lazy(() => featuresPage.then((module) => ({ default: module.FeaturesPage })))
const featurePage = import("@/pages/feature-page")
const FeaturePage = lazy(() => featurePage.then((module) => ({ default: module.FeaturePage })))
const personPage = import("@/pages/person-page")
const PersonPage = lazy(() => personPage.then((module) => ({ default: module.PersonPage })))
// Feeds, the deployment's live lists of chosen events, load after start too.
const feedsPage = import("@/pages/feeds-page")
const FeedsPage = lazy(() => feedsPage.then((module) => ({ default: module.FeedsPage })))
const FeedPage = lazy(() => feedsPage.then((module) => ({ default: module.FeedPage })))
// Phones, with the QR code encoder, are a page of the deployment, opened now and then.
const phonesPage = import("@/pages/phones-page")
const PhonesPage = lazy(() => phonesPage.then((module) => ({ default: module.PhonesPage })))

// Browsers and members, deployment pages too, and accepting an invitation, which a visit opens on.
const browsersPage = import("@/pages/browsers-page")
const BrowsersPage = lazy(() => browsersPage.then((module) => ({ default: module.BrowsersPage })))
const membersPage = import("@/pages/members-page")
const MembersPage = lazy(() => membersPage.then((module) => ({ default: module.MembersPage })))
const invitePage = import("@/pages/invite-page")
// Connecting GitHub, once per deployment, loads when opened.
const GitHubPage = lazy(() => import("@/pages/github-page").then((module) => ({ default: module.GitHubPage })))
const InvitePage = lazy(() => invitePage.then((module) => ({ default: module.InvitePage })))

// While a page that loads after start isn't there yet, on a visit that opens on it.
const opening = <div className="p-8 text-sm text-muted-foreground">Opening the page…</div>

const page = "mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6"

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
          <Link to={{ page: "now" }} className={buttonVariants({ variant: "outline", className: "self-start" })}>
            Go to Now
          </Link>
        </div>
      </Panel>
    </div>
  )
}

// A page's component and release, as its props take them; its environment comes resolved.
const filterProps = (route: Filters) => ({
  ...(route.component === undefined ? {} : { component: route.component }),
  ...(route.release === undefined ? {} : { release: route.release }),
})

/**
 * A project's page once the environment it shows is known (`useEnvironments`): the one its address
 * names, the one picked last, or production. While that waits for the project, a quiet line.
 */
function WithEnvironments({
  project,
  named,
  children,
}: {
  readonly project: ProjectKey
  readonly named: EnvironmentKey | undefined
  readonly children: (environments: Environments) => ReactNode
}) {
  const environments = useEnvironments(project, named)
  return environments === undefined ? opening : children(environments)
}

function PageOf({ route, projects }: { readonly route: Route; readonly projects: ReadonlyArray<ListedProject> }) {
  switch (route.page) {
    case "now":
      return <NowPage projects={projects} />
    case "missing":
      return <NoSuchPage />
    case "project":
      return <ProjectPage key={route.project} project={route.project} />
    case "tech":
      return (
        <WithEnvironments project={route.project} named={route.environment}>
          {(environments) => <TechPage project={route.project} environments={environments} />}
        </WithEnvironments>
      )
    case "incidents":
      return (
        <Suspense fallback={opening}>
          <IncidentsPage project={route.project} />
        </Suspense>
      )
    case "performance":
      return (
        <WithEnvironments project={route.project} named={route.environment}>
          {(environments) => (
            <Suspense fallback={opening}>
              <PerformancePage
                project={route.project}
                environments={environments}
                {...filterProps(route)}
                {...(route.at === undefined ? {} : { at: route.at })}
              />
            </Suspense>
          )}
        </WithEnvironments>
      )
    case "operation":
      return (
        <WithEnvironments project={route.project} named={route.environment}>
          {(environments) => (
            <Suspense fallback={opening}>
              <OperationPage
                project={route.project}
                operation={route.operation}
                environments={environments}
                {...filterProps(route)}
                {...(route.at === undefined ? {} : { at: route.at })}
              />
            </Suspense>
          )}
        </WithEnvironments>
      )
    case "errors":
      return (
        <WithEnvironments project={route.project} named={route.environment}>
          {(environments) => (
            <Suspense fallback={opening}>
              <ErrorsPage project={route.project} environments={environments} {...filterProps(route)} />
            </Suspense>
          )}
        </WithEnvironments>
      )
    case "error":
      return (
        <WithEnvironments project={route.project} named={route.environment}>
          {(environments) => (
            <Suspense fallback={opening}>
              <ErrorPage
                key={route.error}
                project={route.project}
                error={route.error}
                environments={environments}
                {...filterProps(route)}
              />
            </Suspense>
          )}
        </WithEnvironments>
      )
    case "occurrence":
      return (
        <Suspense fallback={opening}>
          <OccurrencePage key={route.line} project={route.project} error={route.error} line={route.line} />
        </Suspense>
      )
    case "logs":
      return (
        <WithEnvironments project={route.project} named={route.environment}>
          {(environments) => (
            <Suspense fallback={opening}>
              <LogsPage project={route.project} environments={environments} {...filterProps(route)} />
            </Suspense>
          )}
        </WithEnvironments>
      )
    case "releases":
      return (
        <WithEnvironments project={route.project} named={route.environment}>
          {(environments) => (
            <Suspense fallback={opening}>
              <ReleasesPage
                project={route.project}
                environments={environments}
                {...(route.component === undefined ? {} : { component: route.component })}
              />
            </Suspense>
          )}
        </WithEnvironments>
      )
    case "release":
      return (
        <Suspense fallback={opening}>
          <ReleasePage
            project={route.project}
            component={route.component}
            release={route.release}
            {...(route.environment === undefined ? {} : { environment: route.environment })}
          />
        </Suspense>
      )
    case "analytics":
    case "appReleases":
    case "features": {
      // Apps name environments of their own, so these pages work out which they show themselves.
      const props = {
        project: route.project,
        ...(route.component === undefined ? {} : { component: route.component }),
        ...(route.environment === undefined ? {} : { named: route.environment }),
      }
      return (
        <Suspense fallback={opening}>
          {route.page === "analytics" && <AnalyticsPage {...props} />}
          {route.page === "appReleases" && <AppReleasesPage {...props} />}
          {route.page === "features" && <FeaturesPage {...props} />}
        </Suspense>
      )
    }
    case "appRelease":
      return (
        <Suspense fallback={opening}>
          <AppReleasePage
            project={route.project}
            component={route.component}
            release={route.release}
            {...(route.environment === undefined ? {} : { environment: route.environment })}
          />
        </Suspense>
      )
    case "feature":
      return (
        <Suspense fallback={opening}>
          <FeaturePage
            key={route.feature}
            project={route.project}
            feature={route.feature}
            {...(route.environment === undefined ? {} : { named: route.environment })}
          />
        </Suspense>
      )
    case "person":
      return (
        <Suspense fallback={opening}>
          {"person" in route ? (
            <PersonPage key={route.person} project={route.project} person={route.person} />
          ) : (
            <PersonPage key={route.user} project={route.project} user={route.user} />
          )}
        </Suspense>
      )
    case "trace":
      return (
        <Suspense fallback={opening}>
          <TracePage
            key={route.trace}
            project={route.project}
            trace={route.trace}
            {...(route.around === undefined ? {} : { around: route.around })}
            {...(route.environment === undefined ? {} : { environment: route.environment })}
            {...(route.release === undefined ? {} : { release: route.release })}
          />
        </Suspense>
      )
    case "feeds":
      return (
        <Suspense fallback={opening}>
          <FeedsPage />
        </Suspense>
      )
    case "feed":
      return (
        <Suspense fallback={opening}>
          <FeedPage key={route.feed} feed={route.feed} />
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
    case "github":
      return (
        <Suspense fallback={opening}>
          <GitHubPage {...(route.returned === undefined ? {} : { returned: route.returned })} />
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
    return (
      <Suspense fallback={opening}>
        <SignIn />
      </Suspense>
    )
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
  // The project the page is of, if any.
  const current = "project" in route ? route.project : undefined
  const trail = trailOf(route, (project) => list.find((entry) => entry.key === project)?.name ?? project)

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
        {/* Where the page is, a level a step; on a phone, with the sidebar's button. Now has no trail. */}
        <div
          className={cn(
            "flex h-12 min-w-0 items-center gap-3 border-b px-3 md:px-6",
            trail.length === 0 && "md:hidden",
          )}
        >
          <SidebarTrigger className="md:hidden" />
          <PageTrail steps={trail} />
        </div>
        <PageOf route={route} projects={list} />
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
