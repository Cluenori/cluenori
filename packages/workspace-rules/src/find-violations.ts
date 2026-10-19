import { Order } from "effect"

import { findCycles } from "./find-cycles.ts"
import { matchesFolder } from "./folder-pattern.ts"
import type { PackageRule } from "./package-rule.ts"
import type { Member, Workspace } from "./read-workspace.ts"
import { Violation } from "./violation.ts"

/** Every way `workspace` breaks `rules`, sorted by folder, then check, then message. */
export const findViolations = (workspace: Workspace, rules: ReadonlyArray<PackageRule>): ReadonlyArray<Violation> => {
  const membersByName = new Map(
    workspace.members.flatMap((member) =>
      member.manifest.name === undefined ? [] : [[member.manifest.name, member] as const],
    ),
  )
  const violations = [
    ...catalogViolations(workspace.catalog),
    ...workspace.members.flatMap((member) => memberViolations(member, rules, membersByName)),
    ...cycleViolations(workspace.members, membersByName),
  ]
  return violations.toSorted(byFolderCheckMessage)
}

const byFolderCheckMessage = Order.combineAll<Violation>([
  Order.mapInput(Order.String, (violation) => violation.folder),
  Order.mapInput(Order.String, (violation) => violation.check),
  Order.mapInput(Order.String, (violation) => violation.message),
])

// A version with optional prerelease tag; ranges, tags, and URLs are not exact.
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

const catalogViolations = (catalog: Readonly<Record<string, string>>) =>
  Object.entries(catalog)
    .filter(([, version]) => !exactVersion.test(version))
    .map(
      ([name, version]) =>
        new Violation({
          folder: ".",
          check: "version",
          message: `The catalog gives ${name} as "${version}". Give one exact version, such as "1.2.3".`,
        }),
    )

const memberViolations = (
  member: Member,
  rules: ReadonlyArray<PackageRule>,
  membersByName: ReadonlyMap<string, Member>,
): ReadonlyArray<Violation> => {
  const { folder, manifest } = member
  const violation = (check: Violation["check"], message: string) => new Violation({ folder, check, message })

  const rule = rules.find((candidate) => matchesFolder(candidate.folders, folder))
  if (rule === undefined) {
    return [violation("rule", `No rule covers ${folder}. Add a rule for it, or move the package.`)]
  }
  const violations: Array<Violation> = []

  const expectedName = rule.name.replace("*", folder.slice(folder.lastIndexOf("/") + 1))
  if (manifest.name !== expectedName) {
    violations.push(
      violation(
        "name",
        `Is named "${manifest.name ?? ""}". Packages in ${rule.folders} are named ${rule.name}: "${expectedName}".`,
      ),
    )
  }

  if (rule.contract && !isContractExports(manifest.exports)) {
    violations.push(violation("contract", `Must export exactly { ".": "./src/index.ts" }, its contract.`))
  }
  if (rule.contract && !member.hasEntry) {
    violations.push(violation("contract", "Has no src/index.ts, the contract other packages import."))
  }
  if (!rule.contract && manifest.exports !== undefined) {
    violations.push(violation("contract", `Must not have exports: packages in ${rule.folders} have no contract.`))
  }

  const dependencies = manifest.dependencies ?? {}
  const devDependencies = manifest.devDependencies ?? {}
  const declared = [
    ...Object.entries(dependencies).map(([name, specifier]) => ({ name, specifier, forDevelopment: false })),
    ...Object.entries(devDependencies).map(([name, specifier]) => ({ name, specifier, forDevelopment: true })),
  ]
  for (const { name, specifier, forDevelopment } of declared) {
    const target = membersByName.get(name)
    if (target !== undefined && specifier !== "workspace:*") {
      violations.push(
        violation("version", `Depends on ${name} as "${specifier}". Workspace packages are "workspace:*".`),
      )
    }
    if (target !== undefined && !rule.mayUse.some((pattern) => matchesFolder(pattern, target.folder))) {
      violations.push(
        violation(
          "dependency",
          `May not depend on ${name} (${target.folder}). ${rule.folders} may use ${listed(rule.mayUse)}.`,
        ),
      )
    }
    if (target === undefined && specifier !== "catalog:") {
      violations.push(
        violation(
          "version",
          `Depends on ${name} as "${specifier}". npm packages are "catalog:", so the catalog holds their one version.`,
        ),
      )
    }
    const allowedForDevelopment = rule.mayInstallForDevelopment.includes(name)
    const allowed = rule.mayInstall.includes(name) || (forDevelopment && allowedForDevelopment)
    if (target === undefined && !allowed && allowedForDevelopment) {
      violations.push(
        violation(
          "dependency",
          `Has ${name} in dependencies. It is for tests and tools only: move it to devDependencies.`,
        ),
      )
    }
    if (target === undefined && !allowed && !allowedForDevelopment) {
      const installable = [...rule.mayInstall, ...rule.mayInstallForDevelopment]
      violations.push(
        violation("dependency", `May not depend on ${name}. ${rule.folders} may install ${listed(installable)}.`),
      )
    }
  }

  return violations
}

const cycleViolations = (members: ReadonlyArray<Member>, membersByName: ReadonlyMap<string, Member>) => {
  const edges = new Map(
    members.map((member) => {
      const names = [
        ...Object.keys(member.manifest.dependencies ?? {}),
        ...Object.keys(member.manifest.devDependencies ?? {}),
      ]
      return [member.folder, names.flatMap((name) => membersByName.get(name)?.folder ?? [])] as const
    }),
  )
  return findCycles(edges).map(
    (cycle) =>
      new Violation({
        folder: cycle[0] ?? "",
        check: "cycle",
        message: `Depends on itself: ${cycle.join(" → ")}. Move what they share into a package both use, or reverse one dependency.`,
      }),
  )
}

const isContractExports = (exports: unknown): boolean =>
  typeof exports === "object" &&
  exports !== null &&
  Object.keys(exports).length === 1 &&
  Object.getOwnPropertyDescriptor(exports, ".")?.value === "./src/index.ts"

const listed = (items: ReadonlyArray<string>) => (items.length === 0 ? "nothing" : items.join(", "))
