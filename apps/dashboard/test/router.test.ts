import { ComponentKey, EnvelopeName, ProjectKey } from "@cluenori/foundation"
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

  it("reads the deployment's pages, which no project's address names", () => {
    assert.deepStrictEqual(readBack({ page: "phones" }), { page: "phones" })
    assert.deepStrictEqual(readBack({ page: "kit" }), { page: "kit" })
  })

  it("opens a page that says so for an address with a key that isn't one", () => {
    assert.deepStrictEqual(routeOf("/Folio!/errors", ""), { page: "missing" })
    assert.deepStrictEqual(routeOf("/folio/errors/not-an-id", ""), { page: "missing" })
  })
})
