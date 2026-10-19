import type { PackageRule } from "@bagatka/workspace-rules"

const forTests = ["@effect/vitest", "vitest"]

// Product packages run inside a project's Durable Object, so their tests do too: in workerd, on the
// Durable Object's SQLite.
const forTestsInDurableObjects = ["@cloudflare/vitest-plugin", "@effect/sql-sqlite-do", "wrangler", ...forTests]

/**
 * Which packages may depend on which: the table in ARCHITECTURE.md, "Dependency rules", as data.
 * A change here is an architecture change, and updates that table in the same change.
 */
export const dependencyRules: ReadonlyArray<PackageRule> = [
  {
    folders: "packages/*",
    name: "@bagatka/*",
    contract: true,
    mayUse: ["packages/*"],
    mayInstall: ["effect"],
    mayInstallForDevelopment: forTests,
  },
  {
    folders: "product/foundation",
    name: "@cluenori/foundation",
    contract: true,
    mayUse: ["packages/*"],
    mayInstall: ["effect"],
    mayInstallForDevelopment: forTestsInDurableObjects,
  },
  {
    folders: "product/engines/*",
    name: "@cluenori/*",
    contract: true,
    mayUse: ["packages/*", "product/foundation", "product/engines/*"],
    mayInstall: ["effect"],
    mayInstallForDevelopment: forTestsInDurableObjects,
  },
  {
    folders: "product/modules/*",
    name: "@cluenori/*",
    contract: true,
    mayUse: ["packages/*", "product/foundation", "product/engines/*"],
    mayInstall: ["effect"],
    mayInstallForDevelopment: forTestsInDurableObjects,
  },
  {
    folders: "apps/worker",
    name: "@cluenori/worker",
    contract: true,
    mayUse: ["packages/*", "product/foundation", "product/engines/*", "product/modules/*"],
    mayInstall: ["effect"],
    mayInstallForDevelopment: ["wrangler", ...forTests],
  },
  {
    folders: "apps/cli",
    name: "@cluenori/cli",
    contract: false,
    mayUse: ["packages/*", "apps/worker"],
    mayInstall: ["effect", "@effect/platform-bun"],
    mayInstallForDevelopment: forTests,
  },
  {
    folders: "apps/dashboard",
    name: "@cluenori/dashboard",
    contract: false,
    mayUse: ["packages/*", "apps/worker"],
    mayInstall: ["effect"],
    mayInstallForDevelopment: forTests,
  },
  {
    folders: "sdks/web",
    name: "@cluenori/sdk",
    contract: true,
    mayUse: ["packages/*", "apps/worker"],
    mayInstall: ["effect"],
    mayInstallForDevelopment: forTests,
  },
  {
    folders: "tests/journeys",
    name: "@cluenori/journeys",
    contract: false,
    mayUse: ["apps/worker"],
    mayInstall: [],
    mayInstallForDevelopment: ["effect", "@cloudflare/vitest-plugin", "wrangler", ...forTests],
  },
]
