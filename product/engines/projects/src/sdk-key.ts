import { ComponentKey, ProjectKey } from "@cluenori/foundation"
import { Schema } from "effect"

// cluenori-sdk.<project>.<component>.<id>: keys never contain dots, and the ID is 16 random bytes as
// base64url, 22 characters, which has none either.
const idPattern = /^[A-Za-z0-9_-]{22}$/

const partsOf = (text: string) => {
  const [prefix, project, component, id, ...rest] = text.split(".")
  return { prefix, project, component, id, rest }
}

/**
 * The key an app's builds carry, so its SDK can send that component's signals and read its manifest:
 * `cluenori-sdk.<project>.<component>.<id>`. Public, as anything shipped in an app is, so it grants
 * nothing else; unguessable, as its ID is 16 random bytes. It names its project, so the Worker
 * routes it before the project checks it.
 */
export const SdkKey = Schema.String.check(
  Schema.makeFilter(
    (text) => {
      const { prefix, project, component, id, rest } = partsOf(text)
      return (
        prefix === "cluenori-sdk" &&
        Schema.is(ProjectKey)(project) &&
        Schema.is(ComponentKey)(component) &&
        id !== undefined &&
        idPattern.test(id) &&
        rest.length === 0
      )
    },
    { expected: "an SDK key: cluenori-sdk.<project>.<component>.<id>" },
  ),
).pipe(Schema.brand("SdkKey"))
export type SdkKey = typeof SdkKey.Type

/** The project and component an SDK key names. Only the project can tell whether it is active. */
export const sdkKeyScope = (key: SdkKey) => {
  const { project, component } = partsOf(key)
  return { project: ProjectKey.make(project ?? ""), component: ComponentKey.make(component ?? "") }
}
