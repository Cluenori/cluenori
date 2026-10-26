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
        #"{"id":\#(id),"component":"notes-api","messageId":1,"time":"2026-10-21T12:00:00.000Z","level":"error","category":"Notes","message":"Line \#(id)","attributes":{}}"#
    }
    return #"{"lines":[\#(lines.joined(separator: ","))]\#(next.map { ",\"next\":\($0)" } ?? "")}"#
}

let logMessagesAnswer = #"""
    {"messages":[{"id":7,"level":"warn","title":"Retrying export {ExportId}","category":"Notes.Exports","lines":12,
    "firstSeen":"2026-10-20T12:00:00.000Z","lastSeen":"2026-10-21T12:00:00.000Z","lastComponent":"notes-api"}],
    "unshown":0,"lines":12}
    """#

/// A deployment answering every question of the notes project's screens.
func notesDeployment() -> FakeDeployment {
    let deployment = FakeDeployment()
    deployment.answer("GET /api/projects/notes/incidents", 200, incidentsAnswer)
    deployment.answer("GET /api/projects/notes/load", 200, loadAnswer)
    deployment.answer("GET /api/projects/notes/operations", 200, operationsAnswer)
    deployment.answer("GET /api/projects/notes/errors", 200, errorsAnswer)
    deployment.answer("GET /api/projects/notes/logs", 200, logsAnswer(ids: 101...200, next: 101))
    deployment.answer("GET /api/projects/notes/logs/messages", 200, logMessagesAnswer)
    deployment.answer("GET /api/projects/notes/releases", 200, releasesAnswer)
    // The release screens narrowed to it look over its span, from 09:12 to 13:41 on Oct 21.
    deployment.answer("GET /api/projects/notes/releases/notes-api/2026.10.21-e91f09c", 200, releaseAnswer)
    return deployment
}

struct RouteTests {
    @Test(arguments: [
        ("cluenori://projects/notes", Route.project("notes")),
        ("cluenori://projects/notes/tech", .tech(project: "notes")),
        ("cluenori://projects/notes/incidents", .incidents(project: "notes")),
        (
            "cluenori://projects/notes/incidents/0199f7a2-6000-7000-8000-000000000001",
            .incident(project: "notes", id: "0199f7a2-6000-7000-8000-000000000001")
        ),
        ("cluenori://projects/notes/uptime", .uptime(project: "notes")),
        (
            "cluenori://projects/notes/uptime/0199f7a2-6000-7000-8000-000000000002",
            .monitor(project: "notes", id: "0199f7a2-6000-7000-8000-000000000002")
        ),
        ("cluenori://projects/notes/delivery", .delivery(project: "notes")),
        ("cluenori://projects/notes/errors", .errors(of: .project("notes"))),
        (
            "cluenori://projects/notes/errors/4f1c9a2e7b3d5068",
            .error(of: .project("notes"), id: "4f1c9a2e7b3d5068")
        ),
        ("cluenori://projects/notes/logs", .logs(of: .project("notes"))),
        ("cluenori://projects/notes/logs/messages/7", .logMessage(of: .project("notes"), id: 7)),
        ("cluenori://projects/notes/logs/lines/412", .logLine(project: "notes", id: 412)),
        ("cluenori://projects/notes/operations", .operations(of: .project("notes"))),
        ("cluenori://projects/notes/releases", .releases(project: "notes")),
        ("cluenori://projects/notes/notes-style", .notesStyle(project: "notes")),
        ("cluenori://projects/notes/components/notes-api", .component(project: "notes", component: "notes-api")),
        (
            "cluenori://projects/notes/components/notes-api/releases",
            .componentReleases(project: "notes", component: "notes-api")
        ),
    ])
    func `reads the screen a link names`(_ text: String, _ route: Route) throws {
        #expect(Route(try #require(URL(string: text))) == route)
    }

    @Test func `reads the release a link names, with its environment when the link says one`() throws {
        let production = try #require(
            URL(string: "cluenori://projects/notes/releases/notes-api/2026.10.21-e91f09c?environment=production"))
        #expect(
            Route(production)
                == .release(
                    ReleaseRef(
                        project: "notes", component: "notes-api", environment: "production",
                        version: "2026.10.21-e91f09c")))

        let anywhere = try #require(URL(string: "cluenori://projects/notes/releases/notes-web/2.4.0+312"))
        #expect(
            Route(anywhere)
                == .release(
                    ReleaseRef(project: "notes", component: "notes-web", environment: nil, version: "2.4.0+312"))
        )
    }

    @Test func `opens a screen over the ones that lead to it from Now, through its project's door`() {
        let navigation = Navigation()
        navigation.open(.error(of: .project("notes"), id: "4f1c9a2e7b3d5068"))
        // Telemetry comes from the project's tech.
        #expect(
            navigation.path == [
                .project("notes"), .tech(project: "notes"), .errors(of: .project("notes")),
                .error(of: .project("notes"), id: "4f1c9a2e7b3d5068"),
            ])
        navigation.open(.incident(project: "notes", id: "0199f7a2-6000-7000-8000-000000000001"))
        #expect(
            navigation.path == [
                .project("notes"), .tech(project: "notes"), .incidents(project: "notes"),
                .incident(project: "notes", id: "0199f7a2-6000-7000-8000-000000000001"),
            ])
        // A monitor comes from Uptime, which comes from the incidents.
        navigation.open(.monitor(project: "notes", id: "m1"))
        #expect(
            navigation.path == [
                .project("notes"), .tech(project: "notes"), .incidents(project: "notes"), .uptime(project: "notes"),
                .monitor(project: "notes", id: "m1"),
            ])

        let release = ReleaseRef(project: "notes", component: "notes-api", environment: nil, version: "1.8.0")
        navigation.open(.release(release))
        // A release comes from its component's screen, where its environments are, in the project's
        // delivery.
        let api = Route.component(project: "notes", component: "notes-api")
        #expect(navigation.path == [.project("notes"), .delivery(project: "notes"), api, .release(release)])

        navigation.open(.notes(release))
        #expect(navigation.path.suffix(2) == [.release(release), .notes(release)])
        navigation.open(.notesStyle(project: "notes"))
        #expect(
            navigation.path == [.project("notes"), .delivery(project: "notes"), .notesStyle(project: "notes")])
        navigation.open(.componentReleases(project: "notes", component: "notes-api"))
        #expect(
            navigation.path == [
                .project("notes"), .delivery(project: "notes"), api,
                .componentReleases(project: "notes", component: "notes-api"),
            ])
        navigation.open(.releases(project: "notes"))
        #expect(
            navigation.path == [.project("notes"), .delivery(project: "notes"), .releases(project: "notes")])
    }

    @Test(arguments: [
        "cluenori://projects/notes/releases/notes-api",
        "cluenori://projects/notes/releases/notes-api/1.8.0/extra",
        "cluenori://projects/notes/deploys",
        "cluenori://projects/notes/components",
        "cluenori://projects/notes/components/notes-api/errors",
    ])
    func `reads no screen from a link that names none`(_ text: String) throws {
        #expect(Route(try #require(URL(string: text))) == nil)
    }

    @Test func `reads a release's screens a link names`() throws {
        let screens: [(String, Route)] = [
            ("operations", .operations(of: .release(feedRelease))),
            ("errors", .errors(of: .release(feedRelease))),
            ("errors/4f1c9a2e7b3d5068", .error(of: .release(feedRelease), id: "4f1c9a2e7b3d5068")),
            ("logs", .logs(of: .release(feedRelease))),
            ("notes", .notes(feedRelease)),
        ]
        for (screen, route) in screens {
            let url = try #require(
                URL(
                    string:
                        "cluenori://projects/notes/releases/notes-api/2026.10.21-e91f09c/\(screen)?environment=production"
                ))
            #expect(Route(url) == route)
        }
    }

    @Test(arguments: [
        "cluenori://projects/notes/releases/notes-api/1.8.0/releases",
        "cluenori://projects/notes/releases/notes-api/1.8.0/errors/4f1c9a2e7b3d5068/extra",
        "cluenori://projects/notes/releases/notes-api/1.8.0/deploys",
    ])
    func `reads no screen from a release's link that names none`(_ text: String) throws {
        #expect(Route(try #require(URL(string: text))) == nil)
    }

    @Test func `opens a release's screen over the release, and its error over its errors`() {
        let navigation = Navigation()
        navigation.open(.error(of: .release(feedRelease), id: "4f1c9a2e7b3d5068"))
        #expect(
            navigation.path == [
                .project("notes"), .delivery(project: "notes"), .component(project: "notes", component: "notes-api"),
                .release(feedRelease), .errors(of: .release(feedRelease)),
                .error(of: .release(feedRelease), id: "4f1c9a2e7b3d5068"),
            ])

        let operation = OperationRef(
            project: "notes", component: "notes-api", environment: "production", name: "GET /api/feed",
            release: "2026.10.21-e91f09c")
        navigation.open(.operation(operation))
        #expect(
            navigation.path == [
                .project("notes"), .delivery(project: "notes"), .component(project: "notes", component: "notes-api"),
                .release(feedRelease), .operations(of: .release(feedRelease)), .operation(operation),
            ])
    }

    @Test func `shows a screen without its release in its place`() {
        let navigation = Navigation()
        navigation.open(.logs(of: .release(feedRelease)))

        navigation.showWithoutRelease(.logs(of: .release(feedRelease)))

        #expect(
            navigation.path == [
                .project("notes"), .delivery(project: "notes"), .component(project: "notes", component: "notes-api"),
                .release(feedRelease), .logs(of: .project("notes")),
            ])

        navigation.path = [.error(of: .release(feedRelease), id: "4f1c9a2e7b3d5068")]
        navigation.showWithoutRelease(.error(of: .release(feedRelease), id: "4f1c9a2e7b3d5068"))
        #expect(navigation.path == [.error(of: .project("notes"), id: "4f1c9a2e7b3d5068")])

        let operation = OperationRef(
            project: "notes", component: "notes-api", environment: "production", name: "GET /api/feed",
            release: "2026.10.21-e91f09c")
        #expect(Route.operation(operation).withoutRelease == .operation(operation.everyRelease))
    }

    @Test func `leaves a screen that isn't narrowed, or isn't on top, as it is`() {
        let navigation = Navigation()
        navigation.open(.errors(of: .release(feedRelease)))
        let before = navigation.path

        navigation.showWithoutRelease(.errors(of: .project("notes")))
        navigation.showWithoutRelease(.logs(of: .release(feedRelease)))

        #expect(navigation.path == before)
        #expect(Route.release(feedRelease).withoutRelease == nil)
    }

    @Test func `opens a screen's link only while paired`() async throws {
        let url = try #require(URL(string: "cluenori://projects/notes/logs"))
        let unpaired = PairingModel(store: MemoryStore(), details: details)
        await unpaired.open(url)
        #expect(unpaired.navigation.path.isEmpty)
        #expect(unpaired.problem == .notAPairingLink)

        let pairing = PairingModel(store: MemoryStore(paired), details: details)
        await pairing.open(url)
        #expect(
            pairing.navigation.path == [.project("notes"), .tech(project: "notes"), .logs(of: .project("notes"))])
    }
}

struct ProjectModelTests {
    @Test func `asks every question of a project at once, and again over another period`() async throws {
        let deployment = notesDeployment()
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let models = try #require(pairing.models)
        let project = models.project("notes", environment: nil, period: .day)

        await project.refresh()
        #expect(project.operations.value?.rows.first?.p95Ms == 590)
        #expect(project.load.value?.points.count == 1)
        #expect(project.errors.value?.groups.isEmpty == true)
        #expect(project.logs.value?.lines.count == 100)
        // Its delivery and its incidents are every environment's and every period's: their own
        // models ask them.
        #expect(Set(deployment.requests).count == 4)

        await project.choose(.week)
        #expect(project.period == .week)
        #expect(deployment.requests.count == 8)
        // The same model comes back for the same project, so going back shows it as it was.
        #expect(models.project("notes", environment: nil, period: .week) === project)
    }

    @Test func `shows what it kept for a period at once, offline`() async throws {
        let directory = try cacheDirectory()
        let online = notesDeployment()
        let first = PairingModel(
            store: MemoryStore(paired), details: details, transport: online.transport, cacheDirectory: directory)
        await first.models?.project("notes", environment: nil, period: .day).refresh()

        let offline = FakeDeployment()
        offline.setOffline(true)
        let next = PairingModel(
            store: MemoryStore(paired), details: details, transport: offline.transport, cacheDirectory: directory)
        let project = try #require(next.models).project("notes", environment: nil, period: .day)
        #expect(project.operations.value?.count == 120)
        await project.refresh()
        #expect(project.operations.value?.count == 120)
        #expect(project.operations.problem == .unreachable)
        #expect(project.operations.receivedAt != nil)
    }
}

struct LogsModelTests {
    @Test func `lists log messages, and counts again by level and search when filtered`() async throws {
        let deployment = notesDeployment()
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let logs = try #require(pairing.models).logs(.project("notes"), period: .day)
        await logs.refresh()
        #expect(logs.messages.value?.messages.map(\.title) == ["Retrying export {ExportId}"])

        await logs.filter(level: .error, search: "  timeout ")
        #expect(logs.level == .error)
        #expect(logs.search == "timeout")
        let asked = try #require(deployment.queries("/api/projects/notes/logs/messages").last)
        #expect(asked["level"] == "error" && asked["search"] == "timeout")
        // The same filter again asks nothing more.
        let before = deployment.requests.count
        await logs.filter(level: .error, search: "timeout")
        #expect(deployment.requests.count == before)
    }

    @Test func `asks for a message and its lines by its ID, over the period`() async throws {
        let deployment = notesDeployment()
        deployment.answer(
            "GET /api/projects/notes/logs/messages/7", 200,
            #"{"message":\#(messageAnswer),"errors":[]}"#)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let message = try #require(pairing.models).logMessage(
            .project("notes", environment: "production"), id: 7, period: .day)

        await message.refresh()

        #expect(message.detail.value?.message.lines == 12)
        #expect(message.lines.value?.lines.count == 100)
        let lines = try #require(deployment.queries("/api/projects/notes/logs").last)
        #expect(lines["message"] == "7" && lines["environment"] == "production")
        #expect(deployment.queries("/api/projects/notes/logs/messages/7").last?["environment"] == "production")
    }

    @Test func `says a line is missing once it is no longer kept`() async throws {
        let deployment = FakeDeployment()
        deployment.answer(
            "GET /api/projects/notes/logs/lines/412", 404, #"{"_tag":"LogLineNotFound","line":412}"#)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let line = try #require(pairing.models).logLine("notes", id: 412)

        await line.line.load()

        #expect(line.line.problem == .missing)
    }
}

let messageAnswer = #"""
    {"id":7,"level":"warn","title":"Retrying export {ExportId}","category":"Notes.Exports","lines":12,
    "firstSeen":"2026-10-20T12:00:00.000Z","lastSeen":"2026-10-21T12:00:00.000Z","lastComponent":"notes-api"}
    """#

struct MissingTests {
    @Test func `says an error didn't happen in the period, rather than that the answer can't be read`() async throws {
        let deployment = FakeDeployment()
        deployment.answer(
            "GET /api/projects/notes/errors/4f1c9a2e7b3d5068",
            404,
            #"{"_tag":"ErrorGroupNotFound","error":"4f1c9a2e7b3d5068"}"#
        )
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let error = try #require(pairing.models).error(.project("notes"), id: "4f1c9a2e7b3d5068", period: .hour)

        await error.detail.load()

        #expect(error.detail.problem == .missing)
        #expect(pairing.state == .paired)
    }

    @Test func `looks further back one period at a time, and no further than 30 days`() {
        #expect(PeriodKey.hour.longer == .day)
        #expect(PeriodKey.week.longer == .month)
        #expect(PeriodKey.month.longer == nil)
    }
}
