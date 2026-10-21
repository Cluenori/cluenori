import CluenoriClient
import CluenoriScreens
import Foundation
import Testing

let operationsAnswer = #"""
    {"rows":[{"component":"notes-api","operation":"GET /api/feed","count":120,"errors":3,"averageMs":200,
    "p50Ms":150,"p80Ms":260,"p95Ms":590,"p99Ms":900}],"count":120,"errors":3}
    """#
let loadAnswer =
    #"{"step":"5m","points":[{"start":"2026-10-21T12:00:00.000Z","count":120,"errors":3,"p50Ms":150,"p80Ms":260,"p95Ms":590,"p99Ms":900}]}"#
let errorsAnswer = #"{"groups":[],"occurrences":0}"#
let incidentsAnswer = #"{"open":[],"resolved":[]}"#

func logsAnswer(ids: ClosedRange<Int>, next: Int?) -> String {
    let lines = ids.reversed().map { id in
        #"{"id":\#(id),"component":"notes-api","time":"2026-10-21T12:00:00.000Z","level":"error","category":"Notes","message":"Line \#(id)","attributes":{}}"#
    }
    return #"{"lines":[\#(lines.joined(separator: ","))]\#(next.map { ",\"next\":\($0)" } ?? "")}"#
}

/// A deployment answering every question of the notes project's screens.
func notesDeployment() -> FakeDeployment {
    let deployment = FakeDeployment()
    deployment.answer("GET /api/projects/notes/incidents", 200, incidentsAnswer)
    deployment.answer("GET /api/projects/notes/load", 200, loadAnswer)
    deployment.answer("GET /api/projects/notes/operations", 200, operationsAnswer)
    deployment.answer("GET /api/projects/notes/errors", 200, errorsAnswer)
    deployment.answer("GET /api/projects/notes/logs", 200, logsAnswer(ids: 101...200, next: 101))
    return deployment
}

struct RouteTests {
    @Test(arguments: [
        ("cluenori://projects/notes", Route.project("notes")),
        ("cluenori://projects/notes/errors", .errors(project: "notes")),
        ("cluenori://projects/notes/errors/4f1c9a2e7b3d5068", .error(project: "notes", id: "4f1c9a2e7b3d5068")),
        ("cluenori://projects/notes/logs", .logs(project: "notes")),
    ])
    func `reads the screen a link names`(_ text: String, _ route: Route) throws {
        #expect(Route(try #require(URL(string: text))) == route)
    }

    @Test func `opens a screen over the ones that lead to it, on the projects tab`() {
        let navigation = Navigation()
        navigation.open(.error(project: "notes", id: "4f1c9a2e7b3d5068"))
        #expect(navigation.tab == .projects)
        #expect(
            navigation.projectsPath == [
                .project("notes"), .errors(project: "notes"), .error(project: "notes", id: "4f1c9a2e7b3d5068"),
            ])
    }

    @Test func `opens a screen's link only while paired`() async throws {
        let url = try #require(URL(string: "cluenori://projects/notes/logs"))
        let unpaired = PairingModel(store: MemoryStore(), details: details)
        await unpaired.open(url)
        #expect(unpaired.navigation.projectsPath.isEmpty)
        #expect(unpaired.problem == .notAPairingLink)

        let pairing = PairingModel(store: MemoryStore(paired), details: details)
        await pairing.open(url)
        #expect(pairing.navigation.projectsPath == [.project("notes"), .logs(project: "notes")])
    }
}

struct ProjectModelTests {
    @Test func `asks every question of a project at once, and again over another period`() async throws {
        let deployment = notesDeployment()
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let models = try #require(pairing.models)
        let project = models.project("notes", period: .day)

        await project.refresh()
        #expect(project.operations.value?.rows.first?.p95Ms == 590)
        #expect(project.load.value?.points.count == 1)
        #expect(project.errors.value?.groups.isEmpty == true)
        #expect(project.logs.value?.lines.count == 100)
        #expect(Set(deployment.requests).count == 5)

        await project.choose(.week)
        #expect(project.period == .week)
        #expect(deployment.requests.count == 10)
        // The same model comes back for the same project, so going back shows it as it was.
        #expect(models.project("notes", period: .week) === project)
    }

    @Test func `shows what it kept for a period at once, offline`() async throws {
        let directory = try cacheDirectory()
        let online = notesDeployment()
        let first = PairingModel(
            store: MemoryStore(paired), details: details, transport: online.transport, cacheDirectory: directory)
        await first.models?.project("notes", period: .day).refresh()

        let offline = FakeDeployment()
        offline.setOffline(true)
        let next = PairingModel(
            store: MemoryStore(paired), details: details, transport: offline.transport, cacheDirectory: directory)
        let project = try #require(next.models).project("notes", period: .day)
        #expect(project.operations.value?.count == 120)
        await project.refresh()
        #expect(project.operations.value?.count == 120)
        #expect(project.operations.problem == .unreachable)
        #expect(project.operations.receivedAt != nil)
    }
}

struct LogsModelTests {
    @Test func `adds older lines as the list reaches its end, and drops them when filtered`() async throws {
        let deployment = notesDeployment()
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let logs = try #require(pairing.models).logs("notes", period: .day)
        await logs.refresh()
        #expect(logs.hasOlder)

        deployment.answer("GET /api/projects/notes/logs", 200, logsAnswer(ids: 1...100, next: nil))
        await logs.loadOlder()
        #expect(logs.older.count == 100)
        #expect(logs.older.first?.message == "Line 100")
        #expect(logs.hasOlder == false)

        await logs.filter(level: .fatal, search: "  timeout ")
        #expect(logs.older.isEmpty)
        #expect(logs.level == .fatal)
        #expect(logs.search == "timeout")
    }
}
