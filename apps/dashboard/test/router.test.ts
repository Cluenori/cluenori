import { ComponentKey, EnvelopeName, EnvironmentKey, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import { assert, describe, it } from "@effect/vitest"

import type { Route } from "@/router"
import { doorOf, hrefOf, movedAddressOf, routeOf, trailOf } from "@/router"

// A route as the address bar reads it back: the path and the query apart, the escaped slashes
// Cloudflare turns back into slashes turned back too.
const readBack = (route: Route) => {
  const href = hrefOf(route).replaceAll("%2F", "/")
  const query = href.indexOf("?")
  return query === -1 ? routeOf(href, "") : routeOf(href.slice(0, query), href.slice(query))
}

const operation = (name: string): Route => ({
  page: "operation",
  project: ProjectKey.make("folio"),
  component: ComponentKey.make("folio-api"),
  operation: EnvelopeName.make(name),
})

describe("routeOf", () => {
  it("reads an operation's name back from its address, slashes, parameters, and a trailing slash too", () => {
    for (const name of ["GET /api/profile/{profileId:guid}/followers", "POST /api/profile/", "SendDigest"]) {
      assert.deepStrictEqual(readBack(operation(name)), operation(name))
    }
  })

  it("reads a release back from its address, its version's build and its environment too", () => {
    const release: Route = {
      page: "release",
      project: ProjectKey.make("folio"),
      component: ComponentKey.make("folio-ios"),
      release: ReleaseVersion.make("2.4.0+312"),
      environment: EnvironmentKey.make("production"),
    }
    assert.deepStrictEqual(readBack(release), release)
    const { environment: _, ...anywhere } = release
    assert.deepStrictEqual(readBack(anywhere), anywhere)
    assert.deepStrictEqual(routeOf("/projects/folio/releases/folio-ios", ""), { page: "missing" })
  })

  it("reads the release that performance, errors and logs are filtered to, and refuses one that isn't one", () => {
    const project = ProjectKey.make("folio")
    const release = ReleaseVersion.make("2.4.0+312")
    for (const page of ["performance", "errors", "logs"] as const) {
      const oneComponent: Route = { page, project, component: ComponentKey.make("folio-ios"), release }
      const everyComponent: Route = { page, project, release }
      assert.deepStrictEqual(readBack(oneComponent), oneComponent)
      assert.deepStrictEqual(readBack(everyComponent), everyComponent)
    }
    assert.strictEqual(hrefOf({ page: "errors", project, release }), "/projects/folio/errors?release=2.4.0%2B312")
    assert.deepStrictEqual(routeOf("/projects/folio/logs", "?release=2.4.0%20beta"), { page: "missing" })
  })

  it("reads the deployment's pages, which no project's address names", () => {
    assert.deepStrictEqual(readBack({ page: "phones" }), { page: "phones" })
    assert.deepStrictEqual(readBack({ page: "kit" }), { page: "kit" })
  })

  it("reads what GitHub sent the browser back to the GitHub page with", () => {
    for (const returned of [
      { _tag: "connected" },
      { _tag: "installed" },
      { _tag: "requested" },
      { _tag: "problem", problem: "GitHub sent no app back: connect GitHub again" },
    ] as const) {
      assert.deepStrictEqual(readBack({ page: "github", returned }), { page: "github", returned })
    }
    assert.deepStrictEqual(routeOf("/github", "?installation_id=72&setup_action=install"), {
      page: "github",
      returned: { _tag: "installed" },
    })
    assert.deepStrictEqual(routeOf("/github", ""), { page: "github" })
    assert.deepStrictEqual(routeOf("/github", "?problem=%20"), { page: "github" })
    assert.deepStrictEqual(routeOf("/github/apps", ""), { page: "missing" })
    // Anyone can put text in a link: a long problem is cut.
    const long = routeOf("/github", `?problem=${"a".repeat(2_000)}`)
    assert.strictEqual(
      long.page === "github" && long.returned?._tag === "problem" ? long.returned.problem.length : 0,
      500,
    )
  })

  it("opens a page that says so for an address with a key that isn't one", () => {
    assert.deepStrictEqual(routeOf("/projects/Folio!/errors", ""), { page: "missing" })
    assert.deepStrictEqual(routeOf("/projects/folio/errors/not-an-id", ""), { page: "missing" })
    assert.deepStrictEqual(routeOf("/folio/errors", ""), { page: "missing" })
  })

  it("reads each level of the tree back: Now, a project, its Tech and its incidents", () => {
    const project = ProjectKey.make("folio")
    const levels: ReadonlyArray<Route> = [
      { page: "now" },
      { page: "project", project },
      { page: "tech", project },
      { page: "tech", project, environment: EnvironmentKey.make("staging") },
      { page: "incidents", project },
    ]
    for (const level of levels) {
      assert.deepStrictEqual(readBack(level), level)
    }
    assert.strictEqual(hrefOf({ page: "project", project }), "/projects/folio")
    assert.deepStrictEqual(routeOf("/projects", ""), { page: "now" })
  })

  it("gives a project whose key is one of the deployment's pages its own pages", () => {
    const kit = ProjectKey.make("kit")
    assert.deepStrictEqual(readBack({ page: "logs", project: kit }), { page: "logs", project: kit })
    assert.deepStrictEqual(routeOf("/kit", ""), { page: "kit" })
  })
})

describe("movedAddressOf", () => {
  it("moves an address from before projects' pages were under /projects/ to where it is now", () => {
    assert.strictEqual(movedAddressOf("/folio"), "/projects/folio")
    assert.strictEqual(
      movedAddressOf("/folio/operations/GET%20/api/feed"),
      "/projects/folio/operations/GET%20/api/feed",
    )
  })

  it("leaves Now, the deployment's pages, today's addresses, and what was never a page alone", () => {
    for (const path of ["/", "/kit", "/github", "/phones", "/invite", "/projects/folio", "/Folio!/errors"]) {
      assert.isUndefined(movedAddressOf(path))
    }
  })
})

// The words of each step of a page's trail, its project named Folio.
const labelsOf = (route: Route) => trailOf(route, () => "Folio").map((step) => step.label)

describe("trailOf", () => {
  const project = ProjectKey.make("folio")

  it("leads from Now to a page a level a step, through the door it is behind", () => {
    assert.deepStrictEqual(labelsOf({ page: "now" }), [])
    assert.deepStrictEqual(labelsOf({ page: "project", project }), ["Now", "Folio"])
    assert.deepStrictEqual(labelsOf({ page: "tech", project }), ["Now", "Folio", "Tech"])
    assert.deepStrictEqual(labelsOf({ page: "errors", project }), ["Now", "Folio", "Tech", "Errors"])
    assert.deepStrictEqual(labelsOf(operation("GET /api/feed")), ["Now", "Folio", "Tech", "Operations", "Operation"])
    assert.deepStrictEqual(labelsOf({ page: "analytics", project }), ["Now", "Folio", "Product"])
    assert.deepStrictEqual(labelsOf({ page: "releases", project }), ["Now", "Folio", "Releases"])
    assert.deepStrictEqual(labelsOf({ page: "phones" }), ["Now", "Phones"])
  })

  it("links every step but the page itself, keeping the page's filters on the one between", () => {
    const steps = trailOf(operation("GET /api/feed"), () => "Folio")
    assert.isUndefined(steps.at(-1)?.to)
    assert.deepStrictEqual(steps.at(-2)?.to, {
      page: "operations",
      project: ProjectKey.make("folio"),
      component: ComponentKey.make("folio-api"),
    })
    assert.strictEqual(doorOf(operation("GET /api/feed")), "tech")
  })
})
