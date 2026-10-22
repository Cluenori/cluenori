import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"

import { swiftClient } from "../src/index.ts"

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const text = { type: "string" }

// A small API with each shape the generator reads: an object with a date, an optional property and
// free-form attributes; an enum whose values aren't Swift names; a union told apart by `_tag`; and
// errors.
const notes = {
  openapi: "3.1.0",
  info: { title: "Notes", version: "1" },
  paths: {
    "/api/notes": {
      get: {
        operationId: "notes.listNotes",
        description: "The notes, the latest first.",
        parameters: [
          { name: "since", in: "query", required: true, schema: { type: "string", format: "date-time" } },
          { name: "step", in: "query", required: false, schema: ref("Step") },
          { name: "limit", in: "query", required: false, schema: { type: "integer" } },
        ],
        responses: {
          "200": { description: "NoteList", content: { "application/json": { schema: ref("NoteList") } } },
          "401": { description: "Unauthorized", content: { "application/json": { schema: ref("Unauthorized") } } },
        },
      },
      post: {
        operationId: "notes.addNote",
        requestBody: { required: true, content: { "application/json": { schema: ref("AddNote") } } },
        responses: { "201": { description: "Note", content: { "application/json": { schema: ref("Note") } } } },
      },
    },
    "/api/notes/{note}": {
      delete: {
        operationId: "notes.removeNote",
        parameters: [{ name: "note", in: "path", required: true, schema: ref("NoteId") }],
        responses: {
          "204": { description: "Removed" },
          "404": {
            description: "NoteNotFound",
            content: { "application/json": { schema: { anyOf: [ref("NoteNotFound"), ref("Unauthorized")] } } },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      NoteId: { type: "string", maxLength: 36 },
      Note: {
        type: "object",
        properties: {
          id: ref("NoteId"),
          text,
          writtenAt: { type: "string", format: "date-time" },
          pinned: { type: "boolean" },
          default: text,
          attributes: { type: "object" },
          source: ref("Source"),
        },
        required: ["id", "text", "writtenAt", "attributes", "source"],
        additionalProperties: false,
      },
      NoteList: { type: "object", properties: { notes: { type: "array", items: ref("Note") } }, required: ["notes"] },
      AddNote: { type: "object", properties: { text }, required: ["text"] },
      Step: { type: "string", enum: ["1m", "1h", "internal"] },
      Typed: {
        type: "object",
        properties: { _tag: { type: "string", enum: ["typed"] }, keyboard: text },
        required: ["_tag", "keyboard"],
      },
      Spoken: {
        type: "object",
        properties: { _tag: { type: "string", enum: ["spoken"] }, seconds: { type: "number" } },
        required: ["_tag", "seconds"],
      },
      Source: { anyOf: [ref("Typed"), ref("Spoken")] },
      Unauthorized: {
        type: "object",
        properties: { _tag: { type: "string", enum: ["Unauthorized"] }, message: text },
        required: ["_tag", "message"],
      },
      NoteNotFound: {
        type: "object",
        properties: { _tag: { type: "string", enum: ["NoteNotFound"] }, note: ref("NoteId") },
        required: ["_tag", "note"],
      },
    },
  },
}

// `notes` with one schema replaced.
const withSchema = (name: string, schema: unknown) => ({
  ...notes,
  components: { schemas: { ...notes.components.schemas, [name]: schema } },
})

const written = (document: unknown) => swiftClient(document)
const refusal = (document: unknown) => swiftClient(document).pipe(Effect.flip)

describe("swiftClient", () => {
  it.effect("writes an object as a struct: dates as Date, a missing property optional, free-form JSON", () =>
    Effect.gen(function* () {
      const swift = yield* written(notes)
      assert.include(swift, "public struct Note: Codable, Hashable, Sendable {")
      assert.include(swift, "    public let id: String\n")
      assert.include(swift, "    public let writtenAt: Date\n")
      assert.include(swift, "    public let pinned: Bool?\n")
      assert.include(swift, "    public let `default`: String?\n")
      assert.include(swift, "    public let attributes: [String: JSONValue]\n")
      assert.include(swift, "public enum JSONValue: Codable, Hashable, Sendable {")
    }),
  )

  it.effect("writes an enum that keeps values it doesn't know, its values as Swift names", () =>
    Effect.gen(function* () {
      const swift = yield* written(notes)
      assert.include(swift, "public struct Step: RawRepresentable, Codable, Hashable, Sendable {")
      assert.include(swift, '    public static let `1m` = Step(rawValue: "1m")')
      assert.include(swift, '    public static let `internal` = Step(rawValue: "internal")')
    }),
  )

  it.effect("writes a union as an enum told apart by its constant, with a case for kinds it doesn't know", () =>
    Effect.gen(function* () {
      const swift = yield* written(notes)
      assert.include(
        swift,
        "public enum Source: Codable, Hashable, Sendable {\n    case typed(Typed)\n    case spoken(Spoken)\n    case unknown(String)",
      )
      assert.include(swift, '        case kind = "_tag"')
      assert.include(swift, '        case "spoken": self = .spoken(try Spoken(from: decoder))')
      // The constant isn't a property: the union reads and writes it.
      assert.notInclude(swift, "public let _tag")
    }),
  )

  it.effect("writes one method per operation, with its parameters, body, result, and errors", () =>
    Effect.gen(function* () {
      const swift = yield* written(notes)
      assert.include(swift, "public struct NotesAPI: Sendable {")
      assert.include(
        swift,
        // Over 100 characters, one parameter to a line.
        "    public func listNotes(\n        since: Date,\n        step: Step? = nil,\n        limit: Int? = nil,\n    ) async throws(APIError) -> NoteList {",
      )
      assert.include(swift, '        if let step { query.append(("step", Self.text(step))) }')
      assert.include(swift, "    public func addNote(_ body: AddNote) async throws(APIError) -> Note {")
      assert.include(swift, '"POST", "/api/notes", body: try Self.encoded(body)')
      assert.include(swift, "    public func removeNote(note: String) async throws(APIError) {")
      assert.include(swift, '_ = try await self.send("DELETE", "/api/notes/\\(Self.escaped(Self.text(note)))")')
      assert.include(swift, "    /// Fails with `.noteNotFound`, `.unauthorized`, or as any call can.")
      assert.include(
        swift,
        "public enum APIError: Error, Sendable {\n    case noteNotFound(NoteNotFound)\n    case unauthorized(Unauthorized)",
      )
      assert.include(swift, '            case "NoteNotFound": return .noteNotFound(')
    }),
  )

  it.effect("writes a schema's copy, named <name>_1, as the one type it is the same as", () =>
    Effect.gen(function* () {
      const swift = yield* written({
        ...notes,
        paths: {
          ...notes.paths,
          "/api/notes/{note}/pin": {
            post: {
              operationId: "notes.pinNote",
              parameters: [{ name: "note", in: "path", required: true, schema: ref("NoteId") }],
              responses: { "201": { description: "Note", content: { "application/json": { schema: ref("Note_1") } } } },
            },
          },
        },
        components: { schemas: { ...notes.components.schemas, Note_1: notes.components.schemas.Note } },
      })
      assert.include(swift, "    public func pinNote(note: String) async throws(APIError) -> Note {")
      assert.notInclude(swift, "Note_1")
    }),
  )

  it.effect("refuses what has no name to become a Swift type, saying where", () =>
    Effect.gen(function* () {
      const inlineObject = yield* refusal(
        withSchema("NoteList", {
          type: "object",
          properties: { page: { type: "object", properties: { size: text } } },
        }),
      )
      assert.deepStrictEqual(
        { path: inlineObject.path, reason: inlineObject.reason },
        {
          path: "#/components/schemas/NoteList/properties/page",
          reason: "an inline object: name it as a schema of its own",
        },
      )
      const inlineEnum = yield* refusal(
        withSchema("AddNote", { type: "object", properties: { color: { type: "string", enum: ["red", "blue"] } } }),
      )
      assert.strictEqual(inlineEnum.path, "#/components/schemas/AddNote/properties/color")
    }),
  )

  it.effect("refuses a union whose members share no constant, and an error that has none", () =>
    Effect.gen(function* () {
      const union = yield* refusal(withSchema("Source", { anyOf: [ref("Typed"), ref("AddNote")] }))
      assert.strictEqual(union.reason, "a union's members must share exactly one constant property, such as _tag")
      const error = yield* refusal(withSchema("Unauthorized", { type: "object", properties: { message: text } }))
      assert.strictEqual(error.reason, "an error must be a named object with one constant property, such as _tag")
    }),
  )

  it.effect("refuses a schema named like a type the client declares itself", () =>
    Effect.gen(function* () {
      const taken = yield* refusal(withSchema("APIError", { type: "object", properties: { message: text } }))
      assert.strictEqual(taken.path, "#/components/schemas/APIError")
    }),
  )
})
