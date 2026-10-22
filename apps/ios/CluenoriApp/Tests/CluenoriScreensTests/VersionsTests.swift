import CluenoriClient
import CluenoriScreens
import Foundation
import Testing

/// The notes project with two components: an API whose version is set, and an app whose isn't.
let componentsAnswer = #"""
    {"project":{"key":"notes","name":"Notes","createdAt":"2026-10-01T10:00:00.000Z"},
    "components":[{"key":"notes-api","name":"Notes API","createdAt":"2026-10-01T10:00:00.000Z"},
      {"key":"notes-ios","name":"Notes for iOS","createdAt":"2026-10-02T10:00:00.000Z"}]}
    """#
let versionsAnswer = #"""
    {"versions":[{"component":"notes-api","version":"1.4.0","lastBuild":57,"setAt":"2026-10-20T10:00:00.000Z"}]}
    """#

/// The notes project's versions, with its components asked for, as its screens do.
func notesVersions() async throws -> (VersionsModel, FakeDeployment) {
    let deployment = FakeDeployment()
    deployment.answer("GET /api/projects/notes", 200, componentsAnswer)
    deployment.answer("GET /api/projects/notes/versions", 200, versionsAnswer)
    let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
    let models = try #require(pairing.models)
    await models.environments("notes").refresh()
    let versions = models.versions("notes")
    await versions.load()
    return (versions, deployment)
}

struct VersionsTests {
    @Test(arguments: [
        ("1.4.2", VersionBump.patch, "1.4.3"),
        ("1.4.2", .minor, "1.5.0"),
        ("1.4.2", .major, "2.0.0"),
        ("0.9.9", .patch, "0.9.10"),
        ("0.0.0", .major, "1.0.0"),
    ])
    func `bumps a version's patch, minor, or major`(_ version: String, _ bump: VersionBump, _ next: String) {
        #expect(VersionsModel.next(after: version, bump) == next)
    }

    @Test func `can't bump past 999999, nor what isn't MAJOR.MINOR.PATCH`() {
        #expect(VersionsModel.next(after: "1.4.999999", .patch) == nil)
        #expect(VersionsModel.next(after: "1.4", .patch) == nil)
        #expect(VersionsModel.next(after: "01.4.0", .minor) == nil)
        #expect(VersionsModel.next(after: "1.٤.0", .minor) == nil)
    }

    @Test func `shows each component's version and next release, and those without one`() async throws {
        let (versions, _) = try await notesVersions()

        #expect(
            versions.lines == [
                VersionLine(component: "notes-api", name: "Notes API", version: "1.4.0", lastBuild: 57),
                VersionLine(component: "notes-ios", name: "Notes for iOS", version: nil, lastBuild: nil),
            ])
        #expect(versions.lines.map(\.nextRelease) == ["1.4.0+58", nil])
    }

    @Test func `bumps a component's minor, showing its new version at once`() async throws {
        let (versions, deployment) = try await notesVersions()
        deployment.answer(
            "PUT /api/projects/notes/versions/notes-api", 200,
            #"{"component":"notes-api","version":"1.5.0","lastBuild":57,"setAt":"2026-10-22T10:00:00.000Z"}"#)

        #expect(await versions.bump("notes-api", .minor))

        let sent = try #require(deployment.bodies("PUT /api/projects/notes/versions/notes-api").first)
        #expect(try JSONDecoder().decode([String: String].self, from: sent) == ["version": "1.5.0"])
        #expect(versions.lines.first?.nextRelease == "1.5.0+58")
        #expect(versions.changes.isEmpty)
    }

    @Test func `sets a first version with where its builds continue from`() async throws {
        let (versions, deployment) = try await notesVersions()
        deployment.answer(
            "PUT /api/projects/notes/versions/notes-ios", 200,
            #"{"component":"notes-ios","version":"2.5.0","lastBuild":318,"setAt":"2026-10-22T10:00:00.000Z"}"#)

        #expect(await versions.set("notes-ios", version: " 2.5.0 ", firstBuild: "319"))

        let body = try #require(deployment.bodies("PUT /api/projects/notes/versions/notes-ios").first)
        let sent = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        #expect(sent["version"] as? String == "2.5.0")
        #expect(sent["firstBuild"] as? Int == 319)
        #expect(versions.lines.last?.nextRelease == "2.5.0+319")
    }

    @Test func `says why the deployment refused a version`() async throws {
        let (versions, deployment) = try await notesVersions()
        let reason = "1.3.0 is lower than notes-api's 1.4.0."
        deployment.answer(
            "PUT /api/projects/notes/versions/notes-api", 422, #"{"_tag":"VersionRefused","reason":"\#(reason)"}"#)

        #expect(!(await versions.set("notes-api", version: "1.3.0", firstBuild: "")))

        #expect(versions.changes["notes-api"] == .failed(.refused(reason: reason)))
        #expect(versions.lines.first?.version == "1.4.0")
        versions.dismissProblem(of: "notes-api")
        #expect(versions.changes.isEmpty)
    }

    @Test func `sends nothing that isn't a version or a build number`() async throws {
        let (versions, deployment) = try await notesVersions()

        #expect(!(await versions.set("notes-api", version: "1.5", firstBuild: "")))
        #expect(versions.changes["notes-api"] == .failed(.notAVersion))
        #expect(!(await versions.set("notes-api", version: "1.5.0", firstBuild: "0")))
        #expect(versions.changes["notes-api"] == .failed(.notABuildNumber))
        #expect(!deployment.requests.contains { $0.hasPrefix("PUT") })
    }

    @Test func `keeps the version shown when the phone is offline, and says so`() async throws {
        let (versions, deployment) = try await notesVersions()
        deployment.setOffline(true)

        #expect(!(await versions.bump("notes-api", .patch)))

        #expect(versions.changes["notes-api"] == .failed(.unreachable))
        #expect(versions.lines.first?.nextRelease == "1.4.0+58")
    }
}
