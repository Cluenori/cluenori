import type { LogException } from "./log-entry.ts"

/** What makes errors the same error, before hashing, and how to name them to a person. */
export interface ErrorShape {
  /** `exception` when grouped by type and stack, `log` when by logger and message. */
  readonly kind: "exception" | "log"
  /** Hashed into the group's ID. */
  readonly fingerprint: string
  readonly title: string
  /** Where it happens: the top frame of the stack, or the logger. */
  readonly culprit: string
}

// A frame as people read it: the method, without the file and line.
const readableFrame = (line: string) =>
  line
    .replace(/^at\s+/, "")
    .replace(/\s+in\s+.*$/, "")
    .replace(/\s*\([^()]*:\d+(?::\d+)?\)$/, "")
    .trim()

// Frames are compared also without the numbers compilers put in generated names (`<Main>b__0`,
// `d__5`), so the same code throws the same error after a rebuild.
const comparableFrame = (frame: string) => frame.replace(/\d+/g, "#")

const python = /^File "(?:.*[/\\])?([^/\\"]+)", line \d+, in (.+)$/

const framesOf = (stack: string): ReadonlyArray<string> => {
  const lines = stack.split("\n").map((line) => line.trim())
  const pythonFrames = lines.flatMap((line) => {
    const match = python.exec(line)
    return match === null ? [] : [`${match[1] ?? ""}:${match[2] ?? ""}`]
  })
  // Python lists the innermost frame last; .NET, Java, and JavaScript first.
  if (pythonFrames.length > 0) {
    return pythonFrames.toReversed()
  }
  return lines.filter((line) => line.startsWith("at ")).map(readableFrame)
}

// Values that differ between occurrences of one message: numbers, hex IDs, UUIDs, quoted text.
const normalizedMessage = (message: string) =>
  message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/"[^"]*"|'[^']*'/g, "<text>")
    .replace(/\b[0-9a-f]{12,}\b/gi, "<id>")
    .replace(/\d+/g, "#")

const firstLine = (text: string) => text.split("\n")[0]?.trim() ?? ""

// A title fits a list: its first 200 characters. The whole message stays with each occurrence.
const shortened = (text: string) => (text.length > 200 ? `${text.slice(0, 199)}…` : text)

/**
 * How an error record is grouped. One with an exception groups by the exception's type and the top
 * five frames of its stack, or its normalized message when there is no stack; one without groups by
 * its logger and its message template, or normalized message.
 */
export const errorShapeOf = (record: {
  readonly category: string
  readonly message: string
  readonly template?: string
  readonly exception?: LogException
}): ErrorShape => {
  const { exception } = record
  if (exception !== undefined) {
    const frames = exception.stack === undefined ? [] : framesOf(exception.stack).slice(0, 5)
    const detail = frames.length > 0 ? frames.map(comparableFrame).join("\n") : normalizedMessage(exception.message)
    return {
      kind: "exception",
      fingerprint: ["exception", exception.type, detail].join("\n"),
      title: shortened(`${exception.type}: ${firstLine(exception.message)}`),
      culprit: frames[0] ?? record.category,
    }
  }
  const message = record.template ?? normalizedMessage(record.message)
  return {
    kind: "log",
    fingerprint: ["log", record.category, message].join("\n"),
    title: shortened(firstLine(record.template ?? record.message)),
    culprit: record.category,
  }
}
