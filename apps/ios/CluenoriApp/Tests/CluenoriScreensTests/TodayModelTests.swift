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
        #expect(today.project("quiet")?.answered == false)
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
        "resolved":[],"quiet":[]}
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

let linesAnswer = #"""
    {"items":[
      {"_tag":"error","project":"notes","isNew":true,"ongoing":true,"error":{"id":"4f1c9a2e7b3d5068",
        "kind":"exception","title":"NpgsqlException: Failed to connect","culprit":"Notes.Store.Save",
        "occurrences":12,"firstSeen":"2026-10-21T09:00:00.000Z","lastSeen":"2026-10-21T12:59:00.000Z",
        "lastComponent":"notes-api"}},
      {"_tag":"incident","project":"notes","incident":{"id":"019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f53",
        "component":"notes-api","subject":"POST /api/export","title":"POST /api/export: 18% failed, usually 0.1%",
        "evidence":{"_tag":"failing","operation":"POST /api/export","failed":18,"count":100,"usualRate":0.001},
        "openedAt":"2026-10-21T12:00:00.000Z","acknowledgedAt":"2026-10-21T12:10:00.000Z"}},
      {"_tag":"error","project":"notes","isNew":true,"ongoing":false,"error":{"id":"5a2d0b3f8c4e6179",
        "kind":"exception","title":"TimeoutException: Export took too long","culprit":"Notes.Export.Run",
        "occurrences":3,"firstSeen":"2026-10-21T10:00:00.000Z","lastSeen":"2026-10-21T10:30:00.000Z",
        "lastComponent":"notes-api"}}
    ],
    "projects":[{"key":"notes","name":"Notes","createdAt":"2026-10-01T10:00:00.000Z"}],
    "unanswered":[],
    "pulses":[
      {"project":"notes","load":[],
       "people":{"latest":{"day":"2026-10-20","people":900,"installations":950,"sessions":2000,"foregroundMs":5000000},
         "weekBefore":{"day":"2026-10-13","people":1000,"installations":1050,"sessions":2100,"foregroundMs":4800000}}}
    ],
    "at":"2026-10-21T13:00:00.000Z"}
    """#

struct ProductLineTests {
    private func today(_ answer: String) async throws -> TodayModel {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/today", 200, answer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let today = try #require(pairing.models?.today)
        await today.load()
        return today
    }

    @Test func `says each product's news in Today's order, the steady ones after, each leading where it should`()
        async throws
    {
        let today = try await today(nowAnswer)
        let notes = ProductLine.lines(of: try #require(today.project("notes")))
        #expect(notes.map(\.product) == [.uptime, .releases, .errors, .performance, .analytics])
        #expect(notes.map(\.tone) == [.failure, .release, .steady, .steady, .steady])
        // A line opens its product's screen, even when it is about one thing, which has its own row.
        #expect(notes[0].route == .incidents(project: "notes"))
        #expect(notes[0].rows.map(\.route) == [.incident(project: "notes", id: "019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f53")])
        #expect(notes[2].route == .errors(of: .project("notes")))
        #expect(notes[3].says == .load(operations: 2_100, failed: 15))
        #expect(notes[4].says == .people(daily: 1_284, percent: 6))

        // Today puts a slower operation before a promotion that failed, red as the promotion is.
        let atlas = ProductLine.lines(of: try #require(today.project("atlas")))
        #expect(atlas.map(\.product) == [.performance, .releases, .uptime, .errors])
        #expect(atlas[1].tone == .failure)
        // One slower operation: Performance opens all of them, and the operation is a row of its own.
        #expect(atlas[0].route == .operations(of: .project("atlas")))
        #expect(
            atlas[0].rows.map(\.route) == [
                .operation(
                    OperationRef(project: "atlas", component: "atlas-api", environment: "prod", name: "GET /api/search")
                )
            ])

        // Without load or people, Performance and Analytics have nothing to say.
        #expect(ProductLine.lines(of: try #require(today.project("kiln"))).map(\.product) == [.uptime, .errors])
    }

    @Test func `counts errors once each, says an acknowledged incident, and a fall in people of a tenth`() async throws
    {
        let notes = ProductLine.lines(of: try #require(try await today(linesAnswer).project("notes")))
        #expect(notes.map(\.product) == [.errors, .uptime, .analytics])
        #expect(notes[0].tone == .failure)
        #expect(notes[0].says == .errors(now: 1, new: 1))
        #expect(notes[0].rows.count == 2)
        #expect(notes[1].tone == .warning)
        #expect(notes[2].tone == .warning)
        #expect(notes[2].says == .people(daily: 900, percent: -10))
    }

    @Test func `has no line for a project that didn't answer, and says its rows are unknown, Releases aside`()
        async throws
    {
        let quiet = try #require(try await today(nowAnswer).project("quiet"))
        #expect(ProductLine.lines(of: quiet).isEmpty)
        let rows = ProductLine.rows(of: quiet, delivery: nil)
        #expect(rows.map(\.product) == [.uptime, .errors, .performance, .releases, .analytics, .logs])
        #expect(rows.map(\.tone) == [.unknown, .unknown, .unknown, .unknown, .unknown, .quiet])
        #expect(rows.allSatisfy { $0.route == $0.product.route(of: "quiet") })
    }

    @Test func `leads a project that went silent to its tech, never back to the project itself`() async throws {
        let today = try await today(
            #"""
            {"items":[{"_tag":"silent","project":"notes","lastDataAt":"2026-10-18T13:00:00.000Z"}],
             "projects":[{"key":"notes","name":"Notes","createdAt":"2026-10-01T10:00:00.000Z"}],
             "unanswered":[],"at":"2026-10-21T13:00:00.000Z"}
            """#)
        let notes = try #require(today.project("notes"))
        let performance = try #require(ProductLine.lines(of: notes).first { $0.product == .performance })
        #expect(performance.route == .operations(of: .project("notes")))
        #expect(performance.rows.map(\.route) == [.tech(project: "notes")])
    }

    // Today with no items, of Alpha and Zulu, whose daily people are these against a week before.
    private func peopleAnswer(alpha: (Int, Int), zulu: (Int, Int)) -> String {
        func pulse(_ key: String, _ people: (Int, Int)) -> String {
            #"{"project":"\#(key)","load":[],"people":{"latest":{"day":"2026-10-20","people":\#(people.0),"installations":1,"sessions":1,"foregroundMs":1},"weekBefore":{"day":"2026-10-13","people":\#(people.1),"installations":1,"sessions":1,"foregroundMs":1}}}"#
        }
        return #"""
            {"items":[],"projects":[{"key":"alpha","name":"Alpha","createdAt":"2026-10-01T10:00:00.000Z"},
              {"key":"zulu","name":"Zulu","createdAt":"2026-10-01T10:00:00.000Z"}],
             "unanswered":[],"pulses":[\#(pulse("alpha", alpha)),\#(pulse("zulu", zulu))],"at":"2026-10-21T13:00:00.000Z"}
            """#
    }

    @Test func `rounds a move in people as the web does, says a rise without asking for anything`() async throws {
        let moved = try await today(peopleAnswer(alpha: (181, 200), zulu: (112, 100)))
        let alpha = ProductLine.lines(of: try #require(moved.project("alpha")))
        let zulu = ProductLine.lines(of: try #require(moved.project("zulu")))
        // 181 against 200 is a fall of 9.5%: 10 in whole percent, half away from zero.
        #expect(alpha.map(\.says) == [.people(daily: 181, percent: -10), .noIncidents, .nothingNew])
        #expect(alpha.first?.tone == .warning)
        #expect(zulu.first { $0.product == .analytics }?.says == .people(daily: 112, percent: 12))
        #expect(zulu.allSatisfy { !$0.tone.isNews })
        let steady = try await today(peopleAnswer(alpha: (182, 200), zulu: (100, 100)))
        #expect(ProductLine.lines(of: try #require(steady.project("alpha"))).first?.tone == .steady)
    }

    @Test func `lists projects with news from Today's items first, then news from the pulse alone`() async throws {
        let pulseOnly = try await today(peopleAnswer(alpha: (100, 100), zulu: (50, 100)))
        #expect(ProductLine.newsFirst(try #require(pulseOnly.projects)).map(\.key) == ["zulu", "alpha"])
        let items = try await today(nowAnswer)
        // Notes and Atlas have items; Kiln and Quiet none.
        #expect(ProductLine.newsFirst(try #require(items.projects)).map(\.key) == ["notes", "atlas", "kiln", "quiet"])
    }
}
