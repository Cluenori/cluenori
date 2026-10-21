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
                    openedAt: Date(timeIntervalSince1970: 1_792_584_000),
                    acknowledged: false
                ))
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
