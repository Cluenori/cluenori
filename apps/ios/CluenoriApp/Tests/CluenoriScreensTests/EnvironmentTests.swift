import CluenoriClient
import CluenoriScreens
import Foundation
import Testing

/// The notes project on a deployment that tells environments apart: two production environments,
/// both seen lately, and staging.
let notesDetailAnswer = #"""
    {"project":{"key":"notes","name":"Notes","createdAt":"2026-10-01T10:00:00.000Z"},
    "components":[{"key":"notes-api","name":"notes-api","createdAt":"2026-10-01T10:00:00.000Z"}],
    "settings":{"productionEnvironments":["production","prod-eu","live"]},
    "environments":["production","prod-eu","staging"]}
    """#

/// The notes project on a deployment older than environments: no settings, no environments.
let olderNotesDetailAnswer = #"""
    {"project":{"key":"notes","name":"Notes","createdAt":"2026-10-01T10:00:00.000Z"},"components":[]}
    """#

/// The environment each request to `path` named, in order; nil for one that named none.
func environments(_ deployment: FakeDeployment, _ path: String) -> [String?] {
    deployment.queries(path).map { $0["environment"] }
}

struct EnvironmentChoiceTests {
    @Test func `shows a project's first production environment seen, and offers every one seen`() async throws {
        let deployment = notesDeployment()
        deployment.answer("GET /api/projects/notes", 200, notesDetailAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let models = try #require(pairing.models)
        let choice = models.environments("notes")

        await choice.loadOnce()

        #expect(choice.environments == ["production", "prod-eu", "staging"])
        #expect(choice.production == ["production", "prod-eu"])
        #expect(choice.chosen == "production")
        // A route that names no environment shows the chosen one; one that names one keeps it.
        #expect(
            models.resolved(.errors(of: .project("notes"))) == .errors(of: .project("notes", environment: "production"))
        )
        #expect(models.resolved(.tech(project: "notes")) == .tech(project: "notes", environment: "production"))
        // A project's own screen is in production, whatever is chosen.
        #expect(models.resolved(.project("notes")) == .project("notes"))
        #expect(models.resolved(.releases(project: "notes")) == .releases(project: "notes", environment: "production"))
        #expect(
            models.resolved(.logs(of: .project("notes", environment: "staging")))
                == .logs(of: .project("notes", environment: "staging")))
        // A release's screens keep the release's own environment.
        #expect(models.resolved(.errors(of: .release(feedRelease))) == .errors(of: .release(feedRelease)))
        // Asked once while the app runs.
        await choice.loadOnce()
        #expect(deployment.requests.filter { $0 == "GET /api/projects/notes" }.count == 1)
    }

    @Test func `asks every question of a project's screens in the environment it shows`() async throws {
        let deployment = notesDeployment()
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let models = try #require(pairing.models)
        let staging = Telemetry.project("notes", environment: "staging")

        await models.project("notes", environment: "staging", period: .day).refresh()
        await models.operations(staging, period: .day).table.load()
        await models.errors(staging, period: .day).table.load()
        await models.logs(staging, period: .day).refresh()
        await models.releases("notes", environment: "staging", period: .day).list.load()
        await models.operation(
            OperationRef(project: "notes", component: "notes-api", environment: "staging", name: "GET /api/feed"),
            period: .day
        ).refresh()

        for path in ["load", "operations", "errors", "logs", "releases"] {
            let sent = environments(deployment, "/api/projects/notes/\(path)")
            #expect(!sent.isEmpty && sent.allSatisfy { $0 == "staging" }, "\(path) asked \(sent)")
        }
        // Incidents are every environment's: the question takes none.
        #expect(deployment.queries("/api/projects/notes/incidents").allSatisfy { $0["environment"] == nil })
    }

    @Test func `keeps each environment's answers apart, and the project's every-environment ones where they were`()
        async throws
    {
        let directory = try cacheDirectory()
        let online = notesDeployment()
        let first = PairingModel(
            store: MemoryStore(paired), details: details, transport: online.transport, cacheDirectory: directory)
        await first.models?.errors(.project("notes", environment: "staging"), period: .day).table.load()
        await first.models?.operations(.project("notes"), period: .day).table.load()

        let offline = FakeDeployment()
        offline.setOffline(true)
        let next = PairingModel(
            store: MemoryStore(paired), details: details, transport: offline.transport, cacheDirectory: directory)
        let models = try #require(next.models)
        #expect(models.errors(.project("notes", environment: "staging"), period: .day).table.value != nil)
        #expect(models.errors(.project("notes", environment: "production"), period: .day).table.value == nil)
        // Every environment's, as before environments, stays where the phone kept it.
        #expect(models.operations(.project("notes"), period: .day).table.value?.count == 120)
    }

    @Test func `remembers the environment chosen for a project, and shows it offline when the app opens again`()
        async throws
    {
        let directory = try cacheDirectory()
        let online = notesDeployment()
        online.answer("GET /api/projects/notes", 200, notesDetailAnswer)
        let first = PairingModel(
            store: MemoryStore(paired), details: details, transport: online.transport, cacheDirectory: directory)
        let choice = try #require(first.models).environments("notes")
        await choice.loadOnce()
        first.navigation.open(.errors(of: .project("notes", environment: "production")))

        first.navigation.show("staging", of: choice)

        #expect(choice.chosen == "staging")
        #expect(first.navigation.path.last == .errors(of: .project("notes", environment: "staging")))

        let offline = FakeDeployment()
        offline.setOffline(true)
        let next = PairingModel(
            store: MemoryStore(paired), details: details, transport: offline.transport, cacheDirectory: directory)
        let models = try #require(next.models)
        let kept = models.environments("notes")
        await kept.loadOnce()
        #expect(kept.detail.problem == .unreachable)
        #expect(kept.chosen == "staging")
        #expect(models.resolved(.tech(project: "notes")) == .tech(project: "notes", environment: "staging"))
        // Another project keeps its own.
        #expect(models.environments("atlas").chosen == nil)
    }

    @Test func `shows the production environment again when the one chosen isn't seen any more`() async throws {
        let directory = try cacheDirectory()
        let deployment = notesDeployment()
        deployment.answer("GET /api/projects/notes", 200, notesDetailAnswer)
        let first = PairingModel(
            store: MemoryStore(paired), details: details, transport: deployment.transport, cacheDirectory: directory)
        let choice = try #require(first.models).environments("notes")
        await choice.loadOnce()
        first.navigation.show("qa", of: choice)
        #expect(choice.remembered == "qa")

        #expect(choice.chosen == "production")
    }

    @Test func `asks without an environment, as before, on a deployment older than environments`() async throws {
        let deployment = notesDeployment()
        deployment.answer("GET /api/projects/notes", 200, olderNotesDetailAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let models = try #require(pairing.models)
        let choice = models.environments("notes")

        await choice.loadOnce()

        #expect(choice.detail.value != nil)
        #expect(choice.environments.isEmpty)
        #expect(choice.chosen == nil)
        let route = models.resolved(.errors(of: .project("notes")))
        #expect(route == .errors(of: .project("notes")))
        await models.errors(.project("notes"), period: .day).table.load()
        #expect(environments(deployment, "/api/projects/notes/errors") == [nil])
    }

    @Test func `shows the open screens of a project in the environment chosen, but not a release's`() {
        let navigation = Navigation()
        let operation = OperationRef(
            project: "notes", component: "notes-api", environment: "production", name: "GET /api/feed")
        navigation.path = [
            .project("notes"), .tech(project: "notes", environment: "production"),
            .operations(of: .project("notes", environment: "production")), .operation(operation),
        ]
        let elsewhere = Navigation()
        elsewhere.path = [
            .release(feedRelease), .errors(of: .release(feedRelease)),
            .tech(project: "atlas", environment: "production"),
        ]
        let deployment = notesDeployment()
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let choice = pairing.models!.environments("notes")

        navigation.show("staging", of: choice)
        elsewhere.show("staging", of: choice)

        #expect(
            navigation.path == [
                .project("notes"), .tech(project: "notes", environment: "staging"),
                .operations(of: .project("notes", environment: "staging")),
                .operation(
                    OperationRef(
                        project: "notes", component: "notes-api", environment: "staging", name: "GET /api/feed")),
            ])
        #expect(
            elsewhere.path == [
                .release(feedRelease), .errors(of: .release(feedRelease)),
                .tech(project: "atlas", environment: "production"),
            ])
    }

    @Test func `reads the environment a link names`() throws {
        let links: [(String, Route)] = [
            ("cluenori://projects/notes/tech?environment=staging", .tech(project: "notes", environment: "staging")),
            (
                "cluenori://projects/notes/errors?environment=staging",
                .errors(of: .project("notes", environment: "staging"))
            ),
            (
                "cluenori://projects/notes/releases?environment=staging",
                .releases(project: "notes", environment: "staging")
            ),
            ("cluenori://projects/notes/logs", .logs(of: .project("notes"))),
        ]
        for (link, route) in links {
            #expect(Route(try #require(URL(string: link))) == route)
        }
        // A screen narrowed to a release leaves for the project's in its chosen environment.
        #expect(Route.logs(of: .release(feedRelease)).withoutRelease == .logs(of: .project("notes")))
    }
}

struct ReleaseSpanTests {
    @Test func `looks over a release's span, in its own environment, not the period`() async throws {
        let deployment = notesDeployment()
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let models = try #require(pairing.models)

        await models.errors(.release(feedRelease), period: .hour).table.load()

        let query = try #require(deployment.queries("/api/projects/notes/errors").last)
        #expect(query["from"] == "2026-10-21T09:12:00.000Z")
        #expect(query["to"] == "2026-10-21T13:41:00.000Z")
        #expect(query["environment"] == "production")
        // The same screen over another period is the same one: the release's span is its own.
        #expect(
            models.errors(.release(feedRelease), period: .month) === models.errors(.release(feedRelease), period: .hour)
        )
    }

    @Test func `asks for the release's span once while its detail is fresh`() async throws {
        let deployment = notesDeployment()
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let models = try #require(pairing.models)
        await models.release(feedRelease).detail.load()

        await models.operations(.release(feedRelease), period: .day).table.load()
        await models.logs(.release(feedRelease), period: .day).refresh()

        let detailPath = "GET /api/projects/notes/releases/notes-api/2026.10.21-e91f09c"
        #expect(deployment.requests.filter { $0 == detailPath }.count == 1)
        #expect(models.operations(.release(feedRelease), period: .day).release?.detail.value?.summary.span != nil)
    }

    @Test func `looks from a release's deploy or upload until now when it has no telemetry`() async throws {
        let deployment = notesDeployment()
        deployment.answer("GET /api/projects/notes/releases/notes-ios/2.5.0%2B318", 200, storeOnlyReleaseAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let build = ReleaseRef(project: "notes", component: "notes-ios", environment: nil, version: "2.5.0+318")
        let before = Date.now

        try await #require(pairing.models).logs(.release(build), period: .day).refresh()

        let query = try #require(deployment.queries("/api/projects/notes/logs").last)
        #expect(query["from"] == "2026-10-21T08:00:00.000Z")
        let to = try Date(try #require(query["to"]), strategy: .iso8601)
        #expect(to >= before.addingTimeInterval(-1))
        // A release that names no environment is asked about in none.
        #expect(query["environment"] == nil)
        #expect(query["component"] == "notes-ios" && query["release"] == "2.5.0+318")
    }

    @Test func `can't look over a release the deployment doesn't know, and says it's missing`() async throws {
        let deployment = notesDeployment()
        deployment.answer(
            "GET /api/projects/notes/releases/notes-api/9.9.9",
            404,
            #"{"_tag":"ReleaseNotFound","component":"notes-api","release":"9.9.9"}"#
        )
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let gone = ReleaseRef(project: "notes", component: "notes-api", environment: "production", version: "9.9.9")
        let errors = try #require(pairing.models).errors(.release(gone), period: .day)

        await errors.table.load()

        #expect(errors.table.problem == .missing)
        #expect(deployment.queries("/api/projects/notes/errors").isEmpty)
    }
}
