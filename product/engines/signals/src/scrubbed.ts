import type { AnyValue, Attributes, ResourceLogs, ResourceSpans } from "@cluenori/otlp"
import { isSecretName, scrubText } from "@cluenori/scrub"

const isAttributes = (value: AnyValue): value is Attributes => value instanceof Map

// A value without credentials or personal data; a value named like a credential is removed whole.
const scrubbedValue = (name: string, value: AnyValue): AnyValue => {
  if (typeof value === "string") {
    return isSecretName(name) ? "[secret]" : scrubText(value)
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
        name: scrubText(span.name),
        attributes: scrubbedAttributes(span.attributes),
        events: span.events.map((event) => ({ ...event, attributes: scrubbedAttributes(event.attributes) })),
        status: { ...span.status, message: scrubText(span.status.message) },
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
