import { ComponentKey, EnvelopeName, EnvironmentKey, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import { assert, describe, it } from "@effect/vitest"

import type { Route } from "@/router"
import { hrefOf, routeOf } from "@/router"

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
    assert.deepStrictEqual(routeOf("/folio/releases/folio-ios", ""), { page: "missing" })
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
    assert.strictEqual(hrefOf({ page: "errors", project, release }), "/folio/errors?release=2.4.0%2B312")
    assert.deepStrictEqual(routeOf("/folio/logs", "?release=2.4.0%20beta"), { page: "missing" })
  })

  it("reads the deployment's pages, which no project's address names", () => {
    assert.deepStrictEqual(readBack({ page: "phones" }), { page: "phones" })
    assert.deepStrictEqual(readBack({ page: "kit" }), { page: "kit" })
  })

  it("opens a page that says so for an address with a key that isn't one", () => {
    assert.deepStrictEqual(routeOf("/Folio!/errors", ""), { page: "missing" })
    assert.deepStrictEqual(routeOf("/folio/errors/not-an-id", ""), { page: "missing" })
  })
})
