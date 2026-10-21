import { Effect } from "effect"

import { readDocument } from "./read-document.ts"
import type { Api, Declaration } from "./read-document.ts"
import { swiftName } from "./swift-names.ts"
import { UnsupportedOpenApi } from "./unsupported-open-api.ts"
import { caseName, clientName, writeSwift } from "./write-swift.ts"

// Names the generated file declares itself, or takes from Foundation and Swift.
const taken = ["APIError", "JSONValue", "Data", "Date", "URL", "String", "Int", "Double", "Bool", "Error", "Result"]

// Whether `text` can name a case or static property beside one the generated type declares itself.
const isCaseName = (text: string, declared: string) => swiftName(text) !== undefined && text !== declared

// A case of a union or an enum that can't be written, if one can't.
const badCase = (declaration: Declaration) => {
  switch (declaration._tag) {
    case "Union":
      return declaration.cases.map((entry) => caseName(entry.value)).find((entry) => !isCaseName(entry, "unknown"))
    case "Enum":
      return declaration.values.find((entry) => !isCaseName(entry, "rawValue"))
    case "Struct":
      return undefined
  }
}

// What a name collision or an unwritable name is, if the API has one.
const nameProblem = (api: Api): { readonly path: string; readonly reason: string } | undefined => {
  const client = clientName(api)
  if (swiftName(client) !== client) {
    return { path: "#/info/title", reason: `the client's name, ${client}, isn't a Swift name` }
  }
  for (const declaration of api.declarations) {
    if ([...taken, client].includes(declaration.name)) {
      return {
        path: `#/components/schemas/${declaration.name}`,
        reason: `${declaration.name} is a name the Swift client needs itself; rename the schema`,
      }
    }
    const bad = badCase(declaration)
    if (bad !== undefined) {
      return { path: `#/components/schemas/${declaration.name}`, reason: `its value ${bad} can't be a Swift case` }
    }
  }
  const errorCases = api.errors.map((error) => caseName(error.name))
  const badError = errorCases.find(
    (entry) => swiftName(entry) === undefined || ["unreachable", "unreadable", "unwritable"].includes(entry),
  )
  if (badError !== undefined) {
    return { path: "#/components/schemas", reason: `the error ${badError} can't be a case of APIError` }
  }
  return undefined
}

/**
 * Swift source for a typed client of `document`, an OpenAPI 3.1 document as JSON: one file of
 * `Codable` value types, an `APIError` of the errors the API names, and a client with one `async`
 * method per operation, on `URLSession` and Foundation alone.
 *
 * It reads the shapes an API built from named schemas has: objects, string enums, unions of objects
 * told apart by one constant property such as `_tag`, arrays, dictionaries, free-form JSON, and dates
 * (`format: date-time`). Fails with `UnsupportedOpenApi`, naming where, for anything else, such as an
 * inline object or enum, which needs a name to become a Swift type.
 */
export const swiftClient = Effect.fn("swiftClient")(function* (document: unknown) {
  const api = yield* readDocument(document)
  const problem = nameProblem(api)
  if (problem !== undefined) {
    return yield* new UnsupportedOpenApi(problem)
  }
  return writeSwift(api)
})
