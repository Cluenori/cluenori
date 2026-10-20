import { ComponentKey, ProjectKey } from "@cluenori/foundation"
import { Schema } from "effect"

// cluenori.<project>.<component>.<secret>: keys never contain dots, and the secret is 32 random bytes
// as base64url, which has none either.
const secretPattern = /^[A-Za-z0-9_-]{43}$/

const partsOf = (text: string) => {
  const [prefix, project, component, secret, ...rest] = text.split(".")
  return { prefix, project, component, secret, rest }
}

/**
 * The credential a component sends with its telemetry: `cluenori.<project>.<component>.<secret>`.
 * It names its project, so the Worker can route it before the project checks it. A secret: never log
 * it, and keep it `Redacted` after it is read.
 */
export const IngestKey = Schema.String.check(
  Schema.makeFilter(
    (text) => {
      const { prefix, project, component, secret, rest } = partsOf(text)
      return (
        prefix === "cluenori" &&
        Schema.is(ProjectKey)(project) &&
        Schema.is(ComponentKey)(component) &&
        secret !== undefined &&
        secretPattern.test(secret) &&
        rest.length === 0
      )
    },
    { expected: "an ingest key: cluenori.<project>.<component>.<secret>" },
  ),
).pipe(Schema.brand("IngestKey"))
export type IngestKey = typeof IngestKey.Type

/** The project and component an ingest key names. Only the project can tell whether it is valid. */
export const ingestKeyScope = (key: IngestKey) => {
  const { project, component } = partsOf(key)
  return { project: ProjectKey.make(project ?? ""), component: ComponentKey.make(component ?? "") }
}

/** The ingest key isn't one of this project's components' keys. Says nothing about which part is wrong. */
export class IngestKeyRejected extends Schema.TaggedError<IngestKeyRejected>()("IngestKeyRejected", {}) {}
