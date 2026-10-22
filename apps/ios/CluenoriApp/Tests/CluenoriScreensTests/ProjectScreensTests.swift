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
    deployment.answer("GET /api/projects/notes/releases", 200, releasesAnswer)
    // The release screens narrowed to it look over its span, from 09:12 to 13:41 on Oct 21.
    deployment.answer("GET /api/projects/notes/releases/notes-api/2026.10.21-e91f09c", 200, releaseAnswer)
    return deployment
}

struct RouteTests {
    @Test(arguments: [
        ("cluenori://projects/notes", Route.project("notes")),
        ("cluenori://projects/notes/errors", .errors(of: .project("notes"))),
        (
            "cluenori://projects/notes/errors/4f1c9a2e7b3d5068",
            .error(of: .project("notes"), id: "4f1c9a2e7b3d5068")
        ),
        ("cluenori://projects/notes/logs", .logs(of: .project("notes"))),
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

    @Test func `opens a screen over the ones that lead to it, on the projects tab`() {
        let navigation = Navigation()
        navigation.open(.error(of: .project("notes"), id: "4f1c9a2e7b3d5068"))
        #expect(navigation.tab == .projects)
        #expect(
            navigation.projectsPath == [
                .project("notes"), .errors(of: .project("notes")),
                .error(of: .project("notes"), id: "4f1c9a2e7b3d5068"),
            ])

        let release = ReleaseRef(project: "notes", component: "notes-api", environment: nil, version: "1.8.0")
        navigation.open(.release(release))
        // A release comes from its component's screen, where its environments are.
        let api = Route.component(project: "notes", component: "notes-api")
        #expect(navigation.projectsPath == [.project("notes"), api, .release(release)])

        navigation.open(.notes(release))
        #expect(navigation.projectsPath.suffix(2) == [.release(release), .notes(release)])
        navigation.open(.notesStyle(project: "notes"))
        #expect(navigation.projectsPath == [.project("notes"), .notesStyle(project: "notes")])
        navigation.open(.componentReleases(project: "notes", component: "notes-api"))
        #expect(
            navigation.projectsPath == [
                .project("notes"), api, .componentReleases(project: "notes", component: "notes-api"),
            ])
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
            navigation.projectsPath == [
                .project("notes"), .component(project: "notes", component: "notes-api"), .release(feedRelease),
                .errors(of: .release(feedRelease)), .error(of: .release(feedRelease), id: "4f1c9a2e7b3d5068"),
            ])

        let operation = OperationRef(
            project: "notes", component: "notes-api", environment: "production", name: "GET /api/feed",
            release: "2026.10.21-e91f09c")
        navigation.open(.operation(operation))
        #expect(
            navigation.projectsPath == [
                .project("notes"), .component(project: "notes", component: "notes-api"), .release(feedRelease),
                .operations(of: .release(feedRelease)), .operation(operation),
            ])
    }

    @Test func `shows a screen without its release in its place, on the tab it's on`() {
        let navigation = Navigation()
        navigation.open(.logs(of: .release(feedRelease)))

        navigation.showWithoutRelease(.logs(of: .release(feedRelease)))

        #expect(
            navigation.projectsPath == [
                .project("notes"), .component(project: "notes", component: "notes-api"), .release(feedRelease),
                .logs(of: .project("notes")),
            ])

        navigation.todayPath = [.error(of: .release(feedRelease), id: "4f1c9a2e7b3d5068")]
        navigation.showWithoutRelease(.error(of: .release(feedRelease), id: "4f1c9a2e7b3d5068"))
        #expect(navigation.todayPath == [.error(of: .project("notes"), id: "4f1c9a2e7b3d5068")])

        let operation = OperationRef(
            project: "notes", component: "notes-api", environment: "production", name: "GET /api/feed",
            release: "2026.10.21-e91f09c")
        #expect(Route.operation(operation).withoutRelease == .operation(operation.everyRelease))
    }

    @Test func `leaves a screen that isn't narrowed, or isn't on top, as it is`() {
        let navigation = Navigation()
        navigation.open(.errors(of: .release(feedRelease)))
        let before = navigation.projectsPath

        navigation.showWithoutRelease(.errors(of: .project("notes")))
        navigation.showWithoutRelease(.logs(of: .release(feedRelease)))

        #expect(navigation.projectsPath == before)
        #expect(Route.release(feedRelease).withoutRelease == nil)
    }

    @Test func `opens a screen's link only while paired`() async throws {
        let url = try #require(URL(string: "cluenori://projects/notes/logs"))
        let unpaired = PairingModel(store: MemoryStore(), details: details)
        await unpaired.open(url)
        #expect(unpaired.navigation.projectsPath.isEmpty)
        #expect(unpaired.problem == .notAPairingLink)

        let pairing = PairingModel(store: MemoryStore(paired), details: details)
        await pairing.open(url)
        #expect(pairing.navigation.projectsPath == [.project("notes"), .logs(of: .project("notes"))])
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
        // Its delivery is every environment's and every period's: the delivery model asks it.
        #expect(Set(deployment.requests).count == 5)

        await project.choose(.week)
        #expect(project.period == .week)
        #expect(deployment.requests.count == 10)
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
    @Test func `adds older lines as the list reaches its end, and drops them when filtered`() async throws {
        let deployment = notesDeployment()
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let logs = try #require(pairing.models).logs(.project("notes"), period: .day)
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
