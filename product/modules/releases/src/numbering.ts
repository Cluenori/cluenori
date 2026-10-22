import type { ComponentKey } from "@cluenori/foundation"
import { ActivityLog, ProcessName, Source } from "@cluenori/foundation"
import type { Actor } from "@cluenori/foundation"
import { Projects } from "@cluenori/projects"
import { DateTime, Effect, Option } from "effect"

import { ReleaseRecords } from "./records.ts"
import { ReleaseNumbered, VersionSet } from "./releases-activity.ts"
import type { ComponentVersions, NumberCommit, NumberedRelease, SetVersion } from "./version.ts"
import { compareVersions, releaseOf, VersionNotSet, VersionRefused } from "./version.ts"

const source = Source.make("module:releases")

// Who numbers a commit: the component's CI, with its ingest key.
const numbering: Actor = { _tag: "System", process: ProcessName.make("releases.numbering") }

/** The project's components' version lines. Reads one table. */
export const componentVersions = Effect.gen(function* () {
  const records = yield* ReleaseRecords
  const lines = yield* records.versionLines
  const versions: ComponentVersions = { versions: lines }
  return versions
}).pipe(Effect.withSpan("Releases.versions"))

/**
 * Sets a component's version, with `version.set` for `actor`: its next builds are numbered in it,
 * their numbers continuing from the last given, or from `firstBuild`. Fails with `VersionRefused`
 * for a component the project lacks, a version lower than the current one, or a first build at or
 * below the last given.
 */
export const setVersion = Effect.fn("Releases.setVersion")(function* (actor: Actor, request: SetVersion) {
  const projects = yield* Projects
  const records = yield* ReleaseRecords
  const components = yield* projects.components.pipe(Effect.catchTag("ProjectNotFound", () => Effect.succeed([])))
  if (!components.some((component) => component.key === request.component)) {
    return yield* new VersionRefused({ reason: `The project has no component ${request.component}` })
  }
  const current = (yield* records.versionLines).find((line) => line.component === request.component)
  if (current !== undefined && compareVersions(request.version, current.version) < 0) {
    return yield* new VersionRefused({
      reason: `${request.version} is lower than ${request.component}'s version, ${current.version}: versions only go up`,
    })
  }
  const lastBuild = current?.lastBuild ?? 0
  if (request.firstBuild !== undefined && request.firstBuild <= lastBuild) {
    return yield* new VersionRefused({
      reason: `${request.component}'s builds are numbered up to ${lastBuild} already: its next is ${lastBuild + 1}`,
    })
  }
  const line = {
    component: request.component,
    version: request.version,
    lastBuild: request.firstBuild === undefined ? lastBuild : request.firstBuild - 1,
    setAt: yield* DateTime.now,
  }
  const log = yield* ActivityLog
  yield* log.commit({
    source,
    actor,
    write: records.saveVersionLine(line),
    activity: () => [
      {
        payload: VersionSet.make({
          version: request.version,
          ...(request.firstBuild === undefined ? {} : { firstBuild: request.firstBuild }),
        }),
        component: request.component,
      },
    ],
  })
  return { ...line, setAt: line.setAt }
})

/**
 * The release `request.commit` of `component` is: the one it was numbered as before, or the next,
 * `<version>+<last build + 1>`, kept with `release.numbered`. A commit numbered once keeps its
 * number whatever the version becomes, so it is one release in every environment. Fails with
 * `VersionNotSet` until a member sets the component's version. One write, in one transaction with
 * the version line's, so two numberings never share a number.
 */
export const numberCommit = Effect.fn("Releases.numberCommit")(function* (
  component: ComponentKey,
  request: NumberCommit,
) {
  const records = yield* ReleaseRecords
  const log = yield* ActivityLog
  const before = yield* records.numberOf(component, request.commit)
  if (Option.isSome(before)) {
    const again: NumberedRelease = {
      release: before.value.release,
      version: before.value.version,
      build: before.value.build,
      commit: before.value.commit,
    }
    return again
  }
  return yield* log.commit({
    source,
    actor: numbering,
    write: Effect.gen(function* () {
      const line = (yield* records.versionLines).find((each) => each.component === component)
      if (line === undefined) {
        return yield* new VersionNotSet({ component })
      }
      const build = line.lastBuild + 1
      const numbered: NumberedRelease = {
        release: releaseOf(line.version, build),
        version: line.version,
        build,
        commit: request.commit,
      }
      const now = yield* DateTime.now
      yield* records.saveNumber({ component, ...numbered }, now)
      yield* records.saveVersionLine({ ...line, lastBuild: build })
      // The release's commit is known from now, before it is built or deployed anywhere.
      yield* records.saveCommit(component, numbered.release, { sha: request.commit })
      return numbered
    }),
    activity: (numbered) => [
      {
        payload: ReleaseNumbered.make({ release: numbered.release, commit: numbered.commit }),
        component,
        release: numbered.release,
      },
    ],
  })
})
