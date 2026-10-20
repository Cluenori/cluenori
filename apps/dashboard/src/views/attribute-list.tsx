import type { Schema } from "effect"

/** An attribute's value as text: scalars as they are, lists and objects spelled out. */
const attributeText = (value: Schema.Json): string => {
  if (value === null) {
    return "null"
  }
  if (Array.isArray(value)) {
    return `[${value.map(attributeText).join(", ")}]`
  }
  if (typeof value === "object") {
    return `{${Object.entries(value)
      .map(([key, entry]) => `${key}: ${attributeText(entry)}`)
      .join(", ")}}`
  }
  return `${value}`
}

/**
 * Everything a span or a log record carried beside its own fields, as sent: a row each, the key
 * beside its value where there is room, over it in a narrow panel. Says so when there is nothing.
 */
export function AttributeList({
  attributes,
  empty,
}: {
  readonly attributes: Schema.JsonObject
  /** What to say when there are none, such as "This step sent no details." */
  readonly empty: string
}) {
  const entries = Object.entries(attributes)
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>
  }
  return (
    <dl className="@container border font-mono text-[13px]">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="grid gap-x-4 gap-y-0.5 border-b px-3 py-1.5 last:border-b-0 @md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
        >
          <dt className="wrap-anywhere text-muted-foreground">{key}</dt>
          <dd className="wrap-anywhere">{attributeText(value)}</dd>
        </div>
      ))}
    </dl>
  )
}
