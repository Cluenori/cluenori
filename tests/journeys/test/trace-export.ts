// Builds OTLP/HTTP protobuf trace exports shaped like the ones .NET services send (see
// packages/otlp's captured fixtures), with times the journey chooses.

const utf8 = new TextEncoder()

const varint = (value: number): Array<number> => {
  const bytes: Array<number> = []
  let rest = value
  while (rest >= 0x80) {
    bytes.push((rest % 0x80) + 0x80)
    rest = Math.floor(rest / 0x80)
  }
  bytes.push(rest)
  return bytes
}

const bytesField = (field: number, content: ArrayLike<number>) => [
  ...varint(field * 8 + 2),
  ...varint(content.length),
  ...Array.from(content),
]

const textField = (field: number, value: string) => bytesField(field, utf8.encode(value))

const varintField = (field: number, value: number) => [...varint(field * 8), ...varint(value)]

const fixed64Field = (field: number, value: bigint) => {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, value, true)
  return [...varint(field * 8 + 1), ...bytes]
}

const hexBytes = (hex: string) =>
  Array.from({ length: hex.length / 2 }, (_, at) => Number.parseInt(hex.slice(at * 2, at * 2 + 2), 16))

// KeyValue { key = 1; value = 2 { string_value = 1 } }, in field `field` of its message.
const keyValue = (field: number, key: string, value: string) =>
  bytesField(field, [...textField(1, key), ...bytesField(2, textField(1, value))])

const attribute = (key: string, value: string) => keyValue(1, key, value)

/**
 * One span of an export: a server span is a run; a client span is not. With `trace`, its trace
 * ID; with `status`, the HTTP status it answered with.
 */
export interface ExportedSpan {
  readonly name: string
  readonly kind: "server" | "client"
  readonly startMillis: number
  readonly durationMillis: number
  readonly failed?: boolean
  readonly trace?: string
  readonly parent?: number
  readonly status?: number
}

const kinds = { server: 2, client: 3 } as const

/** A trace export of one service, with its spans in order; IDs come from their position. */
export const traceExport = (
  service: { readonly name: string; readonly environment: string },
  spans: ReadonlyArray<ExportedSpan>,
) => {
  const encodedSpans = spans.flatMap((span, index) => {
    const start = BigInt(span.startMillis) * 1_000_000n
    const end = start + BigInt(Math.round(span.durationMillis * 1_000_000))
    const position = (index + 1).toString(16)
    return bytesField(2, [
      ...bytesField(1, hexBytes(span.trace ?? position.padStart(32, "0"))),
      ...bytesField(2, hexBytes(position.padStart(16, "0"))),
      ...(span.parent === undefined ? [] : bytesField(4, hexBytes((span.parent + 1).toString(16).padStart(16, "0")))),
      ...textField(5, span.name),
      ...varintField(6, kinds[span.kind]),
      ...fixed64Field(7, start),
      ...fixed64Field(8, end),
      // KeyValue { key = 1; value = 2 { int_value = 3 } }, in the span's attributes, field 9.
      ...(span.status === undefined
        ? []
        : bytesField(9, [...textField(1, "http.response.status_code"), ...bytesField(2, varintField(3, span.status))])),
      ...(span.failed === true ? bytesField(15, varintField(3, 2)) : []),
    ])
  })
  const resource = bytesField(1, [
    ...attribute("deployment.environment.name", service.environment),
    ...attribute("service.name", service.name),
  ])
  const scopeSpans = bytesField(2, [...bytesField(1, textField(1, "Microsoft.AspNetCore")), ...encodedSpans])
  return Uint8Array.from(bytesField(1, [...resource, ...scopeSpans]))
}

/** One log record of an export, at OTLP's severity: 9 info, 13 warn, 17 error. */
export interface ExportedLog {
  readonly timeMillis: number
  readonly severity: number
  readonly category: string
  readonly message: string
  readonly trace?: string
  readonly exception?: { readonly type: string; readonly message: string; readonly stack: string }
}

/** A log export of one service, as a .NET service sends one. */
export const logExport = (
  service: { readonly name: string; readonly environment: string },
  logs: ReadonlyArray<ExportedLog>,
) => {
  const byCategory = Map.groupBy(logs, (log) => log.category)
  const scopes = Array.from(byCategory, ([category, records]) =>
    bytesField(2, [
      ...bytesField(1, textField(1, category)),
      ...records.flatMap((log) =>
        bytesField(2, [
          ...fixed64Field(1, BigInt(log.timeMillis) * 1_000_000n),
          ...varintField(2, log.severity),
          ...bytesField(5, textField(1, log.message)),
          ...(log.exception === undefined
            ? []
            : [
                ...keyValue(6, "exception.type", log.exception.type),
                ...keyValue(6, "exception.message", log.exception.message),
                ...keyValue(6, "exception.stacktrace", log.exception.stack),
              ]),
          ...(log.trace === undefined ? [] : bytesField(9, hexBytes(log.trace))),
        ]),
      ),
    ]),
  )
  const resource = bytesField(1, [
    ...attribute("deployment.environment.name", service.environment),
    ...attribute("service.name", service.name),
  ])
  return Uint8Array.from(bytesField(1, [...resource, ...scopes.flat()]))
}
