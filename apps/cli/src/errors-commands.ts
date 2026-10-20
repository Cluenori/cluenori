import { ProjectKey, TraceId } from "@cluenori/foundation"
import type { LogLine, TraceLog, TraceView } from "@cluenori/signals"
import { ErrorGroupId, IndexedLevel } from "@cluenori/signals"
import { Console, DateTime, Effect, Option, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import type { ApiTarget } from "./api-settings.ts"
import { apiTarget } from "./api-settings.ts"
import { filters, headline, local, optionalKey, parsed, questionOf } from "./question.ts"
import { columns, count, milliseconds, utcClock, utcMinute, utcSecond } from "./terminal-text.ts"

const kept = "warnings and errors are kept 90 days"

const encodeJsonText = Schema.encodeEffect(Schema.fromJsonString(Schema.Json))

// An attribute as `key: value`, the value as JSON unless it is text.
const attributeLine = Effect.fn("attributeLine")(function* ([key, value]: readonly [string, Schema.Json]) {
  if (typeof value === "string") {
    return `  ${key}: ${value}`
  }
  const text = yield* encodeJsonText(value).pipe(Effect.orDie)
  return `  ${key}: ${text}`
})

// One log line as people scan it: when, how serious, where, and what.
const lineOf = (
  line: Pick<LogLine, "time" | "component" | "category" | "message" | "exception" | "trace"> & {
    readonly level?: LogLine["level"]
  },
) =>
  [
    `${utcSecond(line.time)}  ${(line.level ?? "?").toUpperCase().padEnd(5)}  ${line.component}  ${line.category}`,
    `  ${line.message}`,
    ...(line.exception === undefined ? [] : [`  ${line.exception.type}: ${line.exception.message}`]),
    ...(line.trace === undefined ? [] : [`  trace ${line.trace}`]),
  ].join("\n")

/** `cluenori errors <project>`. */
export const errors = Command.make("errors", filters, (input) =>
  Effect.gen(function* () {
    const { project, query, target } = yield* questionOf(input)
    const client = yield* apiClient(target)
    const table = yield* client.signals.errors({ params: { project }, query }).pipe(
      Effect.catchTags({
        ...reachFailures(target),
        ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
      }),
    )
    yield* Console.log(`${headline(project, target, table.covered, kept)}\n`)
    if (table.groups.length === 0) {
      return yield* Console.log(
        `No errors from ${project} in this period. Errors come from the error logs components send to ${target.url}/otlp/v1/logs.`,
      )
    }
    const lines = columns([
      ["Error", "Count", "Last seen", "ID"],
      ...table.groups.map((group) => [group.title, count(group.occurrences), utcMinute(group.lastSeen), group.id]),
    ])
    yield* Console.log(lines.join("\n"))
    yield* Console.log(`\n${count(table.occurrences)} errors in ${count(table.groups.length)} groups.`)
    yield* Console.log(`See one, with its stack and its request: ./cluenori error ${project} <ID>`)
  }),
).pipe(Command.withDescription("The errors of a period, most frequent first, grouped by what makes them the same."))

/** `cluenori error <project> <id>`. */
export const error = Command.make(
  "error",
  { ...filters, id: Argument.String("id").pipe(Argument.withDescription("The error's ID, from ./cluenori errors.")) },
  (input) =>
    Effect.gen(function* () {
      const { project, query, target } = yield* questionOf(input)
      const id = yield* parsed(ErrorGroupId, input.id, "an error's ID")
      const client = yield* apiClient(target)
      const detail = yield* client.signals.error({ params: { project, error: id }, query }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
          ErrorGroupNotFound: () =>
            refuse(
              `${project} has no error ${id} in this period. Try a longer one with --last 7d, or list them: ./cluenori errors ${project}`,
            ),
        }),
      )
      const { group } = detail
      const where = [group.lastComponent, group.lastEnvironment, group.lastRelease].filter((part) => part !== undefined)
      yield* Console.log(group.title)
      yield* Console.log(`  at ${group.culprit}`)
      yield* Console.log(
        `${count(group.occurrences)} times in this period; first seen ${utcMinute(group.firstSeen)}, last ${utcMinute(group.lastSeen)} in ${where.join(" ")}\n`,
      )
      const [latest, ...earlier] = detail.latest
      if (latest === undefined) {
        return
      }
      yield* Console.log(`Latest:\n${lineOf(latest)}`)
      if (latest.exception?.stack !== undefined) {
        yield* Console.log(`\n${latest.exception.stack}`)
      }
      const attributes = yield* Effect.forEach(Object.entries(latest.attributes), attributeLine)
      if (attributes.length > 0) {
        yield* Console.log(`\n${attributes.join("\n")}`)
      }
      if (latest.trace !== undefined) {
        yield* Console.log(
          `\nIts request, with its spans and logs: ./cluenori trace ${project} ${latest.trace} --at ${DateTime.formatIso(latest.time)}`,
        )
      }
      if (earlier.length > 0) {
        yield* Console.log(`\nEarlier: ${earlier.map((line) => utcSecond(line.time)).join(", ")}`)
      }
    }),
).pipe(Command.withDescription("One error: its stack, where and when it happens, and its latest occurrences."))

/** `cluenori logs <project>`. */
export const logs = Command.make(
  "logs",
  {
    ...filters,
    level: Flag.Literals("level", ["warn", "error", "fatal"]).pipe(
      Flag.withDefault("warn"),
      Flag.withDescription(
        "The lowest level to show. Records below warning are only in the archive: see ./cluenori trace.",
      ),
    ),
    search: Flag.String("search").pipe(Flag.optional, Flag.withDescription("Text in the message or the exception.")),
    category: Flag.String("category").pipe(
      Flag.optional,
      Flag.withDescription("Only this logger, such as Notes.Exports."),
    ),
    trace: Flag.String("trace").pipe(Flag.optional, Flag.withDescription("Only this request's trace ID.")),
    error: Flag.String("error").pipe(Flag.optional, Flag.withDescription("Only this error's ID.")),
    before: Flag.Int("before").pipe(
      Flag.optional,
      Flag.withDescription("Continue with older lines, from the last answer."),
    ),
  },
  (input) =>
    Effect.gen(function* () {
      const { project, query, target } = yield* questionOf(input)
      const trace = yield* optionalKey(TraceId, input.trace, "a trace ID")
      const errorId = yield* optionalKey(ErrorGroupId, input.error, "an error's ID")
      const level = yield* parsed(IndexedLevel, input.level, "a level")
      const client = yield* apiClient(target)
      const page = yield* client.signals
        .logs({
          params: { project },
          query: {
            ...query,
            level,
            ...Option.match(input.search, { onNone: () => ({}), onSome: (search) => ({ search }) }),
            ...Option.match(input.category, { onNone: () => ({}), onSome: (category) => ({ category }) }),
            ...Option.match(trace, { onNone: () => ({}), onSome: (value) => ({ trace: value }) }),
            ...Option.match(errorId, { onNone: () => ({}), onSome: (value) => ({ error: value }) }),
            ...Option.match(input.before, { onNone: () => ({}), onSome: (before) => ({ before }) }),
          },
        })
        .pipe(
          Effect.catchTags({
            ...reachFailures(target),
            ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
          }),
        )
      yield* Console.log(`${headline(project, target, page.covered, kept)}\n`)
      if (page.lines.length === 0) {
        return yield* Console.log("No warnings or errors match.")
      }
      yield* Console.log(page.lines.map(lineOf).join("\n\n"))
      if (page.next !== undefined) {
        yield* Console.log(`\nOlder ones: add --before ${page.next}`)
      }
    }),
).pipe(Command.withDescription("Warnings and errors, newest first, filtered by level, text, logger, trace, or error."))

const logLine = (log: TraceLog) =>
  [
    `${utcClock(log.time)}  ${(log.level ?? "?").toUpperCase().padEnd(5)}  ${log.category}  ${log.message}`,
    ...(log.exception === undefined ? [] : [`    ${log.exception.type}: ${log.exception.message}`]),
  ].join("\n")

const traceLines = (view: TraceView) => {
  const spans = columns(
    view.spans.map((span) => [
      `${"  ".repeat(span.depth)}${span.name}`,
      milliseconds(span.durationMs),
      span.failed ? "failed" : "",
      span.kind,
      span.component,
    ]),
  )
  return [...spans, ...(view.logs.length === 0 ? [] : ["", "Logs:", ...view.logs.map(logLine)])]
}

// When a trace happened: the time given, or that of a warning or error of it in the last 90 days;
// none when there is neither.
const timeOfTrace = Effect.fn("timeOfTrace")(function* (
  target: ApiTarget,
  project: ProjectKey,
  traceId: TraceId,
  given: Option.Option<DateTime.Utc>,
) {
  if (Option.isSome(given)) {
    return given
  }
  const client = yield* apiClient(target)
  const now = yield* DateTime.now
  const page = yield* client.signals
    .logs({ params: { project }, query: { from: DateTime.subtract(now, { days: 90 }), to: now, trace: traceId } })
    .pipe(
      Effect.catchTags({
        ...reachFailures(target),
        ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
      }),
    )
  return Option.fromNullishOr(page.lines[0]?.time)
})

/** `cluenori trace <project> <trace>`. */
export const trace = Command.make(
  "trace",
  {
    project: Argument.String("project").pipe(Argument.withDescription("The project's key.")),
    trace: Argument.String("trace").pipe(Argument.withDescription("The request's trace ID.")),
    at: Flag.String("at").pipe(
      Flag.optional,
      Flag.withDescription(
        "When it happened, ISO 8601, as ./cluenori error prints it. Without it, the time of a warning or error of the trace.",
      ),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const traceId = yield* parsed(TraceId, input.trace, "a trace ID")
      const given = yield* optionalKey(
        Schema.DateTimeUtcFromString,
        input.at,
        "a time in ISO 8601, such as 2026-10-20T12:55:01Z",
      )
      const target = yield* apiTarget(input.local)
      const looked = yield* timeOfTrace(target, project, traceId, given)
      if (Option.isNone(looked)) {
        const now = yield* DateTime.now
        return yield* refuse(
          `Cluenori finds a request in the archive by when it happened, and this one has no warning or error to say. Give the time with --at, such as --at ${DateTime.formatIso(now)}.`,
        )
      }
      const client = yield* apiClient(target)
      const view = yield* client.signals
        .trace({ params: { project, trace: traceId }, query: { around: looked.value } })
        .pipe(
          Effect.catchTags({
            ...reachFailures(target),
            ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
            ArchiveUnavailable: (unavailable) => refuse(`The archive can't be read right now: ${unavailable.message}`),
          }),
        )
      yield* Console.log(
        `Trace ${traceId}, looked for from ${utcSecond(view.searched.from)} to ${utcSecond(view.searched.to)} in ${count(view.files.read)} archive files\n`,
      )
      if (view.spans.length === 0 && view.logs.length === 0) {
        return yield* Console.log(
          "Nothing of this trace is in the archive at that time. It keeps every export 90 days; check the time.",
        )
      }
      yield* Console.log(traceLines(view).join("\n"))
      if (view.files.unread > 0) {
        yield* Console.log(
          `\n${count(view.files.unread)} more archive files from that time weren't read; give a more exact --at.`,
        )
      }
    }),
).pipe(Command.withDescription("One request from the archive: its spans as a tree, and its logs at every level."))
