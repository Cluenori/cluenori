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

const attribute = (key: string, value: string) =>
  bytesField(1, [...textField(1, key), ...bytesField(2, textField(1, value))])

/** One span of an export: a server span is a request; a client span is not. */
export interface ExportedSpan {
  readonly name: string
  readonly kind: "server" | "client"
  readonly startMillis: number
  readonly durationMillis: number
  readonly failed?: boolean
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
      ...bytesField(1, hexBytes(position.padStart(32, "0"))),
      ...bytesField(2, hexBytes(position.padStart(16, "0"))),
      ...textField(5, span.name),
      ...varintField(6, kinds[span.kind]),
      ...fixed64Field(7, start),
      ...fixed64Field(8, end),
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
