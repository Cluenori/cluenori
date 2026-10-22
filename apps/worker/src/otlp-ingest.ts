import { exportResponse, protobufContentType } from "@bagatka/otlp"
import type { OtlpInvalid } from "@bagatka/otlp"
import type { ProjectKey } from "@cluenori/foundation"
import type { IngestKeyRejected } from "@cluenori/projects"
import { IngestKey, ingestKeyScope } from "@cluenori/projects"
import type { ArchiveUnavailable, Rejected } from "@cluenori/signals"
import { readLogs, readMetrics, readTraces } from "@cluenori/signals"
import type { Crypto } from "effect"
import { Effect, Option, Result, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

import { boundedBody } from "./bounded-body.ts"
import { projectCalls } from "./project-calls.ts"
import { ProjectObjects } from "./project-objects.ts"

// Exporters send batches of a few hundred records, far below this.
const maxBodyBytes = 8 * 1024 * 1024

const refuse = (status: number, message: string, headers?: Record<string, string>) =>
  HttpServerResponse.text(`${message}\n`, { status, ...(headers === undefined ? {} : { headers }) })

/** An export that passed the checks every signal shares, or the answer refusing it. */
type Received =
  | {
      readonly _tag: "Received"
      readonly body: Uint8Array
      readonly ingestKey: IngestKey
      readonly project: ProjectKey
    }
  | { readonly _tag: "Refused"; readonly response: HttpServerResponse.HttpServerResponse }

const refused = (status: number, message: string): Received => ({ _tag: "Refused", response: refuse(status, message) })

// The checks before reading: OTLP/HTTP protobuf, uncompressed, with a well-formed key, not too big.
const received = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const contentType = request.headers["content-type"] ?? ""
  const encoding = request.headers["content-encoding"] ?? "identity"
  const authorization = request.headers["authorization"] ?? ""
  const presented = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : ""
  if (!contentType.startsWith(protobufContentType)) {
    return refused(415, "Cluenori reads OTLP/HTTP with protobuf: set the exporter's protocol to http/protobuf.")
  }
  // Not handled: compressed exports. .NET's exporter doesn't compress unless told to; handling it
  // takes a size-capped DecompressionStream before decoding.
  if (encoding !== "identity") {
    return refused(415, `Cluenori doesn't read ${encoding} bodies yet: turn the exporter's compression off.`)
  }
  if (!Schema.is(IngestKey)(presented)) {
    return refused(
      401,
      "Send the component's ingest key: Authorization: Bearer cluenori.<project>.<component>.<secret>",
    )
  }
  const body = yield* boundedBody(request, maxBodyBytes)
  if (Option.isNone(body)) {
    return refused(413, `An export may be at most ${maxBodyBytes} bytes; send smaller batches.`)
  }
  const accepted: Received = {
    _tag: "Received",
    body: body.value,
    ingestKey: presented,
    project: ingestKeyScope(presented).project,
  }
  return accepted
})

/**
 * One OTLP/HTTP route: checks the export, reads it where it arrives, and has the project's object
 * archive and record it. Answers as OTLP expects: 200, with how many records weren't counted and
 * why; 401 for a key that isn't the project's; 503, to be sent again, when the archive is down.
 */
const otlpRoute = <E extends { readonly rejected: Rejected | undefined }>(
  path: `/otlp/v1/${string}`,
  read: (body: Uint8Array) => Effect.Effect<E, OtlpInvalid, Crypto.Crypto>,
  record: (
    project: ProjectKey,
    ingestKey: IngestKey,
    read: E,
  ) => Effect.Effect<"recorded" | "duplicate", IngestKeyRejected | ArchiveUnavailable, ProjectObjects>,
) =>
  HttpRouter.add(
    "POST",
    path,
    Effect.gen(function* () {
      const arrived = yield* received
      if (arrived._tag === "Refused") {
        return arrived.response
      }
      const readExport = yield* read(arrived.body).pipe(Effect.result)
      if (Result.isFailure(readExport)) {
        return refuse(400, `The body isn't an OTLP export: ${readExport.failure.message}`)
      }
      const recorded = yield* record(arrived.project, arrived.ingestKey, readExport.success).pipe(Effect.result)
      if (Result.isFailure(recorded) && recorded.failure._tag === "ArchiveUnavailable") {
        return refuse(503, "Cluenori can't keep exports right now; send this one again.", { "retry-after": "30" })
      }
      if (Result.isFailure(recorded)) {
        return refuse(401, "The ingest key isn't one of this deployment's.")
      }
      const { rejected } = readExport.success
      const answer = exportResponse(
        rejected === undefined ? undefined : { count: rejected.count, message: rejected.problem },
      )
      return HttpServerResponse.uint8Array(answer, { contentType: protobufContentType })
    }),
  )

/** `POST /otlp/v1/traces`: operations are counted, and the export is archived. */
export const OtlpTraces = otlpRoute("/otlp/v1/traces", readTraces, (project, ingestKey, read) =>
  ProjectObjects.use((objects) => objects.call(project, projectCalls.ingestTraces, { ingestKey, export: read.export })),
)

/** `POST /otlp/v1/logs`: warnings and errors are kept and grouped, and the export is archived. */
export const OtlpLogs = otlpRoute("/otlp/v1/logs", readLogs, (project, ingestKey, read) =>
  ProjectObjects.use((objects) => objects.call(project, projectCalls.ingestLogs, { ingestKey, export: read.export })),
)

/** `POST /otlp/v1/metrics`: archived as it arrives, until Cluenori reads metrics. */
export const OtlpMetrics = otlpRoute(
  "/otlp/v1/metrics",
  (body) => readMetrics(body).pipe(Effect.map((exported) => ({ export: exported, rejected: undefined }))),
  (project, ingestKey, read) =>
    ProjectObjects.use((objects) =>
      objects.call(project, projectCalls.ingestMetrics, { ingestKey, export: read.export }),
    ),
)
