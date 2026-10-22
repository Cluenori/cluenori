import { ComponentKey, EnvironmentKey, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import type { ReleaseNote } from "@cluenori/releases"
import { defaultNotesStyle, NoteLocale, NotesStyle, NoteText, ReleaseNotes } from "@cluenori/releases"
import { Console, Effect, FileSystem, Option, Schema } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import type { ApiTarget } from "./api-settings.ts"
import { apiTarget } from "./api-settings.ts"
import { local, parsed } from "./question.ts"
import { count } from "./terminal-text.ts"

// The release whose notes a command reads or writes, and where it asks.
interface NotesOf {
  readonly target: ApiTarget
  readonly project: ProjectKey
  readonly component: ComponentKey
  readonly release: ReleaseVersion
}

const paramsOf = (of: NotesOf) => ({ project: of.project, component: of.component, release: of.release })

// The command again, for the hints it prints.
const commandOf = (of: NotesOf) => `./cluenori notes ${of.project} ${of.component} ${of.release}`

const notesFailures = (of: NotesOf) => ({
  ...reachFailures(of.target),
  ProjectNotFound: () => refuse(`${of.target.url} has no project ${of.project}.`),
  ReleaseNotFound: () =>
    refuse(
      `${of.project} has no release ${of.release} of ${of.component}. ./cluenori releases ${of.project} lists those it has.`,
    ),
})

const languages = (notes: ReadonlyArray<ReleaseNote>) =>
  notes.length === 1 ? "in 1 language" : `in ${count(notes.length)} languages`

// Notes as blocks, one for each language: its locale, then its text, indented.
const noteBlocks = (notes: ReadonlyArray<ReleaseNote>) =>
  notes
    .map(
      (note) =>
        `${note.locale}:\n${note.text
          .split("\n")
          .map((line) => (line === "" ? "" : `  ${line}`))
          .join("\n")}`,
    )
    .join("\n\n")

// The notes saved for the release, which its detail carries.
const savedNotes = Effect.fn("savedNotes")(function* (of: NotesOf) {
  const client = yield* apiClient(of.target)
  const detail = yield* client.releases
    .release({ params: paramsOf(of), query: {} })
    .pipe(Effect.catchTags(notesFailures(of)))
  return detail.notes
})

const showNotes = Effect.fn("showNotes")(function* (of: NotesOf) {
  const notes = yield* savedNotes(of)
  if (notes.length === 0) {
    return yield* Console.log(
      `${of.release} of ${of.component} has no notes yet. Draft them for where it goes: ${commandOf(of)} --draft <environment>\nOr write one language: ${commandOf(of)} --locale en-US --text "<note>"`,
    )
  }
  yield* Console.log(`Notes of ${of.release} of ${of.component}, ${languages(notes)}:\n`)
  yield* Console.log(noteBlocks(notes))
  yield* Console.log(`\nChange one language: ${commandOf(of)} --locale <language> --file <file>`)
})

// Asks for a draft for `environment`, prints it, and saves it when asked.
const draftNotes = Effect.fn("draftNotes")(function* (of: NotesOf, environment: EnvironmentKey, save: boolean) {
  const client = yield* apiClient(of.target)
  const draft = yield* client.releases.draftNotes({ params: paramsOf(of), payload: { environment } }).pipe(
    Effect.catchTags({
      ...notesFailures(of),
      DraftUnavailable: (unavailable) => refuse(`No draft: ${unavailable.reason}`),
    }),
  )
  const commits = `${count(draft.commits)} ${draft.commits === 1 ? "commit" : "commits"}`
  const since =
    draft.since === undefined
      ? `${commits}, with no release in ${environment} before it`
      : `since ${draft.since}, ${commits}`
  yield* Console.log(`A draft for ${environment}, ${since}:\n`)
  yield* Console.log(noteBlocks(draft.notes))
  if (!save) {
    return yield* Console.log(
      `\nNothing is saved. Save it as it is with --save, or edit a language and save it: ${commandOf(of)} --locale <language> --file <file>`,
    )
  }
  const saved = yield* client.releases
    .saveNotes({ params: paramsOf(of), payload: { notes: draft.notes } })
    .pipe(Effect.catchTags(notesFailures(of)))
  yield* Console.log(`\nSaved as the notes of ${of.release}, ${languages(saved)}, in place of those it had.`)
})

// A note's text from --text, or from --file, `-` for standard input. A file's space at either end,
// such as the line break it ends with, is left out.
const noteTextOf = Effect.fn("noteTextOf")(function* (
  locale: NoteLocale,
  text: Option.Option<string>,
  file: Option.Option<string>,
) {
  if (Option.isSome(text) && Option.isSome(file)) {
    return yield* refuse("Give the note with --text or with --file, not both.")
  }
  if (Option.isSome(text)) {
    return yield* Schema.decodeEffect(NoteText)(text.value).pipe(
      Effect.catchTag("SchemaError", (error) => refuse(`The ${locale} note can't be saved: ${error.message}`)),
    )
  }
  if (Option.isNone(file)) {
    return yield* refuse(`Give the ${locale} note with --text "<note>", or --file <file>.`)
  }
  const fs = yield* FileSystem.FileSystem
  const fromStdin = file.value === "-"
  // Standard input is a file on macOS and Linux, where the CLI runs.
  const content = yield* fs
    .readFileString(fromStdin ? "/dev/stdin" : file.value)
    .pipe(
      Effect.catch((error) => refuse(`Couldn't read ${fromStdin ? "standard input" : file.value}: ${error.message}`)),
    )
  return yield* Schema.decodeEffect(NoteText)(content.trim()).pipe(
    Effect.catchTag("SchemaError", (error) => refuse(`The ${locale} note can't be saved: ${error.message}`)),
  )
})

// Saves one language's note, keeping the release's notes in others.
const writeNote = Effect.fn("writeNote")(function* (of: NotesOf, note: ReleaseNote) {
  const saved = yield* savedNotes(of)
  const replaces = saved.some((each) => each.locale === note.locale)
  const notes = replaces ? saved.map((each) => (each.locale === note.locale ? note : each)) : [...saved, note]
  const checked = yield* Schema.decodeEffect(ReleaseNotes)(notes).pipe(
    Effect.catchTag("SchemaError", (error) => refuse(`Those notes can't be saved: ${error.message}`)),
  )
  // Not handled: notes someone else saves between the read above and this write are replaced. The
  // API saves a release's notes whole; saving one language would take a route of its own.
  const client = yield* apiClient(of.target)
  const result = yield* client.releases
    .saveNotes({ params: paramsOf(of), payload: { notes: checked } })
    .pipe(Effect.catchTags(notesFailures(of)))
  yield* Console.log(
    `Saved the ${note.locale} note of ${of.release} of ${of.component}${replaces ? ", in place of the one it had" : ""}. Its notes are in ${result.map((each) => each.locale).join(", ")}.`,
  )
})

/**
 * `cluenori notes <project> <component> <release> [--draft <environment> [--save]]
 * [--locale <language> (--text <note> | --file <file>)]`.
 */
export const notes = Command.make(
  "notes",
  {
    project: Argument.String("project").pipe(Argument.withDescription("The project's key.")),
    component: Argument.String("component").pipe(Argument.withDescription("The component's key, such as notes-ios.")),
    release: Argument.String("release").pipe(
      Argument.withDescription("The release, as ./cluenori releases lists it, such as 1.4.0+58."),
    ),
    draft: Flag.String("draft").pipe(
      Flag.optional,
      Flag.withDescription(
        "Ask the project's language model for a draft for an environment, such as production: from the commits since the release current there, in the project's notes style, in each of its app's languages. Prints it, and saves nothing without --save.",
      ),
    ),
    save: Flag.Boolean("save").pipe(
      Flag.withDefault(false),
      Flag.withDescription("With --draft: save the draft as the release's notes, in place of those it has."),
    ),
    locale: Flag.String("locale").pipe(
      Flag.optional,
      Flag.withDescription(
        "The language of the note --text or --file gives, as App Store Connect names it, such as en-US. Its other languages' notes stay as they are.",
      ),
    ),
    text: Flag.String("text").pipe(Flag.optional, Flag.withDescription("The note, up to 4000 characters.")),
    file: Flag.String("file").pipe(
      Flag.optional,
      Flag.withDescription(
        "A file with the note, such as notes.txt, or - for standard input; space at its start and end is left out.",
      ),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const component = yield* parsed(ComponentKey, input.component, "a component key")
      const release = yield* parsed(ReleaseVersion, input.release, "a release")
      const target = yield* apiTarget(input.local)
      const of = { target, project, component, release }
      const writing = Option.isSome(input.locale) || Option.isSome(input.text) || Option.isSome(input.file)
      if (Option.isSome(input.draft)) {
        if (writing) {
          return yield* refuse(
            "--draft writes every language at once: leave out --locale, --text and --file, or write one language without --draft.",
          )
        }
        const environment = yield* parsed(EnvironmentKey, input.draft.value, "an environment key")
        return yield* draftNotes(of, environment, input.save)
      }
      if (input.save) {
        return yield* refuse(
          "--save saves a draft: give --draft <environment> too. One language is saved with --locale and --text or --file.",
        )
      }
      if (!writing) {
        return yield* showNotes(of)
      }
      if (Option.isNone(input.locale)) {
        return yield* refuse("Say which language the note is in, such as --locale en-US.")
      }
      const locale = yield* parsed(NoteLocale, input.locale.value, "a language")
      const text = yield* noteTextOf(locale, input.text, input.file)
      return yield* writeNote(of, { locale, text })
    }),
).pipe(
  Command.withDescription(
    "A release's notes for its users, one for each language: its What's New on the App Store, and What to Test in TestFlight. Show them, have the project's language model draft them, or write one language.",
  ),
)

/** `cluenori notes-style <project> [--set <text>]`. */
export const notesStyle = Command.make(
  "notes-style",
  {
    project: Argument.String("project").pipe(Argument.withDescription("The project's key.")),
    set: Flag.String("set").pipe(
      Flag.optional,
      Flag.withDescription("How its release notes read, in your own words: up to 2000 characters."),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const project = yield* parsed(ProjectKey, input.project, "a project key")
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const failures = {
        ...reachFailures(target),
        ProjectNotFound: () => refuse(`${target.url} has no project ${project}.`),
      }
      if (Option.isSome(input.set)) {
        const style = yield* Schema.decodeEffect(NotesStyle)({ style: input.set.value }).pipe(
          Effect.catchTag("SchemaError", (error) => refuse(`That notes style can't be set: ${error.message}`)),
        )
        const set = yield* client.releases
          .setNotesStyle({ params: { project }, payload: style })
          .pipe(Effect.catchTags(failures))
        return yield* Console.log(
          `Set how ${project}'s release notes read; drafts follow it from now on:\n\n  ${set.style}`,
        )
      }
      const current = yield* client.releases.notesStyle({ params: { project } }).pipe(Effect.catchTags(failures))
      const whose = current.style === defaultNotesStyle ? " (Cluenori's default, until you set one)" : ""
      yield* Console.log(`How ${project}'s release notes read, which drafts follow${whose}:\n\n  ${current.style}`)
      yield* Console.log(`\nChange it: ./cluenori notes-style ${project} --set "<how they read>"`)
    }),
).pipe(
  Command.withDescription(
    "Show or set how a project's release notes read, in its own words, which the language model's drafts follow.",
  ),
)
