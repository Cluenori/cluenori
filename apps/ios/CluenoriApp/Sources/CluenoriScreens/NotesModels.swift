import CluenoriClient
import Foundation
import Observation

/// Why release notes, or the project's notes style, weren't drafted or saved.
public enum NotesProblem: Equatable, Sendable {
    /// No draft was written, for the deployment's reason: the commits aren't known yet, or GitHub or
    /// the language model didn't answer.
    case draftUnavailable(reason: String)
    /// The deployment didn't answer, as when the phone is offline. Nothing is kept to send later.
    case unreachable
    /// The deployment no longer knows the release, or its project.
    case missing
    /// The deployment answered in a way this app doesn't understand.
    case unreadable

    static func of(_ error: APIError) -> NotesProblem {
        switch error {
        case .draftUnavailable(let unavailable): .draftUnavailable(reason: unavailable.reason)
        case .unreachable: .unreachable
        case .projectNotFound, .releaseNotFound: .missing
        default: .unreadable
        }
    }
}

/// A release's notes for its users, one for each language, as its notes screen edits them: its
/// What's New on the App Store, or What to Test in TestFlight. The edits are kept while the app
/// runs, until saved or discarded; a draft the deployment's language model writes fills them,
/// unsaved, for a person to edit. Saving replaces every note the release had, leaving out the
/// languages whose text is empty.
@Observable
public final class NotesModel {
    /// One language's note as edited; an empty text is left out when saved.
    public struct Note: Equatable, Sendable, Identifiable {
        /// As App Store Connect names it: `en-US`, `de-DE`, `ja`.
        public let locale: String
        public var text: String

        public init(locale: String, text: String) {
            self.locale = locale
            self.text = text
        }

        public var id: String {
            locale
        }
    }

    /// What the last draft was written from: how many commits, since which release.
    public struct Drafted: Equatable, Sendable {
        public let commits: Int
        /// The release current in the environment it was drafted for; nil when none was.
        public let since: String?

        public init(commits: Int, since: String?) {
            self.commits = commits
            self.since = since
        }
    }

    /// What the notes are being asked for, one at a time.
    public enum Activity: Equatable, Sendable {
        case drafting
        case saving
    }

    /// Why a language can't be added.
    public enum LanguageProblem: Error, Equatable, Sendable {
        /// Not a language as App Store Connect names one, such as `en-US`, `zh-Hans` or `ja`: its
        /// language in lower case, then its script, then its region in upper case or digits.
        case notALanguage
        case alreadyAdded
        /// A release has notes in at most 40 languages.
        case tooMany
    }

    /// The most characters a note may have, as App Store Connect and the deployment count them
    /// (UTF-16 code units).
    public static let textLimit = 4000
    public static let languageLimit = 40

    public let release: ReleaseRef
    public private(set) var activity: Activity? = nil
    public private(set) var draftProblem: NotesProblem? = nil
    public private(set) var saveProblem: NotesProblem? = nil
    /// What the draft in the edits was written from; nil once saved or discarded.
    public private(set) var drafted: Drafted? = nil

    // The notes as edited; nil while unedited, showing those saved.
    private var edits: [Note]? = nil
    // The notes the last save answered with, and when; shown until the release is asked again.
    private var saved: (notes: [ReleaseNote], at: Date)? = nil
    // The environment chosen to draft for; nil for the default.
    private var chosenEnvironment: String? = nil
    @ObservationIgnored private let detail: Answer<ReleaseDetail>
    @ObservationIgnored private let api: CluenoriAPI
    @ObservationIgnored private let keyRejected: () -> Void

    /// `detail` is the release's, which says its notes and where it can go.
    init(release: ReleaseRef, detail: Answer<ReleaseDetail>, api: CluenoriAPI, keyRejected: @escaping () -> Void) {
        self.release = release
        self.detail = detail
        self.api = api
        self.keyRejected = keyRejected
    }

    /// The notes the deployment has for the release: the last save's answer, until the release is
    /// asked again; empty until the release arrives.
    // Not handled: a release asked before a save and answered after it shows the notes from
    // before, until asked again.
    public var savedNotes: [ReleaseNote] {
        if let saved, (detail.receivedAt ?? .distantPast) <= saved.at {
            return saved.notes
        }
        return detail.value?.notes ?? []
    }

    /// The notes as edited, one for each language: those saved until edited.
    public var notes: [Note] {
        get { edits ?? savedNotes.map { Note(locale: $0.locale, text: $0.text) } }
        set { edits = newValue }
    }

    /// Whether the edits differ from the notes saved, as saving them would.
    public var hasChanges: Bool {
        guard let edits else { return false }
        return Self.sendable(edits) != savedNotes
    }

    /// How many characters `note`'s text, trimmed, has past `textLimit`; 0 when it fits.
    public func excess(_ note: Note) -> Int {
        max(note.text.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count - Self.textLimit, 0)
    }

    /// Whether `save` saves: edits that fit, while nothing else is asked.
    public var canSave: Bool {
        activity == nil && hasChanges && notes.allSatisfy { excess($0) == 0 }
    }

    /// The environments a draft can be written for, each of the component's deploy targets; or the
    /// release's own environment for a component without any.
    public var draftEnvironments: [String] {
        let targets = detail.value?.deployTargets ?? []
        guard targets.isEmpty else { return targets.map(\.environment) }
        return release.environment.map { [$0] } ?? []
    }

    /// The environment a draft is written for, whose current release it starts after: the one
    /// chosen, else the target that goes to App Store review, else one with an app, else the first.
    public var draftEnvironment: String? {
        get {
            let environments = draftEnvironments
            if let chosenEnvironment, environments.contains(chosenEnvironment) {
                return chosenEnvironment
            }
            let targets = detail.value?.deployTargets ?? []
            return targets.first { $0.appStore?.distribution == .appStore }?.environment
                ?? targets.first { $0.appStore != nil }?.environment
                ?? environments.first
        }
        set { chosenEnvironment = newValue }
    }

    /// Adds a language to write a note in, `de-DE`, with an empty text. Fails when it isn't a
    /// language as App Store Connect names one, has a note already, or would be the 41st.
    public func addLanguage(_ code: String) throws(LanguageProblem) {
        let locale = code.trimmingCharacters(in: .whitespaces)
        guard locale.wholeMatch(of: /[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?/) != nil else {
            throw .notALanguage
        }
        var notes = notes
        guard !notes.contains(where: { $0.locale == locale }) else { throw .alreadyAdded }
        guard notes.count < Self.languageLimit else { throw .tooMany }
        notes.append(Note(locale: locale, text: ""))
        edits = notes
    }

    /// Asks the deployment's language model for a draft for `draftEnvironment`: from the commits
    /// since the release current there, in the project's notes style. It fills the edits, unsaved:
    /// each language it wrote replaces that language's text, and adds those not there yet.
    public func draft() async {
        guard activity == nil, let environment = draftEnvironment else { return }
        activity = .drafting
        draftProblem = nil
        defer { activity = nil }
        do {
            let draft = try await api.draftNotes(
                project: release.project, component: release.component, release: release.version,
                DraftFor(environment: environment))
            var notes = notes
            for drafted in draft.notes {
                if let index = notes.firstIndex(where: { $0.locale == drafted.locale }) {
                    notes[index].text = drafted.text
                } else {
                    notes.append(Note(locale: drafted.locale, text: drafted.text))
                }
            }
            edits = notes
            drafted = Drafted(commits: draft.commits, since: draft.since)
        } catch .unauthorized {
            keyRejected()
        } catch {
            draftProblem = .of(error)
        }
    }

    /// Saves the edits as the release's notes, replacing those it had; a language whose text is
    /// empty has none. Does nothing unless `canSave`.
    public func save() async {
        guard canSave else { return }
        activity = .saving
        saveProblem = nil
        defer { activity = nil }
        do {
            let answer = try await api.saveNotes(
                project: release.project, component: release.component, release: release.version,
                NotesOf(notes: Self.sendable(notes)))
            saved = (answer, .now)
            edits = nil
            drafted = nil
        } catch .unauthorized {
            keyRejected()
        } catch {
            saveProblem = .of(error)
        }
    }

    /// Lets the edits go, showing the notes saved.
    public func discardChanges() {
        edits = nil
        drafted = nil
        draftProblem = nil
        saveProblem = nil
    }

    // The notes as saving sends them: trimmed, without the empty ones.
    private static func sendable(_ notes: [Note]) -> [ReleaseNote] {
        notes.compactMap { note in
            let text = note.text.trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty ? nil : ReleaseNote(locale: note.locale, text: text)
        }
    }
}

/// How the project's release notes read, in its own words, which drafts follow: shown, edited, and
/// saved. Until the project sets one, the deployment answers with Cluenori's default.
@Observable
public final class NotesStyleModel {
    /// The most characters a style may have, as the deployment counts them (UTF-16 code units).
    public static let limit = 2000

    public let project: String
    public let style: Answer<NotesStyle>
    public private(set) var isSaving = false
    public private(set) var saveProblem: NotesProblem? = nil

    // The style as edited; nil while unedited.
    private var edit: String? = nil
    @ObservationIgnored private let api: CluenoriAPI
    @ObservationIgnored private let keyRejected: () -> Void

    init(project: String, api: CluenoriAPI, context: AnswerContext) {
        self.project = project
        self.api = api
        keyRejected = context.keyRejected
        style = Answer(
            context,
            .init(key: "projects/\(project)/notes-style") { () async throws(APIError) in
                try await api.notesStyle(project: project)
            })
    }

    /// The style as edited: the project's until edited; empty until it arrives.
    public var text: String {
        get { edit ?? style.value?.style ?? "" }
        set { edit = newValue }
    }

    public var hasChanges: Bool {
        guard let edit else { return false }
        return trimmed(edit) != style.value?.style
    }

    /// How many characters the style, trimmed, has past `limit`; 0 when it fits.
    public var excess: Int {
        max(trimmed(text).utf16.count - Self.limit, 0)
    }

    /// Whether `save` saves: a changed style, not empty, that fits, while not saving already.
    public var canSave: Bool {
        !isSaving && hasChanges && excess == 0 && !trimmed(text).isEmpty
    }

    /// Asks for the project's style again.
    public func load() async {
        await style.load()
    }

    /// Saves the edited style, trimmed, for the project's next drafts. Does nothing unless `canSave`.
    public func save() async {
        guard canSave else { return }
        isSaving = true
        saveProblem = nil
        defer { isSaving = false }
        do {
            let saved = try await api.setNotesStyle(project: project, NotesStyle(style: trimmed(text)))
            style.show(saved)
            edit = nil
        } catch .unauthorized {
            keyRejected()
        } catch {
            saveProblem = .of(error)
        }
    }

    /// Lets the edit go, showing the project's style.
    public func discardChanges() {
        edit = nil
        saveProblem = nil
    }

    private func trimmed(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
