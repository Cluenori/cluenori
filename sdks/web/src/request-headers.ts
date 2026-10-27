// The headers the SDK adds to the app's requests to its own API, so the API, and the jobs it starts,
// belong to the same feature and release as the screen that asked, and keep the app and release the
// trace started in (concept/Foundation.md, "Features: one filter across everything"; "Origin"):
// - `Cluenori-Release`: the app's release, by which the API can enforce the version policy;
// - `traceparent`: a new W3C trace for each request, unless the request has one;
// - `baggage`: `cluenori.feature`, `cluenori.origin.component` and `cluenori.origin.release`, after
//   any baggage the request has. The same keys as the Swift SDK's (RequestHeaders.swift).

export const releaseHeader = "Cluenori-Release"
export const featureKey = "cluenori.feature"
export const originComponentKey = "cluenori.origin.component"
export const originReleaseKey = "cluenori.origin.release"

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

/** `00-<trace ID>-<span ID>-01`: a sampled trace that starts at this request, from 24 random bytes. */
export const traceparentOf = (random: Uint8Array) => {
  const trace = random.slice(0, 16)
  const span = random.slice(16, 24)
  // An ID of zeros is invalid.
  if (trace.every((byte) => byte === 0)) {
    trace[15] = 1
  }
  if (span.every((byte) => byte === 0)) {
    span[7] = 1
  }
  return `00-${hex(trace)}-${hex(span)}-01`
}

// A baggage value: what isn't a baggage octet, percent-encoded (W3C Baggage, "value").
const encoded = (value: string) =>
  Array.from(new TextEncoder().encode(value), (byte) =>
    byte >= 0x21 && byte <= 0x7e && byte !== 0x22 && byte !== 0x2c && byte !== 0x3b && byte !== 0x5c && byte !== 0x25
      ? String.fromCharCode(byte)
      : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`,
  ).join("")

const valueOf = (headers: Readonly<Record<string, string>>, name: string) =>
  Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]

/** The headers for one request, with a new trace, merged into the request's `existing` ones. */
export const headersFor = (options: {
  readonly release: string
  readonly component: string
  readonly feature: string | undefined
  readonly existing: Readonly<Record<string, string>>
  readonly random: Uint8Array
}): Record<string, string> => {
  // The request's own headers stay, but for the release and baggage, which are set again below, under
  // their own names.
  const replaced = new Set([releaseHeader.toLowerCase(), "baggage"])
  const headers: Record<string, string> = Object.fromEntries(
    Object.entries(options.existing).filter(([name]) => !replaced.has(name.toLowerCase())),
  )
  headers[releaseHeader] = options.release
  if (valueOf(options.existing, "traceparent") === undefined) {
    headers["traceparent"] = traceparentOf(options.random)
  }
  const ours: Array<readonly [string, string]> = [
    ...(options.feature === undefined ? [] : [[featureKey, options.feature] as const]),
    [originComponentKey, options.component],
    [originReleaseKey, options.release],
  ]
  const names = new Set(ours.map(([name]) => name))
  // The request's own entries stay, but for ours, which this request's state replaces.
  const kept = (valueOf(options.existing, "baggage") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !names.has((entry.split("=")[0] ?? "").trim()))
  headers["baggage"] = [...kept, ...ours.map(([name, value]) => `${name}=${encoded(value)}`)].join(",")
  return headers
}
