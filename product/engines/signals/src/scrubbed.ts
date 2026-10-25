import type { AnyValue, Attributes, ResourceLogs, ResourceSpans } from "@bagatka/otlp-protobuf"
import { OtlpInvalid } from "@bagatka/otlp-protobuf"
import { isSecretName, scrubText } from "@bagatka/scrub"

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
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean" ||
    value instanceof Uint8Array
  ) {
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

// What carries attributes: a resource, a scope, an event or a link.
const withScrubbedAttributes = <A extends { readonly attributes: Attributes }>(holder: A): A => ({
  ...holder,
  attributes: scrubbedAttributes(holder.attributes),
})

// A scope: its name and version are text, and the archive and the log index keep them.
const scrubbedScope = <A extends { readonly name: string; readonly version: string; readonly attributes: Attributes }>(
  scope: A,
): A => ({ ...withScrubbedAttributes(scope), name: scrubbedText(scope.name), version: scrubbedText(scope.version) })

/**
 * A trace export with credentials and personal data removed from every text it keeps: the names of
 * spans, events and scopes, scope versions, status messages, schema URLs, trace states, and the
 * attributes of its resources, scopes, spans, events and links.
 */
export const scrubbedTraces = (resources: ReadonlyArray<ResourceSpans>): ReadonlyArray<ResourceSpans> =>
  resources.map((resource) => ({
    ...resource,
    resource: withScrubbedAttributes(resource.resource),
    schemaUrl: scrubbedText(resource.schemaUrl),
    scopeSpans: resource.scopeSpans.map((scope) => ({
      ...scope,
      scope: scrubbedScope(scope.scope),
      schemaUrl: scrubbedText(scope.schemaUrl),
      spans: scope.spans.map((span) => ({
        ...span,
        name: scrubbedText(span.name),
        traceState: scrubbedText(span.traceState),
        attributes: scrubbedAttributes(span.attributes),
        events: span.events.map((event) => ({ ...withScrubbedAttributes(event), name: scrubbedText(event.name) })),
        links: span.links.map((link) => ({
          ...withScrubbedAttributes(link),
          traceState: scrubbedText(link.traceState),
        })),
        status: { ...span.status, message: scrubbedText(span.status.message) },
      })),
    })),
  }))

/**
 * A log export with credentials and personal data removed from every text it keeps: bodies,
 * severity texts, event names, scope names and versions, schema URLs and every attribute.
 */
export const scrubbedLogs = (resources: ReadonlyArray<ResourceLogs>): ReadonlyArray<ResourceLogs> =>
  resources.map((resource) => ({
    ...resource,
    resource: withScrubbedAttributes(resource.resource),
    schemaUrl: scrubbedText(resource.schemaUrl),
    scopeLogs: resource.scopeLogs.map((scope) => ({
      ...scope,
      scope: scrubbedScope(scope.scope),
      schemaUrl: scrubbedText(scope.schemaUrl),
      logRecords: scope.logRecords.map((record) => ({
        ...record,
        severityText: scrubbedText(record.severityText),
        body: scrubbedValue("body", record.body),
        eventName: scrubbedText(record.eventName),
        attributes: scrubbedAttributes(record.attributes),
      })),
    })),
  }))

/**
 * Why an export can't be archived, when its scrubbed archive can't be read back. The reader allows
 * one span, record or value for each 16 bytes, and scrubbing shortens text, so a body it read can
 * make an archive it can't; such an export is refused, rather than kept where no one can read it.
 */
export const unarchivable = (invalid: OtlpInvalid): OtlpInvalid =>
  new OtlpInvalid({
    reason: `Without its credentials and personal data, the export is too small for what it holds: ${invalid.reason}`,
  })
