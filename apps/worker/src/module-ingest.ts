import type { ModuleIngests } from "@cluenori/foundation"
import { IngestKey, ingestKeyScope } from "@cluenori/projects"
import { Effect, Result, Schema } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

import { moduleIngestCall } from "./project-calls.ts"
import { ProjectObjects } from "./project-objects.ts"

// A write from a component's tooling is a small JSON document, far below this.
const maxBodyBytes = 1024 * 1024

const refuse = (status: number, message: string) => HttpServerResponse.text(`${message}\n`, { status })

/**
 * `POST /ingest/v1/<module>/<name>`: one of a module's ingest writes, sent by a component's own
 * tooling, such as its CI, with the component's ingest key as a bearer token, and run in the
 * project's Durable Object for that component. JSON in and out: 200 with the answer, or 204 for
 * none; 400 for a body that isn't the write's; 401 for a key that isn't the project's; 422 for a
 * failure the write names, with its tag.
 */
export const moduleIngestRoute = <Ingests extends ModuleIngests<Ingests>>(
  module: { readonly id: string; readonly ingest: Ingests },
  name: keyof Ingests & string,
) =>
  HttpRouter.add(
    "POST",
    `/ingest/v1/${module.id}/${name}`,
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const authorization = request.headers["authorization"] ?? ""
      const presented = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : ""
      if (!Schema.is(IngestKey)(presented)) {
        return refuse(
          401,
          "Send the component's ingest key: Authorization: Bearer cluenori.<project>.<component>.<secret>",
        )
      }
      if (Number(request.headers["content-length"] ?? "0") > maxBodyBytes) {
        return refuse(413, `A write may be at most ${maxBodyBytes} bytes.`)
      }
      const text = yield* request.text.pipe(Effect.orDie)
      if (text.length > maxBodyBytes) {
        return refuse(413, `A write may be at most ${maxBodyBytes} bytes.`)
      }
      const call = moduleIngestCall(module, name)
      const ingest = module.ingest[name]
      const json = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(Effect.result)
      if (Result.isFailure(json)) {
        return refuse(400, `The body isn't JSON: ${json.failure.message}`)
      }
      const input = yield* Schema.decodeUnknownEffect(Schema.toCodecJson(call.input))({
        ingestKey: presented,
        input: json.success,
      }).pipe(Effect.result)
      if (Result.isFailure(input)) {
        return refuse(400, `The body isn't what ${module.id}/${name} takes: ${input.failure.message}`)
      }
      const objects = yield* ProjectObjects
      const answered = yield* objects.call(ingestKeyScope(presented).project, call, input.success).pipe(Effect.result)
      if (Result.isFailure(answered)) {
        return answered.failure._tag === "IngestKeyRejected"
          ? refuse(401, "The ingest key isn't one of this deployment's.")
          : refuse(422, `${module.id}/${name} refused it: ${answered.failure._tag}`)
      }
      const encoded = yield* Schema.encodeUnknownEffect(Schema.toCodecJson(ingest.success))(answered.success).pipe(
        Effect.orDie,
      )
      // A write that answers nothing encodes to null in JSON.
      return encoded === undefined || encoded === null
        ? HttpServerResponse.empty({ status: 204 })
        : yield* HttpServerResponse.json(encoded).pipe(Effect.orDie)
    }),
  )
