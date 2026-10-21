import CluenoriClient
import CluenoriScreens
import Foundation
import Testing

let releasesAnswer = #"""
    {"releases":[
      {"component":"notes-api","environment":"production","release":"2026.10.21-e91f09c",
        "firstSeen":"2026-10-21T09:12:00.000Z","lastSeen":"2026-10-21T13:41:00.000Z","count":12400,"errors":52,
        "previous":"2026.10.20-a1b2c3d","verdict":"worse","slower":2,"failingMore":0,"newErrors":1},
      {"component":"notes-api","environment":"production","release":"2026.10.20-a1b2c3d",
        "firstSeen":"2026-10-20T08:00:00.000Z","lastSeen":"2026-10-21T09:13:00.000Z","count":48210,"errors":31,
        "previous":"2026.10.18-77d0e4a","verdict":"same","slower":0,"failingMore":0,"newErrors":0},
      {"component":"notes-web","release":"1.8.0","firstSeen":"2026-10-21T12:30:00.000Z",
        "lastSeen":"2026-10-21T13:00:00.000Z","count":40,"errors":0,"verdict":"first","slower":0,"failingMore":0,
        "newErrors":0}
    ]}
    """#

let releaseAnswer = #"""
    {"summary":{"component":"notes-api","environment":"production","release":"2026.10.21-e91f09c",
      "firstSeen":"2026-10-21T09:12:00.000Z","lastSeen":"2026-10-21T13:41:00.000Z","count":12400,"errors":52,
      "previous":"2026.10.20-a1b2c3d","verdict":"worse","slower":2,"failingMore":0,"newErrors":1},
    "slower":[
      {"operation":"GET /api/feed","count":5200,"errors":4,"p95Ms":210,"previousCount":20110,"previousErrors":12,
        "previousP95Ms":106},
      {"operation":"GET /api/notes/{id}","count":3100,"errors":0,"p95Ms":480,"previousCount":11800,
        "previousErrors":2,"previousP95Ms":300}
    ],
    "failingMore":[],
    "faster":[
      {"operation":"POST /api/notes","count":900,"errors":1,"p95Ms":140,"previousCount":3400,"previousErrors":3,
        "previousP95Ms":260}
    ],
    "failingLess":[],
    "newOperations":["POST /api/notes/{id}/share"],
    "newErrors":[{"id":"4f1c9a2e7b3d5068","kind":"exception","title":"NpgsqlException: Failed to connect",
      "culprit":"Notes.Store.Save","occurrences":7,"firstSeen":"2026-10-21T09:20:00.000Z",
      "firstRelease":"2026.10.21-e91f09c","lastSeen":"2026-10-21T11:00:00.000Z","lastComponent":"notes-api",
      "lastEnvironment":"production","lastRelease":"2026.10.21-e91f09c"}],
    "incidents":[{"id":"019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f53","component":"notes-api","environment":"production",
      "subject":"GET /api/feed","title":"GET /api/feed: p95 210 ms, usually 106 ms",
      "evidence":{"_tag":"failing","operation":"GET /api/feed","failed":18,"count":100,"usualRate":0.001},
      "openedAt":"2026-10-21T10:02:00.000Z","resolvedAt":"2026-10-21T10:14:00.000Z"}]}
    """#

let feedRelease = ReleaseRef(
    project: "notes", component: "notes-api", environment: "production", version: "2026.10.21-e91f09c")

struct ReleasesModelTests {
    @Test func `lists the releases that ran in the period, the latest first, each with what its verdict counts`()
        async throws
    {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/releases", 200, releasesAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let releases = try #require(pairing.models).releases("notes", period: .week)

        await releases.list.load()

        let list = try #require(releases.list.value).releases
        #expect(list.map(\.release) == ["2026.10.21-e91f09c", "2026.10.20-a1b2c3d", "1.8.0"])
        #expect(list[0].verdict == .worse)
        #expect((list[0].slower, list[0].failingMore, list[0].newErrors) == (2, 0, 1))
        #expect(list[0].previous == "2026.10.20-a1b2c3d")
        // A component that doesn't say where it runs, and a release with none before it, say so.
        #expect(list[2].environment == nil)
        #expect(list[2].previous == nil)
        #expect(list[2].verdict == .first)
        #expect(releases.list.problem == nil)
    }

    @Test func `shows the releases the project's overview asked for, over the same period`() async throws {
        let deployment = notesDeployment()
        let pairing = PairingModel(
            store: MemoryStore(paired), details: details, transport: deployment.transport,
            cacheDirectory: try cacheDirectory())
        let models = try #require(pairing.models)
        let project = models.project("notes", period: .day)
        await project.refresh()
        #expect(project.releases.value?.releases.count == 3)

        let releases = models.releases("notes", period: .day)
        #expect(releases.list.value?.releases.count == 3)
    }

    @Test func `keeps the releases it showed when the phone is offline, and says so`() async throws {
        let directory = try cacheDirectory()
        let online = FakeDeployment()
        online.answer("GET /api/projects/notes/releases", 200, releasesAnswer)
        let first = PairingModel(
            store: MemoryStore(paired), details: details, transport: online.transport, cacheDirectory: directory)
        await first.models?.releases("notes", period: .day).list.load()

        let offline = FakeDeployment()
        offline.setOffline(true)
        let next = PairingModel(
            store: MemoryStore(paired), details: details, transport: offline.transport, cacheDirectory: directory)
        let releases = try #require(next.models).releases("notes", period: .day)
        #expect(releases.list.value?.releases.count == 3)

        await releases.list.load()

        #expect(releases.list.value?.releases.count == 3)
        #expect(releases.list.problem == .unreachable)
        #expect(releases.list.receivedAt != nil)
        #expect(next.state == .paired)
    }

    @Test func `knows nothing of releases until the deployment answers, rather than showing none`() async throws {
        let offline = FakeDeployment()
        offline.setOffline(true)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: offline.transport)
        let releases = try #require(pairing.models).releases("notes", period: .day)

        await releases.list.load()

        #expect(releases.list.value == nil)
        #expect(releases.list.problem == .unreachable)
    }
}

struct ReleaseModelTests {
    @Test func `compares a release with the one before it, the biggest change first`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/releases/notes-api/2026.10.21-e91f09c", 200, releaseAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let release = try #require(pairing.models).release(feedRelease)

        await release.detail.load()

        let detail = try #require(release.detail.value)
        #expect(detail.summary.previous == "2026.10.20-a1b2c3d")
        #expect(detail.slower.map(\.operation) == ["GET /api/feed", "GET /api/notes/{id}"])
        #expect((detail.slower[0].p95Ms, detail.slower[0].previousP95Ms) == (210, 106))
        #expect(detail.failingMore.isEmpty)
        #expect(detail.faster.first?.previousP95Ms == 260)
        #expect(detail.newOperations == ["POST /api/notes/{id}/share"])
        #expect(detail.newErrors.map(\.id) == ["4f1c9a2e7b3d5068"])
        #expect(detail.incidents.first?.resolvedAt != nil)
        // The same release is one screen, whatever the period.
        #expect(try #require(pairing.models).release(feedRelease) === release)
    }

    @Test func `says a release isn't counted, rather than that the answer can't be read`() async throws {
        let deployment = FakeDeployment()
        deployment.answer(
            "GET /api/projects/notes/releases/notes-api/2.4.0%2B312",
            404,
            #"{"_tag":"ReleaseNotFound","component":"notes-api","release":"2.4.0+312"}"#
        )
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let release = try #require(pairing.models).release(
            ReleaseRef(project: "notes", component: "notes-api", environment: nil, version: "2.4.0+312"))

        await release.detail.load()

        #expect(release.detail.value == nil)
        #expect(release.detail.problem == .missing)
        #expect(pairing.state == .paired)
    }

    @Test func `opens with the comparison it kept, and keeps it offline`() async throws {
        let directory = try cacheDirectory()
        let online = FakeDeployment()
        online.answer("GET /api/projects/notes/releases/notes-api/2026.10.21-e91f09c", 200, releaseAnswer)
        let first = PairingModel(
            store: MemoryStore(paired), details: details, transport: online.transport, cacheDirectory: directory)
        await first.models?.release(feedRelease).detail.load()

        let offline = FakeDeployment()
        offline.setOffline(true)
        let next = PairingModel(
            store: MemoryStore(paired), details: details, transport: offline.transport, cacheDirectory: directory)
        let release = try #require(next.models).release(feedRelease)
        #expect(release.detail.value?.slower.count == 2)

        await release.detail.load()

        #expect(release.detail.value?.slower.count == 2)
        #expect(release.detail.problem == .unreachable)
    }

    @Test func `keeps another environment's release of the same version apart`() async throws {
        let directory = try cacheDirectory()
        let online = FakeDeployment()
        online.answer("GET /api/projects/notes/releases/notes-api/2026.10.21-e91f09c", 200, releaseAnswer)
        let pairing = PairingModel(
            store: MemoryStore(paired), details: details, transport: online.transport, cacheDirectory: directory)
        let models = try #require(pairing.models)
        await models.release(feedRelease).detail.load()

        let staging = models.release(
            ReleaseRef(project: "notes", component: "notes-api", environment: "staging", version: "2026.10.21-e91f09c"))
        #expect(staging.detail.value == nil)
    }
}
