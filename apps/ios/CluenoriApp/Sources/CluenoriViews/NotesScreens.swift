import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

// A release's notes for its users, and how a project's notes read, which drafts follow.

/// A release's notes for its users, one editor for each language, up to 4000 characters each: its
/// What's New on the App Store, or What to Test in TestFlight. Draft with AI fills them, unsaved,
/// for the environment chosen; Save replaces the release's notes. The edits stay while the app
/// runs, until saved or discarded.
struct NotesScreen: View {
    let release: ReleaseModel
    @State private var isAddingLanguage = false
    @State private var newLanguage = ""
    @State private var languageProblem: NotesModel.LanguageProblem? = nil
    @Environment(\.locale) private var locale

    var body: some View {
        @Bindable var notes = release.notes
        Form {
            if release.detail.value == nil {
                AnswerPlaceholder(problem: release.detail.problem)
            } else {
                Section {
                    DraftControls(notes: notes)
                } footer: {
                    Text(
                        "A draft is written from the commits since the release current there, in the project's notes style. Nothing is saved until you save.",
                        bundle: #bundle,
                        comment: "Below the button that drafts release notes with AI."
                    )
                }
                if notes.notes.isEmpty {
                    Section {
                        Text(
                            "No notes yet. Draft them, or add a language and write them.",
                            bundle: #bundle,
                            comment: "A release without notes, in its notes editor."
                        )
                        .foregroundStyle(.secondary)
                    }
                }
                ForEach($notes.notes) { $note in
                    Section {
                        TextField(text: $note.text, axis: .vertical) {
                            Text("Note", bundle: #bundle, comment: "The field for a release's note in one language.")
                        }
                        .lineLimit(4...24)
                        .disabled(notes.activity != nil)
                    } header: {
                        Text(verbatim: languageName(note.locale))
                    } footer: {
                        NoteLength(count: note.text.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count)
                    }
                }
                Section {
                    Button {
                        newLanguage = ""
                        isAddingLanguage = true
                    } label: {
                        Label {
                            Text("Add a Language", bundle: #bundle, comment: "Adds a language to write a note in.")
                        } icon: {
                            Image(systemName: "plus.circle")
                        }
                    }
                    .disabled(notes.activity != nil)
                    if notes.hasChanges {
                        Button(role: .destructive) {
                            notes.discardChanges()
                        } label: {
                            Text("Discard Changes", bundle: #bundle, comment: "Lets a release's unsaved notes go.")
                        }
                        .disabled(notes.activity != nil)
                    }
                } footer: {
                    Text(
                        "A language whose note is empty has none once saved.",
                        bundle: #bundle,
                        comment: "Below the release notes' languages."
                    )
                }
                if let problem = notes.saveProblem {
                    Section {
                        NotesProblemView(problem: problem, saving: true)
                    }
                }
            }
        }
        .navigationTitle(Text("Release Notes", bundle: #bundle, comment: "Title of a release's notes editor."))
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    Task { await notes.save() }
                } label: {
                    if notes.activity == .saving {
                        ProgressView()
                            .accessibilityLabel(
                                Text("Saving", bundle: #bundle, comment: "The save button while it saves."))
                    } else {
                        Text("Save", bundle: #bundle, comment: "Saves edits.")
                    }
                }
                .disabled(!notes.canSave)
            }
        }
        .alert(
            Text("Add a Language", bundle: #bundle, comment: "Title of the prompt for a language to write a note in."),
            isPresented: $isAddingLanguage
        ) {
            TextField(text: $newLanguage, prompt: Text(verbatim: "de-DE")) {
                Text("Language", bundle: #bundle, comment: "The field for a language's code.")
            }
            .autocorrectionDisabled()
            #if os(iOS)
                .textInputAutocapitalization(.never)
            #endif
            Button {
                do throws(NotesModel.LanguageProblem) {
                    try notes.addLanguage(newLanguage)
                } catch {
                    languageProblem = error
                }
            } label: {
                Text("Add", bundle: #bundle, comment: "Adds the language typed.")
            }
            Button(role: .cancel) {
            } label: {
                Text("Cancel", bundle: #bundle, comment: "Closes a prompt without acting.")
            }
        } message: {
            Text(
                "As App Store Connect names it, such as en-US, de-DE or ja.",
                bundle: #bundle,
                comment: "How to type a language's code. App Store Connect is a name; the codes are as is."
            )
        }
        .alert(
            String(localized: "Can't add it", bundle: #bundle, comment: "Title when a language can't be added."),
            item: $languageProblem
        ) { _ in
            Button(role: .close) {}
        } message: { problem in
            switch problem {
            case .notALanguage:
                Text(
                    "That isn't a language as App Store Connect names one, such as en-US, de-DE or ja.",
                    bundle: #bundle,
                    comment: "A language's code that isn't one."
                )
            case .alreadyAdded:
                Text("It has a note already.", bundle: #bundle, comment: "A language added twice.")
            case .tooMany:
                Text(
                    "A release has notes in at most 40 languages.",
                    bundle: #bundle,
                    comment: "Too many languages for a release's notes."
                )
            }
        }
        .refreshable { await release.refresh() }
        .task { await release.refresh() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: release.detail.problem, receivedAt: release.detail.receivedAt)
        }
    }

    // A language's name, as this phone's language says it, with its code: `German (Germany) · de-DE`.
    private func languageName(_ code: String) -> String {
        guard let name = locale.localizedString(forIdentifier: code) else { return code }
        return "\(name) · \(code)"
    }
}

/// Drafting a release's notes with AI: the environment to draft for, when there are several, the
/// button, what the last draft was written from, and why it wasn't.
struct DraftControls: View {
    @Bindable var notes: NotesModel

    var body: some View {
        let environments = notes.draftEnvironments
        if environments.count > 1 {
            Picker(selection: $notes.draftEnvironment) {
                ForEach(environments, id: \.self) { environment in
                    Text(verbatim: environment).tag(Optional(environment))
                }
            } label: {
                Text("Draft for", bundle: #bundle, comment: "The picker of the environment notes are drafted for.")
            }
            .disabled(notes.activity != nil)
        }
        Button {
            Task { await notes.draft() }
        } label: {
            if notes.activity == .drafting {
                HStack(spacing: 12) {
                    ProgressView()
                    Text("Drafting…", bundle: #bundle, comment: "While release notes are drafted.")
                }
            } else {
                Label {
                    Text("Draft with AI", bundle: #bundle, comment: "Asks for a draft of a release's notes. AI as is.")
                } icon: {
                    Image(systemName: "sparkles")
                }
            }
        }
        .disabled(notes.activity != nil || notes.draftEnvironment == nil)
        if let drafted = notes.drafted {
            // Its plural forms are in the string catalog: inflection takes "commit" for a verb.
            let commits = Text(
                "\(drafted.commits) commits",
                bundle: #bundle,
                comment: "How many commits a release has since the one before. The variable is a count."
            )
            Group {
                if let since = drafted.since {
                    Text(
                        "Drafted from \(commits) since \(Text(verbatim: since).monospaced()). Read it before you save.",
                        bundle: #bundle,
                        comment: "What a draft was written from. The variables are a count of commits and a release."
                    )
                } else {
                    Text(
                        "Drafted from \(commits). Read it before you save.",
                        bundle: #bundle,
                        comment: "What a draft was written from, with no release before it. The variable is a count."
                    )
                }
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        if let problem = notes.draftProblem {
            NotesProblemView(problem: problem, saving: false)
        }
    }
}

/// A note's length against App Store Connect's limit: `312 of 4,000`, in red past it.
struct NoteLength: View {
    let count: Int

    var body: some View {
        if count > NotesModel.textLimit {
            Text(
                "^[\(count - NotesModel.textLimit) character](inflect: true) too long: a note has at most \(NotesModel.textLimit).",
                bundle: #bundle,
                comment: "Below a note that is too long. The variables are counts of characters."
            )
            .foregroundStyle(.red)
        } else {
            Text(
                "\(count) of \(NotesModel.textLimit)",
                bundle: #bundle,
                comment: "A note's length against its limit. The variables are counts of characters."
            )
            .monospacedDigit()
        }
    }
}

/// Why notes, or a notes style, weren't drafted or saved, in words.
struct NotesProblemView: View {
    let problem: NotesProblem
    /// Whether saving failed, rather than drafting.
    let saving: Bool

    var body: some View {
        Label {
            switch problem {
            case .draftUnavailable(let reason):
                Text(
                    "No draft: \(reason)",
                    bundle: #bundle,
                    comment: "Why no draft of release notes was written. The variable is the deployment's reason."
                )
            case .unreachable:
                if saving {
                    Text(
                        "Offline. Not saved: your edits stay here, so save again once online.",
                        bundle: #bundle,
                        comment: "Notes couldn't be saved: the deployment didn't answer."
                    )
                } else {
                    Text(
                        "Offline. No draft: try again once online.",
                        bundle: #bundle,
                        comment: "Notes couldn't be drafted: the deployment didn't answer."
                    )
                }
            case .missing:
                Text(
                    "Cluenori doesn't know this release any more.",
                    bundle: #bundle,
                    comment: "Notes couldn't be drafted or saved: the release or its project is gone."
                )
            case .unreadable:
                Text(
                    "Cluenori answered in a way this version doesn't understand. Update the app.",
                    bundle: #bundle,
                    comment: "The deployment's answer couldn't be read."
                )
            }
        } icon: {
            Image(systemName: problem == .unreachable ? "wifi.exclamationmark" : "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
        }
    }
}

/// How the project's release notes read, in its own words, which drafts follow: up to 2000
/// characters, shown, edited, and saved.
struct NotesStyleScreen: View {
    @Bindable var style: NotesStyleModel

    var body: some View {
        Form {
            if style.style.value == nil && !style.hasChanges {
                AnswerPlaceholder(problem: style.style.problem)
            } else {
                Section {
                    TextField(text: $style.text, axis: .vertical) {
                        Text("Style", bundle: #bundle, comment: "The field for how a project's release notes read.")
                    }
                    .lineLimit(6...30)
                    .disabled(style.isSaving)
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(
                            "Drafts of release notes follow it: their tone, their length, and what they leave out.",
                            bundle: #bundle,
                            comment: "What a project's notes style is for."
                        )
                        let count = style.text.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count
                        if style.excess > 0 {
                            Text(
                                "^[\(style.excess) character](inflect: true) too long: a style has at most \(NotesStyleModel.limit).",
                                bundle: #bundle,
                                comment: "Below a notes style that is too long. The variables are counts of characters."
                            )
                            .foregroundStyle(.red)
                        } else {
                            Text(
                                "\(count) of \(NotesStyleModel.limit)",
                                bundle: #bundle,
                                comment: "A notes style's length against its limit. The variables are counts."
                            )
                            .monospacedDigit()
                        }
                    }
                }
                if let problem = style.saveProblem {
                    Section {
                        NotesProblemView(problem: problem, saving: true)
                    }
                }
                if style.hasChanges {
                    Section {
                        Button(role: .destructive) {
                            style.discardChanges()
                        } label: {
                            Text("Discard Changes", bundle: #bundle, comment: "Lets an unsaved notes style go.")
                        }
                        .disabled(style.isSaving)
                    }
                }
            }
        }
        .navigationTitle(Text("Notes Style", bundle: #bundle, comment: "Title of a project's release notes style."))
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    Task { await style.save() }
                } label: {
                    if style.isSaving {
                        ProgressView()
                            .accessibilityLabel(
                                Text("Saving", bundle: #bundle, comment: "The save button while it saves."))
                    } else {
                        Text("Save", bundle: #bundle, comment: "Saves edits.")
                    }
                }
                .disabled(!style.canSave)
            }
        }
        .refreshable { await style.load() }
        .task { await style.load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: style.style.problem, receivedAt: style.style.receivedAt)
        }
    }
}
