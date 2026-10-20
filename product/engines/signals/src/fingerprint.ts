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

/** A frame of a stack, as people read it, and whether it is the app's own code. */
interface Frame {
  readonly name: string
  readonly own: boolean
}

// A frame of the app's own code says where it is in the source, as .NET writes it (`at Notes.Invites.Send()
// in /src/Invites.cs:line 48`); the framework's and libraries' don't, as they ship without their sources.
// Not handled: a library built with its sources embedded, whose frames say where too (`in /_/src/...`);
// telling them apart would take the app's own paths or namespaces.
const ownFrame = (line: string) => /\s+in\s+\S/.test(line)

const framesOf = (stack: string): ReadonlyArray<Frame> => {
  const lines = stack.split("\n").map((line) => line.trim())
  const pythonFrames = lines.flatMap((line) => {
    const match = python.exec(line)
    return match === null ? [] : [{ name: `${match[1] ?? ""}:${match[2] ?? ""}`, own: false }]
  })
  // Python lists the innermost frame last; .NET, Java, and JavaScript first.
  if (pythonFrames.length > 0) {
    return pythonFrames.toReversed()
  }
  return lines
    .filter((line) => line.startsWith("at "))
    .map((line) => ({ name: readableFrame(line), own: ownFrame(line) }))
}

// Values that differ between occurrences of one message: UUIDs, hex IDs, and numbers.
const withoutValues = (message: string) =>
  message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\b[0-9a-f]{12,}\b/gi, "<id>")
    .replace(/\d+/g, "#")

// A message the app wrote also holds its values in quotes.
const normalizedMessage = (message: string) => withoutValues(message.replace(/"[^"]*"|'[^']*'/g, "<text>"))

const firstLine = (text: string) => text.split("\n")[0]?.trim() ?? ""

// A title fits a list: its first 200 characters. The whole message stays with each occurrence.
const shortened = (text: string) => (text.length > 200 ? `${text.slice(0, 199)}…` : text)

/**
 * How an error record is grouped. One with an exception groups by the exception's type and the top
 * five frames of the app's own code in its stack: the framework's frames around them vary with async
 * paths and versions, so they count only in a stack without any of the app's own. When the exception
 * was thrown outside the app's code, its message, without numbers and IDs, counts too. Its culprit
 * is the top frame of its own code, where the error left it. An exception without a stack groups by
 * its normalized message; a record without one, by its logger and its message template, or
 * normalized message.
 */
export const errorShapeOf = (record: {
  readonly category: string
  readonly message: string
  readonly template?: string
  readonly exception?: LogException
}): ErrorShape => {
  const { exception } = record
  if (exception !== undefined) {
    const frames = exception.stack === undefined ? [] : framesOf(exception.stack)
    const own = frames.filter((frame) => frame.own)
    const compared = (own.length > 0 ? own : frames).slice(0, 5).map((frame) => comparableFrame(frame.name))
    // Thrown in shared code, such as the framework's request binding, different errors pass through
    // the same frames of the app's; the message, without its values, tells them apart.
    const thrownElsewhere = own.length > 0 && frames[0]?.own === false
    const said = thrownElsewhere ? [withoutValues(firstLine(exception.message))] : []
    const detail = compared.length > 0 ? [...compared, ...said].join("\n") : normalizedMessage(exception.message)
    return {
      kind: "exception",
      fingerprint: ["exception", exception.type, detail].join("\n"),
      title: shortened(`${exception.type}: ${firstLine(exception.message)}`),
      culprit: own[0]?.name ?? frames[0]?.name ?? record.category,
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
