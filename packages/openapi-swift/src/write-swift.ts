import type { Api, Declaration, Operation, Parameter, ValueType } from "./read-document.ts"
import { camelCase, docComment, pascalCase, stringLiteral, swiftName } from "./swift-names.ts"

// Swift source from what the generator read: the names it writes were checked before.

const name = (text: string) => swiftName(text) ?? text

// A declaration's first line, `head(parameters)tail`, its parameters one to a line when it would be
// longer than 100 characters.
const signature = (indent: string, head: string, parameters: ReadonlyArray<string>, tail: string) => {
  const line = `${indent}${head}(${parameters.join(", ")})${tail}`
  return line.length <= 100 || parameters.length === 0
    ? line
    : [`${indent}${head}(`, ...parameters.map((parameter) => `${indent}    ${parameter},`), `${indent})${tail}`].join(
        "\n",
      )
}

const swiftType = (type: ValueType): string => {
  switch (type._tag) {
    case "String":
    case "Date":
    case "Int":
    case "Double":
    case "Bool":
      return type._tag
    case "Json":
      return "JSONValue"
    case "Array":
      return `[${swiftType(type.of)}]`
    case "Dictionary":
      return `[String: ${swiftType(type.of)}]`
    case "Named":
      return type.name
  }
}

/** The client's type: the document's title and `API`, `CluenoriAPI`. */
export const clientName = (api: Api) => `${pascalCase(api.title)}API`

/** The case of a union or of `APIError` for a constant value: `down`, `phoneNotFound`. */
export const caseName = (value: string) => camelCase(value)

const writeStruct = (declaration: Extract<Declaration, { readonly _tag: "Struct" }>) => {
  const fields = declaration.properties.map((property) => ({
    name: name(property.key),
    type: `${swiftType(property.type)}${property.required ? "" : "?"}`,
    required: property.required,
  }))
  const parameters = fields.map((field) => `${field.name}: ${field.type}${field.required ? "" : " = nil"}`)
  return [
    `public struct ${declaration.name}: Codable, Hashable, Sendable {`,
    ...fields.map((field) => `    public let ${field.name}: ${field.type}`),
    ...(fields.length > 0 ? [""] : []),
    signature("    ", "public init", parameters, " {"),
    ...fields.map((field) => `        self.${field.name} = ${field.name}`),
    "    }",
    "}",
  ].join("\n")
}

const writeEnum = (declaration: Extract<Declaration, { readonly _tag: "Enum" }>) =>
  [
    `/// One of a set of values; a value this client doesn't know, from a newer API, is kept as it is.`,
    `public struct ${declaration.name}: RawRepresentable, Codable, Hashable, Sendable {`,
    "    public let rawValue: String",
    "",
    "    public init(rawValue: String) {",
    "        self.rawValue = rawValue",
    "    }",
    "",
    ...declaration.values.map(
      (value) => `    public static let ${name(value)} = ${declaration.name}(rawValue: ${stringLiteral(value)})`,
    ),
    "}",
  ].join("\n")

const writeUnion = (declaration: Extract<Declaration, { readonly _tag: "Union" }>) =>
  [
    docComment(
      `One of several kinds, told apart by \`${declaration.discriminator}\`. A kind this client doesn't know, from a newer API, is \`unknown\`, with its name.`,
      "",
    ),
    `public enum ${declaration.name}: Codable, Hashable, Sendable {`,
    ...declaration.cases.map((entry) => `    case ${name(caseName(entry.value))}(${entry.type})`),
    "    case unknown(String)",
    "",
    "    private enum Kind: String, CodingKey {",
    `        case kind = ${stringLiteral(declaration.discriminator)}`,
    "    }",
    "",
    "    public init(from decoder: any Decoder) throws {",
    "        let kind = try decoder.container(keyedBy: Kind.self).decode(String.self, forKey: .kind)",
    "        switch kind {",
    ...declaration.cases.map(
      (entry) =>
        `        case ${stringLiteral(entry.value)}: self = .${name(caseName(entry.value))}(try ${entry.type}(from: decoder))`,
    ),
    "        default: self = .unknown(kind)",
    "        }",
    "    }",
    "",
    "    public func encode(to encoder: any Encoder) throws {",
    "        switch self {",
    ...declaration.cases.flatMap((entry) => [
      `        case .${name(caseName(entry.value))}(let value):`,
      "            try value.encode(to: encoder)",
      "            var container = encoder.container(keyedBy: Kind.self)",
      `            try container.encode(${stringLiteral(entry.value)}, forKey: .kind)`,
    ]),
    "        case .unknown(let kind):",
    "            var container = encoder.container(keyedBy: Kind.self)",
    "            try container.encode(kind, forKey: .kind)",
    "        }",
    "    }",
    "}",
  ].join("\n")

const writeDeclaration = (declaration: Declaration) => {
  switch (declaration._tag) {
    case "Struct":
      return writeStruct(declaration)
    case "Enum":
      return writeEnum(declaration)
    case "Union":
      return writeUnion(declaration)
  }
}

const writeErrors = (api: Api) =>
  [
    "/// Why a call failed: an error the API answered with, no answer at all, or one this client can't read.",
    "public enum APIError: Error, Sendable {",
    ...api.errors.map((error) => `    case ${name(caseName(error.name))}(${error.name})`),
    "    /// The server didn't answer: no connection, a timeout, or a cancelled call.",
    "    case unreachable(URLError)",
    "    /// An answer this client can't read, such as a status or a shape from a newer API, and why.",
    "    case unreadable(status: Int, reason: String)",
    "    /// The request couldn't be written, such as a number that isn't finite.",
    "    case unwritable(reason: String)",
    "}",
  ].join("\n")

// A parameter's value as the text a path or query holds.
const textOf = (parameter: Parameter) => `Self.text(${name(parameter.name)})`

const writeOperation = (operation: Operation) => {
  const query = operation.queryParameters.toSorted((left, right) => Number(right.required) - Number(left.required))
  const parameters = [
    ...operation.pathParameters.map((parameter) => `${name(parameter.name)}: ${swiftType(parameter.type)}`),
    ...(operation.body === undefined ? [] : [`_ body: ${operation.body}`]),
    ...query.map(
      (parameter) => `${name(parameter.name)}: ${swiftType(parameter.type)}${parameter.required ? "" : "? = nil"}`,
    ),
  ]
  const path = operation.pathParameters.reduce(
    (built, parameter) => built.replace(`{${parameter.name}}`, `\\(Self.escaped(${textOf(parameter)}))`),
    operation.path,
  )
  const errors = operation.errors.map((error) => `\`.${caseName(error)}\``)
  const documentation = [
    ...(operation.description === undefined ? [] : [operation.description]),
    errors.length === 0 ? undefined : `Fails with ${errors.join(", ")}, or as any call can.`,
  ].filter((paragraph) => paragraph !== undefined)
  const result = operation.result === undefined ? "" : ` -> ${swiftType(operation.result)}`
  const send = [
    `"${operation.method}"`,
    stringLiteral(path).replaceAll("\\\\(", "\\("),
    ...(query.length === 0 ? [] : ["query: query"]),
    ...(operation.body === undefined ? [] : ["body: try Self.encoded(body)"]),
  ].join(", ")
  return [
    ...(documentation.length === 0 ? [] : [docComment(documentation.join("\n\n"), "    ")]),
    "    @concurrent",
    signature("    ", `public func ${operation.name}`, parameters, ` async throws(APIError)${result} {`),
    ...(query.length === 0 ? [] : ["        var query: [(String, String)] = []"]),
    ...query.map((parameter) =>
      parameter.required
        ? `        query.append((${stringLiteral(parameter.name)}, ${textOf(parameter)}))`
        : `        if let ${name(parameter.name)} { query.append((${stringLiteral(parameter.name)}, ${textOf(parameter)})) }`,
    ),
    operation.result === undefined
      ? `        _ = try await self.send(${send})`
      : `        let answer = try await self.send(${send})`,
    ...(operation.result === undefined
      ? []
      : [`        return try Self.decoded(${swiftType(operation.result)}.self, from: answer)`]),
    "    }",
  ].join("\n")
}

const writeClient = (api: Api) => {
  const client = clientName(api)
  return [
    `/// A client of the ${api.title} API: one method per operation, each one request. Every method runs off`,
    "/// the caller's actor, and fails with `APIError`.",
    `public struct ${client}: Sendable {`,
    "    /// Sends a request and returns its answer.",
    "    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, URLResponse)",
    "",
    "    /// Where the API is: each operation's path is added to it.",
    "    public let baseURL: URL",
    "    /// Sent as `Authorization: Bearer <token>` with every request, when set.",
    "    public let bearerToken: String?",
    "    /// Sent as every request's `User-Agent`, when set.",
    "    public let userAgent: String?",
    "    private let transport: Transport",
    "",
    "    /// A client of the API at `baseURL`, sending with `transport`, or `URLSession.shared` when it is nil.",
    "    public init(baseURL: URL, bearerToken: String? = nil, userAgent: String? = nil, transport: Transport? = nil) {",
    "        self.baseURL = baseURL",
    "        self.bearerToken = bearerToken",
    "        self.userAgent = userAgent",
    "        self.transport = transport ?? { request in try await URLSession.shared.data(for: request) }",
    "    }",
    "",
    api.operations.map(writeOperation).join("\n\n"),
    "}",
  ].join("\n")
}

const writeFailure = (api: Api) => [
  "    private static func failure(status: Int, data: Data) -> APIError {",
  ...(api.errorKey === undefined
    ? ['        .unreadable(status: status, reason: "The API names no errors.")']
    : [
        "        struct Named: Decodable {",
        "            let error: String",
        `            enum CodingKeys: String, CodingKey { case error = ${stringLiteral(api.errorKey)} }`,
        "        }",
        "        guard let named = try? jsonDecoder().decode(Named.self, from: data) else {",
        '            return .unreadable(status: status, reason: "The answer names no error.")',
        "        }",
        "        do {",
        "            switch named.error {",
        ...api.errors.map(
          (error) =>
            `            case ${stringLiteral(error.value)}: return .${name(caseName(error.name))}(try jsonDecoder().decode(${error.name}.self, from: data))`,
        ),
        '            default: return .unreadable(status: status, reason: "An error this client doesn\'t know: \\(named.error).")',
        "            }",
        "        } catch {",
        '            return .unreadable(status: status, reason: "\\(error)")',
        "        }",
      ]),
  "    }",
]

// How every method sends, reads, and writes: one request, JSON both ways, ISO 8601 dates.
const writeSupport = (api: Api) =>
  [
    `extension ${clientName(api)} {`,
    "    private struct Answer {",
    "        let data: Data",
    "        let status: Int",
    "    }",
    "",
    "    private func send(_ method: String, _ path: String, query: [(String, String)] = [], body: Data? = nil) async throws(APIError) -> Answer {",
    "        var address = baseURL.absoluteString",
    '        if address.hasSuffix("/") { address.removeLast() }',
    "        address += path",
    "        if !query.isEmpty {",
    '            address += "?" + query.map { "\\(Self.escaped($0.0))=\\(Self.escaped($0.1))" }.joined(separator: "&")',
    "        }",
    "        guard let url = URL(string: address) else {",
    '            throw .unwritable(reason: "\\(address) isn\'t a URL.")',
    "        }",
    "        var request = URLRequest(url: url)",
    "        request.httpMethod = method",
    '        request.setValue("application/json", forHTTPHeaderField: "Accept")',
    '        if let bearerToken { request.setValue("Bearer \\(bearerToken)", forHTTPHeaderField: "Authorization") }',
    '        if let userAgent { request.setValue(userAgent, forHTTPHeaderField: "User-Agent") }',
    "        if let body {",
    "            request.httpBody = body",
    '            request.setValue("application/json", forHTTPHeaderField: "Content-Type")',
    "        }",
    "        let data: Data",
    "        let response: URLResponse",
    "        do {",
    "            (data, response) = try await transport(request)",
    "        } catch let error as URLError {",
    "            throw .unreachable(error)",
    "        } catch {",
    "            throw .unreachable(URLError(error is CancellationError ? .cancelled : .unknown))",
    "        }",
    "        let status = (response as? HTTPURLResponse)?.statusCode ?? 0",
    "        guard (200..<300).contains(status) else {",
    "            throw Self.failure(status: status, data: data)",
    "        }",
    "        return Answer(data: data, status: status)",
    "    }",
    "",
    ...writeFailure(api),
    "",
    "    private static func decoded<Value: Decodable>(_ type: Value.Type, from answer: Answer) throws(APIError) -> Value {",
    "        do {",
    "            return try jsonDecoder().decode(type, from: answer.data)",
    "        } catch {",
    '            throw .unreadable(status: answer.status, reason: "\\(error)")',
    "        }",
    "    }",
    "",
    "    private static func encoded(_ value: some Encodable) throws(APIError) -> Data {",
    "        do {",
    "            return try jsonEncoder().encode(value)",
    "        } catch {",
    '            throw .unwritable(reason: "\\(error)")',
    "        }",
    "    }",
    "",
    "    private static let instant = Date.ISO8601FormatStyle(includingFractionalSeconds: true)",
    "    private static let instantInSeconds = Date.ISO8601FormatStyle()",
    "",
    "    private static func jsonDecoder() -> JSONDecoder {",
    "        let decoder = JSONDecoder()",
    "        decoder.dateDecodingStrategy = .custom { decoder in",
    "            let container = try decoder.singleValueContainer()",
    "            let text = try container.decode(String.self)",
    "            if let date = (try? instant.parse(text)) ?? (try? instantInSeconds.parse(text)) { return date }",
    '            throw DecodingError.dataCorruptedError(in: container, debugDescription: "\\(text) isn\'t an ISO 8601 date-time.")',
    "        }",
    "        return decoder",
    "    }",
    "",
    "    private static func jsonEncoder() -> JSONEncoder {",
    "        let encoder = JSONEncoder()",
    "        encoder.dateEncodingStrategy = .custom { date, encoder in",
    "            var container = encoder.singleValueContainer()",
    "            try container.encode(date.formatted(instant))",
    "        }",
    "        return encoder",
    "    }",
    "",
    '    private static let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")',
    "",
    "    private static func escaped(_ text: String) -> String {",
    "        text.addingPercentEncoding(withAllowedCharacters: unreserved) ?? text",
    "    }",
    "",
    "    private static func text(_ value: String) -> String { value }",
    "    private static func text(_ value: Date) -> String { value.formatted(instant) }",
    "    private static func text(_ value: Int) -> String { String(value) }",
    "    private static func text(_ value: Double) -> String { String(value) }",
    '    private static func text(_ value: Bool) -> String { value ? "true" : "false" }',
    "    private static func text<Value: RawRepresentable>(_ value: Value) -> String where Value.RawValue == String {",
    "        value.rawValue",
    "    }",
    "}",
  ].join("\n")

const jsonValue = [
  "/// A value of any JSON shape, as the API sends free-form data.",
  "public enum JSONValue: Codable, Hashable, Sendable {",
  "    case null",
  "    case bool(Bool)",
  "    case number(Double)",
  "    case string(String)",
  "    case array([JSONValue])",
  "    case object([String: JSONValue])",
  "",
  "    public init(from decoder: any Decoder) throws {",
  "        let container = try decoder.singleValueContainer()",
  "        if container.decodeNil() {",
  "            self = .null",
  "        } else if let value = try? container.decode(Bool.self) {",
  "            self = .bool(value)",
  "        } else if let value = try? container.decode(Double.self) {",
  "            self = .number(value)",
  "        } else if let value = try? container.decode(String.self) {",
  "            self = .string(value)",
  "        } else if let value = try? container.decode([JSONValue].self) {",
  "            self = .array(value)",
  "        } else {",
  "            self = .object(try container.decode([String: JSONValue].self))",
  "        }",
  "    }",
  "",
  "    public func encode(to encoder: any Encoder) throws {",
  "        var container = encoder.singleValueContainer()",
  "        switch self {",
  "        case .null: try container.encodeNil()",
  "        case .bool(let value): try container.encode(value)",
  "        case .number(let value): try container.encode(value)",
  "        case .string(let value): try container.encode(value)",
  "        case .array(let value): try container.encode(value)",
  "        case .object(let value): try container.encode(value)",
  "        }",
  "    }",
  "}",
].join("\n")

/** The whole Swift file for `api`. */
export const writeSwift = (api: Api) =>
  [
    "import Foundation\n#if canImport(FoundationNetworking)\nimport FoundationNetworking\n#endif",
    writeClient(api),
    writeErrors(api),
    ...api.declarations.map(writeDeclaration),
    jsonValue,
    writeSupport(api),
  ].join("\n\n") + "\n"
