import type { ComponentKey, ProjectKey } from "@cluenori/foundation"
import { SemanticVersion } from "@cluenori/releases"
import { Effect, Option } from "effect"

import { refuse } from "./api-client.ts"
import { parsed } from "./question.ts"

/** The part of a version a bump raises. */
export type VersionPart = "patch" | "minor" | "major"

const isPart = (text: string): text is VersionPart => text === "patch" || text === "minor" || text === "major"

/**
 * `current` with `part` raised by one and the parts after it 0: from 1.4.2, patch is 1.4.3, minor
 * 1.5.0, and major 2.0.0. The text isn't checked: a part past 999999 makes one the Schema refuses.
 */
export const bumped = (current: SemanticVersion, part: VersionPart) => {
  const [major = 0, minor = 0, patch = 0] = current.split(".").map(Number)
  switch (part) {
    case "patch":
      return `${major}.${minor}.${patch + 1}`
    case "minor":
      return `${major}.${minor + 1}.0`
    case "major":
      return `${major + 1}.0.0`
  }
}

/** What `version` was asked to set: a part of the current version to raise, or a version. */
export type VersionWanted = VersionPart | SemanticVersion

/**
 * `patch`, `minor` or `major`, or a version, `MAJOR.MINOR.PATCH`, from the command line. Refuses
 * anything else, before anything is asked of the API.
 */
export const versionWantedOf = Effect.fn("versionWantedOf")(function* (text: string) {
  if (isPart(text)) {
    return text
  }
  return yield* parsed(SemanticVersion, text, "a version, MAJOR.MINOR.PATCH, or patch, minor or major")
})

/**
 * The version a component is set to, as `wanted` asks: a version as it is, or its `current`
 * version with a part raised. Refuses a bump of a component with no version yet. Whether the
 * version may be set, such as one lower than now, is the API's to say.
 */
export const versionToSet = Effect.fn("versionToSet")(function* (request: {
  readonly project: ProjectKey
  readonly component: ComponentKey
  readonly wanted: VersionWanted
  readonly current: Option.Option<SemanticVersion>
}) {
  const wanted = request.wanted
  if (!isPart(wanted)) {
    return wanted
  }
  if (Option.isNone(request.current)) {
    return yield* refuse(
      `${request.component} has no version yet, so no ${wanted} to raise. Set its first: ./cluenori version ${request.project} ${request.component} 1.0.0`,
    )
  }
  return yield* parsed(SemanticVersion, bumped(request.current.value, wanted), "a version")
})
