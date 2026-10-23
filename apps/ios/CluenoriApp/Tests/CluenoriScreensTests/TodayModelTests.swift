import CluenoriClient
import CluenoriScreens
import Foundation
import Testing

let todayAnswer = #"""
    {"items":[
      {"_tag":"incident","project":"notes","incident":{"id":"019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f53",
        "component":"notes-api","subject":"POST /api/export","title":"POST /api/export: 18% failed, usually 0.1%",
        "evidence":{"_tag":"failing","operation":"POST /api/export","failed":18,"count":100,"usualRate":0.001},
        "openedAt":"2026-10-21T12:00:00.000Z"}},
      {"_tag":"error","project":"atlas","isNew":true,"ongoing":false,"error":{"id":"4f1c9a2e7b3d5068",
        "kind":"exception","title":"NpgsqlException: Failed to connect","culprit":"Atlas.Store.Save",
        "occurrences":12,"firstSeen":"2026-10-21T09:00:00.000Z","lastSeen":"2026-10-21T11:00:00.000Z",
        "lastComponent":"atlas-api"}},
      {"_tag":"forecast","project":"notes","rain":true}
    ],
    "projects":[{"key":"notes","name":"Notes","createdAt":"2026-10-01T10:00:00.000Z"},
      {"key":"atlas","name":"Atlas","createdAt":"2026-10-02T10:00:00.000Z"},
      {"key":"quiet","name":"Quiet","createdAt":"2026-10-03T10:00:00.000Z"}],
    "unanswered":["quiet"],
    "at":"2026-10-21T13:00:00.000Z"}
    """#

/// A directory of its own for one test's caches.
func cacheDirectory() throws -> URL {
    let directory = FileManager.default.temporaryDirectory.appending(path: "cluenori-tests-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
}

struct TodayModelTests {
    @Test func `shows Today in its order, with each project's name, and what it doesn't know as such`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/today", 200, todayAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let today = try #require(pairing.models?.today)

        await today.load()

        let rows = try #require(today.rows)
        #expect(rows.map(\.project) == ["Notes", "Atlas", ""])
        #expect(
            rows[0].evidence
                == .incident(
                    title: "POST /api/export: 18% failed, usually 0.1%",
                    cause: .failing,
                    openedAt: Date(timeIntervalSince1970: 1_792_584_000),
                    acknowledged: false
                ))
        // Each opens the item itself.
        #expect(rows[0].route == .incident(project: "notes", id: "019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f53"))
        #expect(rows[1].route == .error(of: .project("atlas"), id: "4f1c9a2e7b3d5068"))
        #expect(rows[2].evidence == .unknown(kind: "forecast"))
        #expect(today.unanswered == ["Quiet"])
        #expect(today.lookedAt == Date(timeIntervalSince1970: 1_792_587_600))
    }

    @Test func `opens with what it saw last time, and keeps it when the phone is offline`() async throws {
        let directory = try cacheDirectory()
        let online = FakeDeployment()
        online.answer("GET /api/today", 200, todayAnswer)
        let first = PairingModel(
            store: MemoryStore(paired), details: details, transport: online.transport, cacheDirectory: directory)
        await first.models?.today.load()

        let offline = FakeDeployment()
        offline.setOffline(true)
        let next = PairingModel(
            store: MemoryStore(paired), details: details, transport: offline.transport, cacheDirectory: directory)
        let today = try #require(next.models?.today)
        #expect(today.rows?.count == 3)

        await today.load()
        #expect(today.rows?.count == 3)
        #expect(today.problem == .unreachable)
    }

    @Test func `unpairs when the deployment refuses the key, and forgets what it saw`() async throws {
        let directory = try cacheDirectory()
        let deployment = FakeDeployment()
        deployment.answer("GET /api/today", 200, todayAnswer)
        let store = MemoryStore(paired)
        let pairing = PairingModel(
            store: store, details: details, transport: deployment.transport, cacheDirectory: directory)
        await pairing.models?.today.load()
        #expect(try FileManager.default.contentsOfDirectory(atPath: directory.path()).count == 1)

        deployment.answer("GET /api/today", 401, #"{"_tag":"Unauthorized","message":"Pair the phone again."}"#)
        await pairing.models?.today.load()

        #expect(pairing.state == .unpaired)
        #expect(pairing.problem == .removed)
        #expect(pairing.models == nil)
        #expect(try FileManager.default.contentsOfDirectory(atPath: directory.path()).isEmpty)
    }
}

let nowAnswer = #"""
    {"items":[
      {"_tag":"incident","project":"notes","incident":{"id":"019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f53",
        "component":"notes-api","subject":"https://notes.example/health","title":"https://notes.example/health is down",
        "evidence":{"_tag":"down","monitor":"019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f54","url":"https://notes.example/health",
          "failures":3,"problem":"HTTP 503"},
        "openedAt":"2026-10-21T12:56:00.000Z"}},
      {"_tag":"slower","project":"atlas","component":"atlas-api","environment":"prod","operation":"GET /api/search",
        "p95Ms":640,"usualP95Ms":210},
      {"_tag":"promotion","project":"notes","component":"notes-ios","environment":"production","release":"1.2.0+12",
        "promotion":"019a0fa0-4f00-7f60-9a71-6c7d8e9fa0b1","state":"approved","startedAt":"2026-10-21T08:00:00.000Z"},
      {"_tag":"promotion","project":"atlas","component":"atlas-api","environment":"prod","release":"2.0.1+4",
        "promotion":"019a0fa0-4f00-7f60-9a71-6c7d8e9fa0b2","state":"failed","startedAt":"2026-10-21T11:00:00.000Z",
        "endedAt":"2026-10-21T11:20:00.000Z"}
    ],
    "projects":[{"key":"notes","name":"Notes","createdAt":"2026-10-01T10:00:00.000Z"},
      {"key":"quiet","name":"Quiet","createdAt":"2026-10-03T10:00:00.000Z"},
      {"key":"kiln","name":"Kiln","createdAt":"2026-10-04T10:00:00.000Z"},
      {"key":"atlas","name":"Atlas","createdAt":"2026-10-02T10:00:00.000Z"}],
    "unanswered":["quiet"],
    "pulses":[
      {"project":"notes","load":[{"start":"2026-10-21T11:00:00.000Z","count":1200,"errors":3},
        {"start":"2026-10-21T12:00:00.000Z","count":900,"errors":12}],
       "people":{"latest":{"day":"2026-10-20","people":1284,"installations":1390,"monthPeople":9870,"sessions":3900,
         "foregroundMs":5000000},
         "weekBefore":{"day":"2026-10-13","people":1211,"installations":1300,"sessions":3600,"foregroundMs":4800000}}},
      {"project":"kiln","load":[]},
      {"project":"atlas","load":[{"start":"2026-10-21T12:00:00.000Z","count":40,"errors":0}]}
    ],
    "at":"2026-10-21T13:00:00.000Z"}
    """#

struct NowTests {
    @Test func `lists each project with its own items and its pulse, those that need you first`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/today", 200, nowAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let today = try #require(pairing.models?.today)

        await today.load()

        let projects = try #require(today.projects)
        // Notes has the most urgent item; then Atlas; then the rest by name, the one that didn't
        // answer too.
        #expect(projects.map(\.key) == ["notes", "atlas", "kiln", "quiet"])
        #expect(projects[0].rows.map(\.kind) == [.incident(acknowledged: false), .promotion])
        #expect(projects[0].status == .incident(acknowledged: false))
        #expect(projects[1].status == .slower)
        #expect(projects[2].status == nil)
        #expect(!projects[3].answered)
        #expect(projects[3].pulse == nil)

        let notes = try #require(projects[0].pulse)
        #expect(notes.operations == 2_100)
        #expect(notes.failed == 15)
        let people = try #require(notes.people)
        #expect(people.day == UTCDay.date("2026-10-20"))
        #expect(people.daily == 1_284)
        #expect(people.monthly == 9_870)
        #expect(abs((people.dailyChange ?? 0) - 73.0 / 1_211.0) < 0.000_001)
        // A week before had no monthly count: its change is unknown, never 0.
        #expect(people.monthlyChange == nil)
        // Kiln's apps sent nothing: its people are unknown.
        #expect(projects[2].pulse?.people == nil)
        #expect(projects[2].pulse?.hours.isEmpty == true)
        #expect(today.project("kiln")?.name == "Kiln")
    }

    @Test func `opens a release that needs you, since when it ended or else started`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/today", 200, nowAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let today = try #require(pairing.models?.today)

        await today.load()

        let rows = try #require(today.rows)
        let approved = try #require(rows.first { $0.id == "promotion notes 019a0fa0-4f00-7f60-9a71-6c7d8e9fa0b1" })
        #expect(
            approved.evidence
                == .promotion(
                    release: "1.2.0+12", component: "notes-ios", environment: "production", state: .approved,
                    since: try Date("2026-10-21T08:00:00Z", strategy: .iso8601)))
        #expect(
            approved.route
                == .release(
                    ReleaseRef(project: "notes", component: "notes-ios", environment: "production", version: "1.2.0+12")
                ))
        let failed = try #require(rows.first { $0.projectKey == "atlas" && $0.kind == .promotion })
        guard case .promotion(_, _, _, let state, let since) = failed.evidence else {
            Issue.record("Not a promotion: \(failed.evidence)")
            return
        }
        #expect(state == .failed)
        #expect(since == (try Date("2026-10-21T11:20:00Z", strategy: .iso8601)))
        // The incident is about a monitor that is down.
        #expect(
            rows.first?.evidence
                == .incident(
                    title: "https://notes.example/health is down", cause: .down,
                    openedAt: try Date("2026-10-21T12:56:00Z", strategy: .iso8601), acknowledged: false))
    }

    @Test func `knows no pulse from a deployment older than pulses`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/today", 200, todayAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let today = try #require(pairing.models?.today)

        await today.load()

        let projects = try #require(today.projects)
        #expect(projects.map(\.key) == ["notes", "atlas", "quiet"])
        #expect(projects.allSatisfy { $0.pulse == nil })
    }
}

struct IncidentsModelTests {
    let incidents = #"""
        {"open":[{"id":"019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f53","component":"notes-api",
          "subject":"https://notes.example/health","title":"https://notes.example/health is down",
          "evidence":{"_tag":"down","monitor":"019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f54",
            "url":"https://notes.example/health","failures":3,"problem":"HTTP 503"},
          "openedAt":"2026-10-21T12:56:00.000Z"}],
        "resolved":[]}
        """#
    let acknowledged = #"""
        {"id":"019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f53","component":"notes-api",
          "subject":"https://notes.example/health","title":"https://notes.example/health is down",
          "evidence":{"_tag":"down","monitor":"019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f54",
            "url":"https://notes.example/health","failures":3,"problem":"HTTP 503"},
          "openedAt":"2026-10-21T12:56:00.000Z","acknowledgedAt":"2026-10-21T13:01:00.000Z"}
        """#
    let id = "019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f53"

    @Test func `shows an incident acknowledged as soon as the deployment says so`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/incidents", 200, incidents)
        deployment.answer("POST /api/projects/notes/incidents/\(id)/acknowledge", 200, acknowledged)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let models = try #require(pairing.models)
        let model = models.incidents("notes")
        await model.load()
        #expect(model.incident(id)?.acknowledgedAt == nil)

        await model.acknowledge(id)

        #expect(model.incident(id)?.acknowledgedAt == (try Date("2026-10-21T13:01:00Z", strategy: .iso8601)))
        #expect(model.notAcknowledged == nil)
        #expect(model.acknowledging == nil)
        // One per project, which its tech, its incidents and each incident share.
        #expect(models.incidents("notes") === model)
    }

    @Test func `says why an incident wasn't acknowledged, and leaves it as it was`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/incidents", 200, incidents)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let model = try #require(pairing.models).incidents("notes")
        await model.load()

        deployment.setOffline(true)
        await model.acknowledge(id)
        #expect(model.notAcknowledged?.incident == id)
        #expect(model.notAcknowledged?.problem == .unreachable)
        #expect(model.incident(id)?.acknowledgedAt == nil)

        deployment.setOffline(false)
        deployment.answer(
            "POST /api/projects/notes/incidents/\(id)/acknowledge", 404,
            #"{"_tag":"IncidentNotFound","incident":"019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f53"}"#)
        await model.acknowledge(id)
        #expect(model.notAcknowledged?.problem == .missing)
    }
}
