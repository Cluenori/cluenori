import { exportResponse, protobufContentType } from "@bagatka/otlp"
import { IngestKey, ingestKeyScope } from "@cluenori/projects"
import { readRequests } from "@cluenori/signals"
import { Effect, Result, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

import { projectCalls } from "./project-calls.ts"
import { ProjectObjects } from "./project-objects.ts"

// Exporters send batches of a few hundred spans, far below this.
const maxBodyBytes = 8 * 1024 * 1024

const refuse = (status: number, message: string) => HttpServerResponse.text(`${message}\n`, { status })

/**
 * `POST /otlp/v1/traces`: OpenTelemetry trace exports over OTLP/HTTP with protobuf, sent with a
 * component's ingest key. Reads the requests where the export arrives and has the project's object
 * count them. Answers as OTLP expects: 200, with how many spans were refused and why, if any.
 */
export const OtlpRoutes = HttpRouter.add(
  "POST",
  "/otlp/v1/traces",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const contentType = request.headers["content-type"] ?? ""
    const encoding = request.headers["content-encoding"] ?? "identity"
    const authorization = request.headers["authorization"] ?? ""
    const presented = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : ""

    if (!contentType.startsWith(protobufContentType)) {
      return refuse(415, "Cluenori reads OTLP/HTTP with protobuf: set the exporter's protocol to http/protobuf.")
    }
    // Not handled: compressed exports. .NET's exporter doesn't compress unless told to; handling it
    // takes a size-capped DecompressionStream before decoding.
    if (encoding !== "identity") {
      return refuse(415, `Cluenori doesn't read ${encoding} bodies yet: turn the exporter's compression off.`)
    }
    if (!Schema.is(IngestKey)(presented)) {
      return refuse(
        401,
        "Send the component's ingest key: Authorization: Bearer cluenori.<project>.<component>.<secret>",
      )
    }
    // Refused before reading when the sender says the size, and after reading when it doesn't.
    const declaredBytes = Number(request.headers["content-length"] ?? "0")
    if (declaredBytes > maxBodyBytes) {
      return refuse(413, `An export may be at most ${maxBodyBytes} bytes; send smaller batches.`)
    }
    const body = yield* request.arrayBuffer.pipe(Effect.orDie)
    if (body.byteLength > maxBodyBytes) {
      return refuse(413, `An export may be at most ${maxBodyBytes} bytes; send smaller batches.`)
    }
    const read = yield* readRequests(new Uint8Array(body)).pipe(Effect.result)
    if (Result.isFailure(read)) {
      return refuse(400, `The body isn't an OTLP trace export: ${read.failure.message}`)
    }

    const objects = yield* ProjectObjects
    const { project } = ingestKeyScope(presented)
    const recorded = yield* objects
      .call(project, projectCalls.ingestRequests, { ingestKey: presented, batch: read.success.batch })
      .pipe(Effect.result)
    if (Result.isFailure(recorded)) {
      return refuse(401, "The ingest key isn't one of this deployment's.")
    }
    const rejected = read.success.rejected
    const answer = exportResponse(
      rejected === undefined ? undefined : { count: rejected.count, message: rejected.problem },
    )
    return HttpServerResponse.uint8Array(answer, { contentType: protobufContentType })
  }),
)
