# @bagatka/otlp

Reads OpenTelemetry's OTLP/HTTP exports, protobuf bodies, into plain data, writes such data back as
exports, and writes the answers exporters expect. Traces and logs; metrics only by their framing.

## Use it

```ts
import { decodeTraces, exportResponse, protobufContentType } from "@bagatka/otlp"

const resources = yield* decodeTraces(body) // the bytes of POST /v1/traces
for (const { resource, scopeSpans } of resources) {
  const service = resource.get("service.name") // "notes-api"
  for (const span of scopeSpans.flatMap((scope) => scope.spans)) {
    // span.name "GET /api/notes/{id}", span.kind "server", span.status.code "error", ...
  }
}

const logs = yield* decodeLogs(body) // POST /v1/logs: records with severity, body, attributes, trace

// Data back to an export, such as after removing secrets: decoding it gives the same data.
const archived = encodeLogs(logs)

// The answer: empty when everything was accepted, or how many items were refused and why.
const answer = exportResponse({ count: 3, message: "A request ends before it starts" })
```

A body that isn't an export fails with `OtlpInvalid`, whose `message` says what is wrong and at
which byte: `The message ends 10 bytes too early, at byte 6727`.

## Contract

`src/index.ts`. Callers decode trace and log exports into resources, scopes, and spans or records,
encode such data back into exports, check a metrics export's framing, and encode the response. Span and trace IDs are lowercase hex of the bytes sent; times are nanoseconds as bigint;
attributes are maps.

## Depends on

`effect`.

## Decisions and constraints

- **Its own protobuf reader, for the messages OTLP uses.** No dependency: OTLP's trace messages are a
  few dozen fields, and the wire format takes about a hundred lines. Unknown fields are skipped, so
  newer exporters still decode.
- **Never throws on hostile input.** The first problem stops the reading and is reported once.
  Attribute values may nest at most 16 levels deep; callers bound the body's size.
- **Attributes are `Map`s,** so no key can reach an object's prototype. Integers beyond 2^53 lose
  precision, and invalid UTF-8 in a string becomes U+FFFD rather than losing the whole export.
- **Tested on real exports,** captured from OpenTelemetry .NET 1.19.1 (`test/fixtures/`), including
  its padded length prefixes and flags.
- **Encoding writes what decoding reads.** Fields the decoder skips (trace state, links, flags,
  dropped counts, schema URLs) aren't written; an integral double comes back as an integer.
- **Not yet:** reading metrics, OTLP/JSON, and compressed bodies (the caller decompresses).
- **Needs `TextDecoder` and `TextEncoder`,** which every runtime it targets has. It compiles without
  platform types, so it declares those two in the files that use them.
