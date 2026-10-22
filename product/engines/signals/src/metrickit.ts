import { ReleaseVersion } from "@cluenori/foundation"
import { Option, Schema } from "effect"

import type { MetricKitReport } from "./app-batch.ts"

// What Cluenori reads of a MetricKit report, in the JSON representation iOS gives it
// (`MXDiagnosticPayload.jsonRepresentation()`, `MXMetricPayload.jsonRepresentation()`): how many
// diagnostics of each kind, and which release each is of. Everything else is only archived.

/** A kind of what MetricKit reports: a report itself, or one kind of diagnostic in one. */
export type DiagnosticKind = "report" | "crash" | "hang" | "cpu_exception" | "disk_write_exception"

/** How many of one kind a report holds, of one release. */
export interface DiagnosticCount {
  readonly release: ReleaseVersion
  readonly kind: DiagnosticKind
  readonly count: number
}

// The version and build a report or a diagnostic says it is of; any other keys are ignored.
const MetaData = Schema.Struct({
  appVersion: Schema.optionalKey(Schema.String),
  appBuildVersion: Schema.optionalKey(Schema.String),
})

const Diagnostic = Schema.Struct({
  diagnosticMetaData: Schema.optionalKey(MetaData),
  metaData: Schema.optionalKey(MetaData),
})

const Diagnostics = Schema.Array(Diagnostic)

const Payload = Schema.Struct({
  appVersion: Schema.optionalKey(Schema.String),
  metaData: Schema.optionalKey(MetaData),
  crashDiagnostics: Schema.optionalKey(Diagnostics),
  hangDiagnostics: Schema.optionalKey(Diagnostics),
  cpuExceptionDiagnostics: Schema.optionalKey(Diagnostics),
  diskWriteExceptionDiagnostics: Schema.optionalKey(Diagnostics),
})

const decodePayload = Schema.decodeUnknownOption(Payload)

const kinds = [
  ["crashDiagnostics", "crash"],
  ["hangDiagnostics", "hang"],
  ["cpuExceptionDiagnostics", "cpu_exception"],
  ["diskWriteExceptionDiagnostics", "disk_write_exception"],
] as const

// `0.3.0` and `20` as the release they make, `0.3.0+20`, when they make one.
const releaseFrom = (version: string | undefined, build: string | undefined): ReleaseVersion | undefined => {
  if (version === undefined || build === undefined) {
    return undefined
  }
  const release = `${version}+${build}`
  return Schema.is(ReleaseVersion)(release) ? release : undefined
}

/**
 * The diagnostics a MetricKit report holds, counted by kind and by the release each says it is of
 * (`sent`, the batch's release, when one names none); and the report itself, once for each release
 * it holds diagnostics of, or, with none, once for the release it names, else `sent`. A report whose
 * JSON isn't what MetricKit writes counts as a report of `sent` with nothing in it.
 */
export const diagnosticsOf = (
  report: typeof MetricKitReport.Type,
  sent: ReleaseVersion,
): ReadonlyArray<DiagnosticCount> => {
  const decoded = decodePayload(report.payload)
  if (Option.isNone(decoded)) {
    return [{ release: sent, kind: "report", count: 1 }]
  }
  const payload = decoded.value
  const reportRelease = releaseFrom(
    payload.metaData?.appVersion ?? payload.appVersion,
    payload.metaData?.appBuildVersion,
  )
  const counts = new Map<string, DiagnosticCount>()
  for (const [field, kind] of kinds) {
    for (const diagnostic of payload[field] ?? []) {
      const meta = diagnostic.diagnosticMetaData ?? diagnostic.metaData
      const release =
        releaseFrom(meta?.appVersion ?? payload.appVersion, meta?.appBuildVersion) ?? reportRelease ?? sent
      // Releases hold no NUL, so it separates the two unambiguously.
      const key = `${release}\u0000${kind}`
      counts.set(key, { release, kind, count: (counts.get(key)?.count ?? 0) + 1 })
    }
  }
  const releases = new Set([...counts.values()].map((counted) => counted.release))
  const reported = releases.size === 0 ? [reportRelease ?? sent] : [...releases]
  return [...counts.values(), ...reported.map((release): DiagnosticCount => ({ release, kind: "report", count: 1 }))]
}
