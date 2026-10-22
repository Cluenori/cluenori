import { ComponentKey, EnvironmentKey, ReleaseVersion } from "@cluenori/foundation"
import { Schema } from "effect"

/**
 * A language a store shows text in, as App Store Connect names it: a lowercase language, then a
 * script in title case, a region in capitals, or both: `en-US`, `de-DE`, `zh-Hans`, `ja`.
 */
export const NoteLocale = Schema.String.check(
  Schema.isMaxLength(35),
  Schema.isPattern(/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?$/, {
    expected: "a language as App Store Connect names it, such as en-US, de-DE, zh-Hans or ja",
  }),
).pipe(Schema.brand("NoteLocale"))
export type NoteLocale = typeof NoteLocale.Type

/** What a release tells its users, in one language: up to 4000 characters, as App Store Connect takes. */
export const NoteText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4000), Schema.isTrimmed()).pipe(
  Schema.brand("NoteText"),
)
export type NoteText = typeof NoteText.Type

/**
 * A release's note for its users in one language: an app's What's New on the App Store, or What to
 * Test in TestFlight.
 */
export const ReleaseNote = Schema.Struct({ locale: NoteLocale, text: NoteText }).annotate({ identifier: "ReleaseNote" })
export type ReleaseNote = typeof ReleaseNote.Type

/** Notes in at most 40 languages, one each. */
export const ReleaseNotes = Schema.Array(ReleaseNote).check(
  Schema.isMaxLength(40),
  Schema.makeFilter(
    (notes: ReadonlyArray<ReleaseNote>) => new Set(notes.map((note) => note.locale)).size === notes.length,
    { expected: "one note for each language" },
  ),
)

/** Save a release's notes, replacing those it had: in each language given, and none in others. */
export const SaveNotes = Schema.Struct({
  component: ComponentKey,
  release: ReleaseVersion,
  notes: ReleaseNotes,
}).annotate({ identifier: "SaveNotes" })
export type SaveNotes = typeof SaveNotes.Type

/** Draft a release's notes for where it goes: what changed since the release current in `environment`. */
export const DraftNotes = Schema.Struct({
  component: ComponentKey,
  release: ReleaseVersion,
  environment: EnvironmentKey,
}).annotate({ identifier: "DraftNotes" })
export type DraftNotes = typeof DraftNotes.Type

/**
 * A draft of a release's notes, for a person to edit and save: one for each language of the app it
 * goes to, or English; written from the commits since `since`, the release current there.
 */
export const NotesDraft = Schema.Struct({
  notes: ReleaseNotes,
  since: Schema.optionalKey(ReleaseVersion),
  commits: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "NotesDraft" })
export type NotesDraft = typeof NotesDraft.Type

/** How the project's release notes read, in its own words, for drafts to follow: up to 2000 characters. */
export const NotesStyle = Schema.Struct({
  style: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000), Schema.isTrimmed()),
}).annotate({ identifier: "NotesStyle" })
export type NotesStyle = typeof NotesStyle.Type

/** No draft was written, for the reason given: the commits aren't known yet, or the model didn't answer. */
export class DraftUnavailable extends Schema.TaggedError<DraftUnavailable>()("DraftUnavailable", {
  reason: Schema.String,
}) {}
