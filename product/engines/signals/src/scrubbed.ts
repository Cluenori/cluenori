import { isSecretName, scrubText } from "@bagatka/scrub"
import type { AnyValue, Attributes, ResourceLogs, ResourceSpans } from "@cluenori/otlp"

// Cluenori's own credentials, by their prefix: components' ingest keys
// (`cluenori.<project>.<component>.<secret>`, `@cluenori/projects`), phones' keys
// (`cluenori.phone.`) and browsers' sign-ins (`cluenori.sign-in.`), all of them followed by at
// least 16 key characters. SDK keys (`cluenori-sdk.`) are public, and stay.
const cluenoriKeyPrefixes = ["cluenori."]

/** `text` without credentials, Cluenori's own included, or personal data. */
export const scrubbedText = (text: string): string => scrubText(text, cluenoriKeyPrefixes)

const isAttributes = (value: AnyValue): value is Attributes => value instanceof Map

// A value without credentials or personal data; a value named like a credential is removed whole.
const scrubbedValue = (name: string, value: AnyValue): AnyValue => {
  if (typeof value === "string") {
    return isSecretName(name) ? "[secret]" : scrubbedText(value)
  }
  if (value === null || typeof value === "number" || typeof value === "boolean" || value instanceof Uint8Array) {
    return value
  }
  if (isAttributes(value)) {
    return scrubbedAttributes(value)
  }
  return value.map((item) => scrubbedValue(name, item))
}

/** Attributes with credentials and personal data removed from every text value. */
export const scrubbedAttributes = (attributes: Attributes): Attributes =>
  new Map(Array.from(attributes, ([name, value]) => [name, scrubbedValue(name, value)] as const))

/** A trace export with credentials and personal data removed from names, attributes, and events. */
export const scrubbedTraces = (resources: ReadonlyArray<ResourceSpans>): ReadonlyArray<ResourceSpans> =>
  resources.map((resource) => ({
    resource: scrubbedAttributes(resource.resource),
    scopeSpans: resource.scopeSpans.map((scope) => ({
      scope: scope.scope,
      spans: scope.spans.map((span) => ({
        ...span,
        name: scrubbedText(span.name),
        attributes: scrubbedAttributes(span.attributes),
        events: span.events.map((event) => ({ ...event, attributes: scrubbedAttributes(event.attributes) })),
        status: { ...span.status, message: scrubbedText(span.status.message) },
      })),
    })),
  }))

/** A log export with credentials and personal data removed from bodies and attributes. */
export const scrubbedLogs = (resources: ReadonlyArray<ResourceLogs>): ReadonlyArray<ResourceLogs> =>
  resources.map((resource) => ({
    resource: scrubbedAttributes(resource.resource),
    scopeLogs: resource.scopeLogs.map((scope) => ({
      scope: scope.scope,
      logRecords: scope.logRecords.map((record) => ({
        ...record,
        body: scrubbedValue("body", record.body),
        attributes: scrubbedAttributes(record.attributes),
      })),
    })),
  }))
