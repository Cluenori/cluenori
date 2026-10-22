# @cluenori/openapi-swift

Writes a typed Swift client of an HTTP API from its OpenAPI 3.1 document: one file of `Codable`
value types, a typed error, and one `async` method per operation, on Foundation alone.

## Use it

```ts
import { swiftClient } from "@cluenori/openapi-swift"

const swift = yield* swiftClient(document) // the Swift file's text
// An inline object fails with UnsupportedOpenApi:
// { path: "#/components/schemas/NoteList/properties/page", reason: "an inline object: name it as a schema of its own" }
```

The Swift it writes, for an API titled Notes:

```swift
let api = NotesAPI(baseURL: url, bearerToken: key, userAgent: "Notes/1.0 (12) iOS/27.1")
do {
    let notes = try await api.listNotes(since: .now.addingTimeInterval(-86_400), step: .`1h`)
} catch .unauthorized(let error) {
    // An error the API names, as its own type.
} catch .unreachable {
    // Offline: keep showing what was there.
} catch {
    // .unreadable or .unwritable: a status or a shape this client doesn't know, and why.
}
```

## Contract

`src/index.ts`. `swiftClient` takes the document as JSON and returns the file, or fails with
`UnsupportedOpenApi`, which says where and what to change.

## Depends on

`effect`.

## Decisions and constraints

- **Named schemas only.** Every object, enum, and union is a schema of its own, which becomes a
  Swift type of that name; an inline one is refused, since its Swift name would be made up. A named
  primitive, such as a branded string, is that primitive.
- **A copy is the same type.** A schema named `<Name>_<n>` that is the same as `<Name>`, as a
  document names a second copy of one an operation annotates, such as with its status, is read as
  `<Name>`, with no type of its own.
- **What it reads:** objects, string enums, unions of objects told apart by the one constant
  property they share (such as `_tag`), arrays, dictionaries, free-form JSON (`JSONValue`), dates
  (`format: date-time`, ISO 8601 both ways), path and query parameters, JSON bodies, and errors:
  4xx and 5xx answers of named objects with one constant, all told apart by the same property.
- **Newer servers don't break older apps.** An enum keeps a value it doesn't know, as a struct with
  static values rather than a closed `enum`; a union has an `unknown` case. A missing optional
  property is `nil`.
- **Swift 6:** value types are `Sendable` and `Hashable`; methods are `@concurrent`, so decoding never
  runs on the caller's actor; errors are typed (`throws(APIError)`). Enum values that aren't Swift
  names are raw identifiers, `` .`1m` `` (Swift 6.2). Long parameter lists end with a comma (6.1).
- **One request per call, no retries:** what to do when the network fails belongs to the app.
- **Linux too:** it imports `FoundationNetworking` where that exists.
