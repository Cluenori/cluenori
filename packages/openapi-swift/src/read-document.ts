import { Effect } from "effect"

import { camelCase, isIdentifier, swiftName } from "./swift-names.ts"
import { UnsupportedOpenApi } from "./unsupported-open-api.ts"

// What the generator understands of a document: its named types and its operations, each read once
// from the document's JSON and refused, with where and why, when it is something else.

/** A value's type, as Swift holds it. */
export type ValueType =
  | { readonly _tag: "String" }
  | { readonly _tag: "Date" }
  | { readonly _tag: "Int" }
  | { readonly _tag: "Double" }
  | { readonly _tag: "Bool" }
  | { readonly _tag: "Json" }
  | { readonly _tag: "Array"; readonly of: ValueType }
  | { readonly _tag: "Dictionary"; readonly of: ValueType }
  | { readonly _tag: "Named"; readonly name: string }

/** A property of an object, by its JSON key. */
export interface Property {
  readonly key: string
  readonly type: ValueType
  readonly required: boolean
}

/** A property with one possible value, such as an error's `_tag`: it tells objects apart. */
export interface Constant {
  readonly key: string
  readonly value: string
}

/**
 * A named type: an object; a set of strings; or a union of objects, told apart by the one constant
 * property they share, its `discriminator`.
 */
export type Declaration =
  | {
      readonly _tag: "Struct"
      readonly name: string
      readonly properties: ReadonlyArray<Property>
      readonly constants: ReadonlyArray<Constant>
    }
  | { readonly _tag: "Enum"; readonly name: string; readonly values: ReadonlyArray<string> }
  | {
      readonly _tag: "Union"
      readonly name: string
      readonly discriminator: string
      readonly cases: ReadonlyArray<{ readonly value: string; readonly type: string }>
    }

/** A path or query parameter. */
export interface Parameter {
  readonly name: string
  readonly type: ValueType
  readonly required: boolean
}

/** One operation of the API. */
export interface Operation {
  /** Its method's name: the last part of its operation ID, `phones.removePhone` as `removePhone`. */
  readonly name: string
  readonly description: string | undefined
  readonly method: "GET" | "PUT" | "POST" | "PATCH" | "DELETE"
  /** Its path, each parameter in braces: `/api/phones/{phone}`. */
  readonly path: string
  readonly pathParameters: ReadonlyArray<Parameter>
  readonly queryParameters: ReadonlyArray<Parameter>
  /** The named object its JSON body holds, if it takes one. */
  readonly body: string | undefined
  /** What a success holds; undefined when it has no body. */
  readonly result: ValueType | undefined
  /** The named errors it answers with. */
  readonly errors: ReadonlyArray<string>
}

/** The document, as the generator understands it. */
export interface Api {
  readonly title: string
  readonly declarations: ReadonlyArray<Declaration>
  readonly operations: ReadonlyArray<Operation>
  /** Every named error any operation answers with, by its value of `errorKey`. */
  readonly errors: ReadonlyArray<Constant & { readonly name: string }>
  /** The constant property that tells errors apart, such as `_tag`; undefined when there are none. */
  readonly errorKey: string | undefined
}

type JsonRecord = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isStrings = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((item) => typeof item === "string")

// A JSON pointer one key further in.
const at = (path: string, key: string | number) => `${path}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`

const refused = (path: string, reason: string) => Effect.fail(new UnsupportedOpenApi({ path, reason }))

const schemasPath = "#/components/schemas"
const componentPrefix = `${schemasPath}/`

const methods = { get: "GET", put: "PUT", post: "POST", patch: "PATCH", delete: "DELETE" } as const
const isMethod = (key: string): key is keyof typeof methods => Object.hasOwn(methods, key)

// Whether two JSON values are alike, whatever the order of their keys.
const sameJson = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameJson(item, b[index]))
    )
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a)
    return (
      keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
    )
  }
  return a === b
}

// Schemas named `<name>_<n>` that are the same as `<name>`, each to that name. A document may name a
// second copy of one schema so when an operation annotates it, such as with its status; it is still
// one type.
const copiesOf = (schemas: JsonRecord) =>
  new Map(
    Object.keys(schemas).flatMap((name) => {
      const original = /^(.+)_\d+$/.exec(name)?.[1]
      return original !== undefined && Object.hasOwn(schemas, original) && sameJson(schemas[original], schemas[name])
        ? [[name, original] as const]
        : []
    }),
  )

// The one value of a single-valued string enum, the way a constant property is written.
const constantOf = (schema: unknown) =>
  isRecord(schema) && schema["type"] === "string" && isStrings(schema["enum"]) && schema["enum"].length === 1
    ? schema["enum"][0]
    : undefined

/** Reads `document`, an OpenAPI 3.1 document as JSON, into what the generator writes Swift from. */
export const readDocument = Effect.fn("readDocument")(function* (document: unknown) {
  if (!isRecord(document) || !isRecord(document["info"]) || typeof document["info"]["title"] !== "string") {
    return yield* refused("#/info/title", "the document has no title, which names the client")
  }
  const title = document["info"]["title"]
  const components = isRecord(document["components"]) ? document["components"] : {}
  const schemas = isRecord(components["schemas"]) ? components["schemas"] : {}
  const paths = isRecord(document["paths"]) ? document["paths"] : {}
  const copies = copiesOf(schemas)

  for (const name of Object.keys(schemas)) {
    if (!isIdentifier(name) || swiftName(name) !== name) {
      return yield* refused(at(schemasPath, name), "a schema's name must be a Swift type name, such as PhoneList")
    }
  }

  const isNullType = (schema: unknown) => isRecord(schema) && schema["type"] === "null"

  const valueType = (schema: unknown, path: string): Effect.Effect<ValueType, UnsupportedOpenApi> =>
    Effect.gen(function* () {
      if (!isRecord(schema)) {
        return yield* refused(path, "a schema must be an object")
      }
      const ref = schema["$ref"]
      if (typeof ref === "string") {
        const referenced = ref.startsWith(componentPrefix) ? ref.slice(componentPrefix.length) : undefined
        const name = referenced === undefined ? undefined : (copies.get(referenced) ?? referenced)
        if (name === undefined || !Object.hasOwn(schemas, name)) {
          return yield* refused(path, `a reference to ${ref}, which isn't one of the document's schemas`)
        }
        const target = schemas[name]
        // A named primitive, such as a branded string, is that primitive.
        return isRecord(target) && isPrimitive(target)
          ? yield* valueType(target, at(schemasPath, name))
          : { _tag: "Named", name }
      }
      if ("anyOf" in schema || "oneOf" in schema) {
        return yield* refused(path, "an inline union: name it as a schema of its own")
      }
      switch (schema["type"]) {
        case "string":
          if (isStrings(schema["enum"]) && schema["enum"].length > 1) {
            return yield* refused(path, "an inline enum: name it as a schema of its own")
          }
          return schema["format"] === "date-time" ? { _tag: "Date" } : { _tag: "String" }
        case "integer":
          return { _tag: "Int" }
        case "number":
          return { _tag: "Double" }
        case "boolean":
          return { _tag: "Bool" }
        case "array":
          return { _tag: "Array", of: yield* valueType(schema["items"], at(path, "items")) }
        case "object": {
          if (isRecord(schema["properties"]) && Object.keys(schema["properties"]).length > 0) {
            return yield* refused(path, "an inline object: name it as a schema of its own")
          }
          const values = schema["additionalProperties"]
          return {
            _tag: "Dictionary",
            of:
              isRecord(values) && Object.keys(values).length > 0
                ? yield* valueType(values, at(path, "additionalProperties"))
                : { _tag: "Json" },
          }
        }
        case undefined:
          // No type: any JSON value.
          return { _tag: "Json" }
        default:
          return yield* refused(path, `a type of ${String(schema["type"])}, which has no Swift type here`)
      }
    })

  // Objects first, so unions can find their members' constants.
  const structs = new Map<string, Extract<Declaration, { readonly _tag: "Struct" }>>()
  const declarations: Array<Declaration> = []
  for (const [name, schema] of Object.entries(schemas)) {
    const path = at(schemasPath, name)
    if (!isRecord(schema) || isPrimitive(schema) || copies.has(name)) {
      continue
    }
    if (schema["type"] === "string" && isStrings(schema["enum"])) {
      declarations.push({ _tag: "Enum", name, values: schema["enum"] })
    } else if (schema["type"] === "object" && isRecord(schema["properties"])) {
      const required = isStrings(schema["required"]) ? schema["required"] : []
      const properties: Array<Property> = []
      const constants: Array<Constant> = []
      for (const [key, property] of Object.entries(schema["properties"])) {
        const propertyPath = at(at(path, "properties"), key)
        if (swiftName(key) === undefined) {
          return yield* refused(propertyPath, "a property whose key no Swift name can hold")
        }
        const constant = constantOf(property)
        if (constant !== undefined) {
          constants.push({ key, value: constant })
        } else {
          const isRequired = required.includes(key)
          // One type or null, on a property that may be missing: Swift's optional holds both, and
          // nil is sent as the key left out. A required one would have to be sent as null: refused.
          const members = isRecord(property) ? property["anyOf"] : undefined
          const nonNull = Array.isArray(members) ? members.filter((member) => !isNullType(member)) : []
          const nullable = Array.isArray(members) && members.length === 2 && nonNull.length === 1
          if (nullable && isRequired) {
            return yield* refused(propertyPath, "a required property that may be null")
          }
          const type = yield* valueType(nullable ? nonNull[0] : property, propertyPath)
          properties.push({ key, type, required: isRequired })
        }
      }
      const declaration = { _tag: "Struct", name, properties, constants } as const
      structs.set(name, declaration)
      declarations.push(declaration)
    } else if (!Array.isArray(schema["anyOf"]) && !Array.isArray(schema["oneOf"])) {
      return yield* refused(path, "a schema that is neither an object, an enum, nor a union of objects")
    }
  }
  for (const [name, schema] of Object.entries(schemas)) {
    const path = at(schemasPath, name)
    const members = isRecord(schema) ? (schema["anyOf"] ?? schema["oneOf"]) : undefined
    if (!Array.isArray(members) || copies.has(name)) {
      continue
    }
    const types: Array<Extract<Declaration, { readonly _tag: "Struct" }>> = []
    for (const [index, member] of members.entries()) {
      const type = yield* valueType(member, at(path, index))
      const struct = type._tag === "Named" ? structs.get(type.name) : undefined
      if (struct === undefined) {
        return yield* refused(at(path, index), "a union's members must be named objects")
      }
      types.push(struct)
    }
    // The keys every member has a constant of.
    const [first, ...others] = types
    const shared = (first?.constants ?? [])
      .map((constant) => constant.key)
      .filter((key) => others.every((struct) => struct.constants.some((constant) => constant.key === key)))
    const [discriminator, ...more] = shared
    if (discriminator === undefined || more.length > 0) {
      return yield* refused(path, "a union's members must share exactly one constant property, such as _tag")
    }
    const cases = types.map((struct) => ({
      value: struct.constants.find((constant) => constant.key === discriminator)?.value ?? "",
      type: struct.name,
    }))
    if (new Set(cases.map((entry) => entry.value)).size !== cases.length) {
      return yield* refused(path, `a union's members must each have their own ${discriminator}`)
    }
    declarations.push({ _tag: "Union", name, discriminator, cases })
  }

  // An error's schema, or each of a union of them, by name.
  const errorNames = (schema: unknown, path: string) =>
    Effect.gen(function* () {
      const members = isRecord(schema) && Array.isArray(schema["anyOf"]) ? schema["anyOf"] : [schema]
      const names: Array<string> = []
      for (const [index, member] of members.entries()) {
        const type = yield* valueType(member, members.length === 1 ? path : at(at(path, "anyOf"), index))
        const struct = type._tag === "Named" ? structs.get(type.name) : undefined
        if (struct?.constants.length !== 1) {
          return yield* refused(path, "an error must be a named object with one constant property, such as _tag")
        }
        names.push(struct.name)
      }
      return names
    })

  const operations: Array<Operation> = []
  for (const [route, item] of Object.entries(paths)) {
    const itemPath = at("#/paths", route)
    if (!isRecord(item)) {
      return yield* refused(itemPath, "a path's operations must be an object")
    }
    for (const [key, operation] of Object.entries(item)) {
      const path = at(itemPath, key)
      if (key === "summary" || key === "description") {
        continue
      }
      if (!isMethod(key) || !isRecord(operation)) {
        return yield* refused(path, "only GET, PUT, POST, PATCH and DELETE operations are supported")
      }
      const id = operation["operationId"]
      const name = typeof id === "string" ? camelCase(id.split(".").at(-1) ?? "") : ""
      if (!isIdentifier(name) || swiftName(name) !== name) {
        return yield* refused(at(path, "operationId"), "an operation needs an ID whose last part is a Swift name")
      }
      if (operations.some((other) => other.name === name)) {
        return yield* refused(at(path, "operationId"), `another operation is already called ${name}`)
      }

      const pathParameters: Array<Parameter> = []
      const queryParameters: Array<Parameter> = []
      const parameters = Array.isArray(operation["parameters"]) ? operation["parameters"] : []
      for (const [index, parameter] of parameters.entries()) {
        const parameterPath = at(at(path, "parameters"), index)
        if (!isRecord(parameter) || typeof parameter["name"] !== "string" || !isIdentifier(parameter["name"])) {
          return yield* refused(parameterPath, "a parameter needs a name that is a Swift name")
        }
        const type = yield* valueType(parameter["schema"], at(parameterPath, "schema"))
        if (type._tag === "Named" && structs.has(type.name)) {
          return yield* refused(parameterPath, "a parameter must be a string, a number, a date, or an enum")
        }
        const read = { name: parameter["name"], type, required: parameter["required"] === true }
        if (parameter["in"] === "path") {
          pathParameters.push({ ...read, required: true })
        } else if (parameter["in"] === "query") {
          queryParameters.push(read)
        } else {
          return yield* refused(parameterPath, "only path and query parameters are supported")
        }
      }

      let body: string | undefined
      const requestBody = operation["requestBody"]
      if (requestBody !== undefined) {
        const content = isRecord(requestBody) && isRecord(requestBody["content"]) ? requestBody["content"] : {}
        const json = content["application/json"]
        const type = isRecord(json) ? yield* valueType(json["schema"], at(path, "requestBody")) : undefined
        const struct = type?._tag === "Named" ? structs.get(type.name) : undefined
        if (struct === undefined || struct.constants.length > 0 || Object.keys(content).length !== 1) {
          return yield* refused(at(path, "requestBody"), "a body must be JSON of a named object without constants")
        }
        body = struct.name
      }

      let result: ValueType | undefined
      let succeeds = false
      const errors: Array<string> = []
      const responses = isRecord(operation["responses"]) ? operation["responses"] : {}
      for (const [status, response] of Object.entries(responses)) {
        const responsePath = at(at(path, "responses"), status)
        const code = Number(status)
        const content = isRecord(response) && isRecord(response["content"]) ? response["content"] : {}
        const json = content["application/json"]
        const schema = isRecord(json) ? json["schema"] : undefined
        if (code >= 200 && code < 300) {
          if (succeeds) {
            return yield* refused(responsePath, "an operation may answer with one success status only")
          }
          succeeds = true
          result = schema === undefined ? undefined : yield* valueType(schema, at(responsePath, "content"))
        } else if (code >= 400 && code < 600) {
          errors.push(...(yield* errorNames(schema, at(responsePath, "content"))))
        } else {
          return yield* refused(responsePath, "responses must have a 2xx, 4xx or 5xx status")
        }
      }
      if (!succeeds) {
        return yield* refused(at(path, "responses"), "an operation must answer with a 2xx status")
      }

      const description = operation["description"]
      operations.push({
        name,
        description: typeof description === "string" ? description : undefined,
        method: methods[key],
        path: route,
        pathParameters,
        queryParameters,
        body,
        result,
        errors: [...new Set(errors)],
      })
    }
  }

  const errorList = [...new Set(operations.flatMap((operation) => operation.errors))].toSorted().flatMap((name) => {
    const constant = structs.get(name)?.constants[0]
    return constant === undefined ? [] : [{ name, ...constant }]
  })
  const errorKey = errorList[0]?.key
  const mixed = errorList.find((error) => error.key !== errorKey)
  if (mixed !== undefined) {
    return yield* refused(
      at(schemasPath, mixed.name),
      `every error must be told apart by the same property; ${mixed.name} uses ${mixed.key}, not ${errorKey}`,
    )
  }

  const api: Api = {
    title,
    declarations: declarations.toSorted(byName),
    operations,
    errors: errorList,
    errorKey,
  }
  return api
})

// By name, in code point order, the same on every machine.
const byName = (left: { readonly name: string }, right: { readonly name: string }) =>
  left.name < right.name ? -1 : Number(left.name > right.name)

// A schema of a single value, such as a branded string or a bounded number: it names no Swift type.
const isPrimitive = (schema: JsonRecord) =>
  (schema["type"] === "string" && !isStrings(schema["enum"])) ||
  schema["type"] === "integer" ||
  schema["type"] === "number" ||
  schema["type"] === "boolean"
