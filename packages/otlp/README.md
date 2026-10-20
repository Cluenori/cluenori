# @bagatka/otlp

Reads OpenTelemetry's OTLP/HTTP exports, protobuf bodies, into plain data, and writes the answers
exporters expect. Traces for now.

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

// The answer: empty when everything was accepted, or how many items were refused and why.
const answer = exportResponse({ count: 3, message: "A request ends before it starts" })
```

A body that isn't an export fails with `OtlpInvalid`, whose `message` says what is wrong and at
which byte: `The message ends 10 bytes too early, at byte 6727`.

## Contract

`src/index.ts`. Callers decode trace exports into resources, scopes and spans, and encode the
response. Span and trace IDs are lowercase hex of the bytes sent; times are nanoseconds as bigint;
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
- **Not yet:** logs and metrics, OTLP/JSON, and compressed bodies (the caller decompresses).
- **Needs `TextDecoder` and `TextEncoder`,** which every runtime it targets has. It compiles without
  platform types, so it declares those two in the files that use them.
