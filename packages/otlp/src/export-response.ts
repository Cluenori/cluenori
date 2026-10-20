// Every runtime this package runs on has it; declared here only, as in protobuf-reader.ts.
declare const TextEncoder: new () => { readonly encode: (input: string) => Uint8Array }

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

const lengthDelimited = (field: number, content: ArrayLike<number>): Array<number> => [
  ...varint(field * 8 + 2),
  ...varint(content.length),
  ...Array.from(content),
]

/** The Content-Type of OTLP/HTTP protobuf requests and responses. */
export const protobufContentType = "application/x-protobuf"

/**
 * The body of an answer to an OTLP export: an `Export<Signal>ServiceResponse` as protobuf, which has
 * the same shape for traces, logs, and metrics. Without `rejected` it says everything was accepted;
 * with it, how many items were refused and why, which exporters log and don't retry.
 */
export const exportResponse = (rejected?: { readonly count: number; readonly message: string }): Uint8Array => {
  if (rejected === undefined) {
    return new Uint8Array(0)
  }
  // ExportPartialSuccess: int64 rejected_<items> = 1; string error_message = 2.
  const partialSuccess = [...varint(8), ...varint(rejected.count), ...lengthDelimited(2, utf8.encode(rejected.message))]
  return Uint8Array.from(lengthDelimited(1, partialSuccess))
}
