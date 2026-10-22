import CluenoriClient
import CluenoriScreens
import Foundation
import Testing

let notesPath = "/api/projects/notes/releases/notes-api/2026.10.21-e91f09c/notes"
let savedNotes = #"{"locale":"en-US","text":"Faster feed."},{"locale":"de-DE","text":"Schnellerer Feed."}"#

/// A draft in English, which the release has, and French, which it hasn't, from 12 commits.
let draftAnswer = #"""
    {"notes":[{"locale":"en-US","text":"The feed loads twice as fast."},
      {"locale":"fr-FR","text":"Le fil se charge deux fois plus vite."}],
    "since":"2026.10.20-a1b2c3d","commits":12}
    """#

/// The notes saved, as `notes` decodes them from the last request to save them.
func sentNotes(_ deployment: FakeDeployment) throws -> [ReleaseNote] {
    struct Sent: Decodable { let notes: [ReleaseNote] }
    return try JSONDecoder().decode(Sent.self, from: try #require(deployment.bodies("PUT \(notesPath)").last)).notes
}

struct NotesTests {
    @Test func `drafts notes for the App Store target into the editors, unsaved, saying what it was drafted from`()
        async throws
    {
        let (release, deployment) = try await promotedRelease("", targets: appTargets, notes: savedNotes)
        deployment.answer("POST \(notesPath)/draft", 200, draftAnswer)
        let notes = release.notes
        #expect(notes.draftEnvironments == ["internal", "production", "beta"])
        // The App Store's target, unless another is chosen.
        #expect(notes.draftEnvironment == "production")

        await notes.draft()

        let sent = try #require(deployment.bodies("POST \(notesPath)/draft").first)
        #expect(try JSONDecoder().decode([String: String].self, from: sent) == ["environment": "production"])
        #expect(
            notes.notes == [
                .init(locale: "en-US", text: "The feed loads twice as fast."),
                .init(locale: "de-DE", text: "Schnellerer Feed."),
                .init(locale: "fr-FR", text: "Le fil se charge deux fois plus vite."),
            ])
        #expect(notes.drafted == NotesModel.Drafted(commits: 12, since: "2026.10.20-a1b2c3d"))
        #expect(notes.hasChanges)
        // Nothing saved: the release's notes are as they were.
        #expect(notes.savedNotes.map(\.text) == ["Faster feed.", "Schnellerer Feed."])
        #expect(!deployment.requests.contains("PUT \(notesPath)"))
    }

    @Test func `drafts for the environment chosen`() async throws {
        let (release, deployment) = try await promotedRelease("", targets: appTargets)
        deployment.answer("POST \(notesPath)/draft", 200, draftAnswer)

        release.notes.draftEnvironment = "internal"
        await release.notes.draft()

        let sent = try #require(deployment.bodies("POST \(notesPath)/draft").first)
        #expect(try JSONDecoder().decode([String: String].self, from: sent) == ["environment": "internal"])
    }

    @Test func `saves the edits, trimmed, leaving out a language whose note is empty`() async throws {
        let (release, deployment) = try await promotedRelease("", targets: appTargets, notes: savedNotes)
        let answer = #"[{"locale":"en-US","text":"Faster feed, and offline drafts."},{"locale":"ja","text":"高速化。"}]"#
        deployment.answer("PUT \(notesPath)", 200, answer)
        let notes = release.notes

        notes.notes[0].text = "  Faster feed, and offline drafts.\n"
        notes.notes[1].text = " "
        try notes.addLanguage("ja")
        notes.notes[2].text = "高速化。"
        #expect(notes.canSave)
        await notes.save()

        #expect(
            try sentNotes(deployment) == [
                ReleaseNote(locale: "en-US", text: "Faster feed, and offline drafts."),
                ReleaseNote(locale: "ja", text: "高速化。"),
            ])
        #expect(!notes.hasChanges)
        #expect(notes.savedNotes.map(\.locale) == ["en-US", "ja"])
        #expect(notes.notes.map(\.locale) == ["en-US", "ja"])
        #expect(notes.saveProblem == nil)
    }

    @Test func `says why no draft was written, keeping the edits`() async throws {
        let (release, deployment) = try await promotedRelease("", targets: appTargets, notes: savedNotes)
        let reason = "The commits since 2026.10.20-a1b2c3d aren't known yet."
        deployment.answer("POST \(notesPath)/draft", 503, #"{"_tag":"DraftUnavailable","reason":"\#(reason)"}"#)
        let notes = release.notes
        notes.notes[0].text = "Mine."

        await notes.draft()

        #expect(notes.draftProblem == .draftUnavailable(reason: reason))
        #expect(notes.notes[0].text == "Mine.")
        #expect(notes.drafted == nil)
        #expect(notes.activity == nil)
    }

    @Test func `keeps the edits when the phone is offline, to save again once online`() async throws {
        let (release, deployment) = try await promotedRelease("", targets: appTargets, notes: savedNotes)
        let notes = release.notes
        notes.notes[0].text = "Faster feed, and offline drafts."
        deployment.setOffline(true)

        await notes.save()
        await notes.draft()

        #expect(notes.saveProblem == .unreachable)
        #expect(notes.draftProblem == .unreachable)
        #expect(notes.hasChanges)
        #expect(notes.notes[0].text == "Faster feed, and offline drafts.")
    }

    @Test func `can't save a note past 4000 characters, as App Store Connect counts them`() async throws {
        let (release, deployment) = try await promotedRelease("", targets: appTargets, notes: savedNotes)
        let notes = release.notes

        notes.notes[0].text = String(repeating: "a", count: 4000)
        #expect(notes.excess(notes.notes[0]) == 0 && notes.canSave)
        notes.notes[0].text = String(repeating: "a", count: 3999) + "🚀"
        #expect(notes.excess(notes.notes[0]) == 1 && !notes.canSave)

        await notes.save()
        #expect(!deployment.requests.contains("PUT \(notesPath)"))
    }

    @Test func `adds only a language as App Store Connect names one, once`() async throws {
        let (release, _) = try await promotedRelease("", targets: appTargets, notes: savedNotes)
        let notes = release.notes

        #expect(throws: NotesModel.LanguageProblem.notALanguage) { try notes.addLanguage("German") }
        // As App Store Connect names them: its region in upper case, its script capitalized.
        #expect(throws: NotesModel.LanguageProblem.notALanguage) { try notes.addLanguage("en-us") }
        #expect(throws: NotesModel.LanguageProblem.notALanguage) { try notes.addLanguage("zh-hans") }
        try notes.addLanguage("es-419")
        #expect(throws: NotesModel.LanguageProblem.alreadyAdded) { try notes.addLanguage("de-DE") }
        try notes.addLanguage(" zh-Hans ")
        #expect(notes.notes.map(\.locale) == ["en-US", "de-DE", "es-419", "zh-Hans"])
        // An empty language alone changes nothing saved.
        #expect(!notes.hasChanges)

        notes.discardChanges()
        #expect(notes.notes.map(\.locale) == ["en-US", "de-DE"])
    }
}

struct NotesStyleTests {
    @Test func `shows the project's notes style, and saves an edit`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/notes-style", 200, #"{"style":"Short and plain."}"#)
        deployment.answer("PUT /api/projects/notes/notes-style", 200, #"{"style":"Short, plain, and warm."}"#)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let style = try #require(pairing.models).notesStyle("notes")

        await style.load()
        #expect(style.text == "Short and plain.")
        #expect(!style.canSave)

        style.text = "Short, plain, and warm.  "
        #expect(style.hasChanges && style.canSave)
        await style.save()

        let sent = try #require(deployment.bodies("PUT /api/projects/notes/notes-style").first)
        #expect(try JSONDecoder().decode([String: String].self, from: sent) == ["style": "Short, plain, and warm."])
        #expect(style.style.value?.style == "Short, plain, and warm.")
        #expect(!style.hasChanges)
    }

    @Test func `keeps an edited style when the phone is offline, and saves nothing empty`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/notes-style", 200, #"{"style":"Short and plain."}"#)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let style = try #require(pairing.models).notesStyle("notes")
        await style.load()

        style.text = "  "
        #expect(!style.canSave)

        style.text = "Warmer."
        deployment.setOffline(true)
        await style.save()

        #expect(style.saveProblem == .unreachable)
        #expect(style.text == "Warmer.")
    }
}
