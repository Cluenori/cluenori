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
    ],
    "problems":[]}
    """#

/// Releases with what GitHub, App Store Connect, and a deploy report say of them: a release with its
/// tag and deploy, a build only App Store Connect knows, and a build in its phased release; and a
/// repository GitHub refused.
let sourcedReleasesAnswer = #"""
    {"releases":[
      {"component":"notes-api","environment":"production","release":"2026.10.21-e91f09c",
        "firstSeen":"2026-10-21T09:12:00.000Z","lastSeen":"2026-10-21T13:41:00.000Z","count":12400,"errors":52,
        "previous":"2026.10.20-a1b2c3d","verdict":"worse","slower":2,"failingMore":0,"newErrors":1,
        "commit":{"sha":"e91f09c4b2a7d1e8f3c6b5a49d0e2f7a1c3b5d8e","tag":"v1.4.2","message":"Cache the feed",
          "author":"sam","committedAt":"2026-10-21T08:50:00.000Z",
          "url":"https://github.com/acme/notes/commit/e91f09c4b2a7d1e8f3c6b5a49d0e2f7a1c3b5d8e"},
        "deployedAt":"2026-10-21T09:10:00.000Z"},
      {"component":"notes-ios","release":"2.5.0+318","previous":"2.4.0+312","verdict":"unmeasured","slower":0,
        "failingMore":0,"newErrors":0,
        "store":{"version":"2.5.0","buildNumber":"318","uploadedAt":"2026-10-21T08:00:00.000Z","stage":"testing",
          "internalTesting":"IN_BETA_TESTING"}},
      {"component":"notes-ios","release":"2.4.0+312","firstSeen":"2026-10-14T10:00:00.000Z",
        "lastSeen":"2026-10-21T13:40:00.000Z","count":950,"errors":3,"verdict":"first","slower":0,"failingMore":0,
        "newErrors":0,"commit":{"sha":"77d0e4a9c1b2d3e4f5a6b7c8d9e0f1a2b3c4d5e6"},
        "store":{"version":"2.4.0","buildNumber":"312","uploadedAt":"2026-10-14T08:00:00.000Z","stage":"releasing",
          "appStoreState":"READY_FOR_SALE","phasedRelease":{"state":"ACTIVE","startedAt":"2026-10-19T00:00:00.000Z",
          "day":3}}}
    ],
    "problems":[{"component":"notes-web","source":"github",
      "problem":"GitHub refused the token: it can't read acme/notes-web.","at":"2026-10-21T12:00:00.000Z"}]}
    """#

/// A release with what changed in its repository since the release before.
let changedReleaseAnswer = #"""
    {"summary":{"component":"notes-api","environment":"production","release":"2026.10.21-e91f09c",
      "firstSeen":"2026-10-21T09:12:00.000Z","lastSeen":"2026-10-21T13:41:00.000Z","count":12400,"errors":52,
      "previous":"2026.10.20-a1b2c3d","verdict":"worse","slower":2,"failingMore":0,"newErrors":1,
      "commit":{"sha":"e91f09c4b2a7d1e8f3c6b5a49d0e2f7a1c3b5d8e","tag":"v1.4.2"}},
    "slower":[],"failingMore":[],"faster":[],"failingLess":[],"newOperations":[],"errors":[],"incidents":[],
    "changes":{"totalCommits":3,
      "commits":[
        {"sha":"e91f09c4b2a7d1e8f3c6b5a49d0e2f7a1c3b5d8e","message":"Cache the feed (#41)","author":"sam",
          "committedAt":"2026-10-21T08:50:00.000Z",
          "url":"https://github.com/acme/notes/commit/e91f09c4b2a7d1e8f3c6b5a49d0e2f7a1c3b5d8e","pullRequest":41},
        {"sha":"c3b5d8e1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7","message":"Retry the store's connection","author":"ana",
          "committedAt":"2026-10-20T17:30:00.000Z"}
      ],
      "pullRequests":[{"number":41,"title":"Cache the feed","author":"sam",
        "url":"https://github.com/acme/notes/pull/41","labels":["performance"]}],
      "filesChanged":12,"additions":340,"deletions":120,
      "url":"https://github.com/acme/notes/compare/a1b2c3d...e91f09c"},
    "problems":[{"component":"notes-api","source":"github","problem":"GitHub answered 502 three times in a row.",
      "at":"2026-10-21T12:00:00.000Z"}],
    "promotions":[],"deployTargets":[],"notes":[]}
    """#

/// A build only App Store Connect knows: nothing measured, and nothing compared.
let storeOnlyReleaseAnswer = #"""
    {"summary":{"component":"notes-ios","release":"2.5.0+318","previous":"2.4.0+312","verdict":"unmeasured",
      "slower":0,"failingMore":0,"newErrors":0,
      "store":{"version":"2.5.0","buildNumber":"318","uploadedAt":"2026-10-21T08:00:00.000Z","stage":"inReview",
        "appStoreState":"IN_REVIEW","internalTesting":"IN_BETA_TESTING","externalTesting":"WAITING_FOR_BETA_REVIEW"}},
    "slower":[],"failingMore":[],"faster":[],"failingLess":[],"newOperations":[],"errors":[],"incidents":[],
    "problems":[],"promotions":[],"deployTargets":[],"notes":[]}
    """#

let releaseAnswer = #"""
    {"summary":{"component":"notes-api","environment":"production","release":"2026.10.21-e91f09c",
      "firstSeen":"2026-10-21T09:12:00.000Z","lastSeen":"2026-10-21T13:41:00.000Z","count":12400,"errors":52,
      "previous":"2026.10.20-a1b2c3d","verdict":"worse","slower":2,"failingMore":0,"newErrors":1},
    "life":{"step":"1h",
      "points":[{"start":"2026-10-21T09:00:00.000Z","requests":4000,"failed":20,"p95Ms":200,"warnings":8,"errors":5},
        {"start":"2026-10-21T10:00:00.000Z","warnings":2}],
      "totals":{"from":"2026-10-21T09:00:00.000Z","to":"2026-10-21T12:00:00.000Z","requests":12400,"failed":52,
        "warnings":24,"errors":17,"logsFrom":"2026-10-21T09:00:00.000Z"},
      "previous":{"from":"2026-10-20T09:00:00.000Z","to":"2026-10-21T09:00:00.000Z","requests":60000,"failed":120}},
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
    "errors":[{"id":"4f1c9a2e7b3d5068","kind":"exception","title":"NpgsqlException: Failed to connect",
      "culprit":"Notes.Store.Save","occurrences":7,"firstSeen":"2026-10-21T09:20:00.000Z",
      "firstRelease":"2026.10.21-e91f09c","lastSeen":"2026-10-21T11:00:00.000Z","lastComponent":"notes-api",
      "lastEnvironment":"production","lastRelease":"2026.10.21-e91f09c"}],
    "incidents":[{"id":"019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f53","component":"notes-api","environment":"production",
      "subject":"GET /api/feed","title":"GET /api/feed: p95 210 ms, usually 106 ms",
      "evidence":{"_tag":"failing","operation":"GET /api/feed","failed":18,"count":100,"usualRate":0.001},
      "openedAt":"2026-10-21T10:02:00.000Z","resolvedAt":"2026-10-21T10:14:00.000Z"}],
    "problems":[],"promotions":[],"deployTargets":[],"notes":[]}
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
        let releases = try #require(pairing.models).releases("notes", environment: nil, period: .week)

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

    @Test func `lists one component's releases in every environment, apart from the project's`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/releases", 200, releasesAnswer)
        let pairing = PairingModel(
            store: MemoryStore(paired), details: details, transport: deployment.transport,
            cacheDirectory: try cacheDirectory())
        let models = try #require(pairing.models)
        let releases = models.releases("notes", component: "notes-api", period: .day)

        await releases.list.load()

        #expect(releases.component == "notes-api" && releases.environment == nil)
        let asked = try #require(deployment.queries("/api/projects/notes/releases").first)
        #expect(asked["component"] == "notes-api")
        #expect(asked["environment"] == nil)
        // The project's releases are another question, kept apart.
        #expect(models.releases("notes", environment: nil, period: .day).list.value == nil)
    }

    @Test func `keeps the releases it showed when the phone is offline, and says so`() async throws {
        let directory = try cacheDirectory()
        let online = FakeDeployment()
        online.answer("GET /api/projects/notes/releases", 200, releasesAnswer)
        let first = PairingModel(
            store: MemoryStore(paired), details: details, transport: online.transport, cacheDirectory: directory)
        await first.models?.releases("notes", environment: nil, period: .day).list.load()

        let offline = FakeDeployment()
        offline.setOffline(true)
        let next = PairingModel(
            store: MemoryStore(paired), details: details, transport: offline.transport, cacheDirectory: directory)
        let releases = try #require(next.models).releases("notes", environment: nil, period: .day)
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
        let releases = try #require(pairing.models).releases("notes", environment: nil, period: .day)

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
        // Its life, a step it knows nothing of left unknown rather than 0, and the release before's.
        #expect(detail.life?.points.last?.requests == nil)
        #expect(detail.life?.previous?.warnings == nil)
        #expect(detail.life?.totals.rate(12400, per: .hour) == 12400.0 / 3)
        #expect(detail.errors.map(\.id) == ["4f1c9a2e7b3d5068"])
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

struct ReleaseSourcesTests {
    @Test func `shows each release's commit, deploy, and store build, each only when known`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/releases", 200, sourcedReleasesAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let releases = try #require(pairing.models).releases("notes", environment: nil, period: .week)

        await releases.list.load()

        let list = try #require(releases.list.value).releases
        // A tag names a commit; without one, its short SHA does.
        #expect(list[0].commit?.name == "v1.4.2")
        #expect(list[0].commit?.url == "https://github.com/acme/notes/commit/e91f09c4b2a7d1e8f3c6b5a49d0e2f7a1c3b5d8e")
        #expect(list[0].deployedAt == (try Date("2026-10-21T09:10:00Z", strategy: .iso8601)))
        #expect(list[0].store == nil)
        #expect(list[2].commit?.name == "77d0e4a")
        #expect(list[2].commit?.message == nil)
        #expect(list[2].store?.stage == .releasing)
        #expect(list[2].store?.phasedRelease?.day == 3)
        #expect(list[2].deployedAt == nil)
    }

    @Test func `shows a build only App Store Connect knows as unmeasured, without counts it doesn't have`()
        async throws
    {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/releases", 200, sourcedReleasesAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let releases = try #require(pairing.models).releases("notes", environment: nil, period: .week)

        await releases.list.load()

        let build = try #require(releases.list.value?.releases[1])
        #expect(build.verdict == .unmeasured)
        // Missing, not zero: nothing ran, so nothing is counted.
        #expect(build.count == nil)
        #expect(build.errors == nil)
        #expect(build.firstSeen == nil)
        #expect(build.lastSeen == nil)
        #expect(build.environment == nil)
        #expect(build.store?.stage == .testing)
        #expect(build.store?.internalTesting == "IN_BETA_TESTING")
        #expect(
            build.ref(in: "notes")
                == ReleaseRef(project: "notes", component: "notes-ios", environment: nil, version: "2.5.0+318"))
    }

    @Test func `says which sources couldn't be read, so missing commits and builds aren't taken for none`()
        async throws
    {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/releases", 200, sourcedReleasesAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let releases = try #require(pairing.models).releases("notes", environment: nil, period: .week)

        await releases.list.load()

        let problems = try #require(releases.list.value).problems
        #expect(problems.count == 1)
        #expect(problems[0].component == "notes-web")
        #expect(problems[0].source == .github)
        #expect(problems[0].problem == "GitHub refused the token: it can't read acme/notes-web.")
    }

    @Test func `shows what changed since the release before: its pull requests, commits, and files`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/releases/notes-api/2026.10.21-e91f09c", 200, changedReleaseAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let release = try #require(pairing.models).release(feedRelease)

        await release.detail.load()

        let changes = try #require(release.detail.value?.changes)
        #expect(changes.totalCommits == 3)
        #expect(changes.commits.map(\.shortSha) == ["e91f09c", "c3b5d8e"])
        #expect(changes.commits[0].pullRequest == 41)
        // A commit only a deploy report listed has no page on GitHub.
        #expect(changes.commits[1].url == nil)
        #expect(changes.pullRequests.map(\.number) == [41])
        #expect(changes.pullRequests[0].labels == ["performance"])
        #expect((changes.filesChanged, changes.additions, changes.deletions) == (12, 340, 120))
        #expect(changes.url == "https://github.com/acme/notes/compare/a1b2c3d...e91f09c")
    }

    @Test func `says which sources couldn't be read lately for a release, beside what they leave out`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/releases/notes-api/2026.10.21-e91f09c", 200, changedReleaseAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let release = try #require(pairing.models).release(feedRelease)

        await release.detail.load()

        let problems = try #require(release.detail.value).problems
        #expect(problems.map(\.source) == [.github])
        #expect(problems.first?.component == "notes-api")
        #expect(problems.first?.problem == "GitHub answered 502 three times in a row.")
    }

    @Test func `shows a release only App Store Connect knows, with its build and nothing compared`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/releases/notes-ios/2.5.0%2B318", 200, storeOnlyReleaseAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let release = try #require(pairing.models).release(
            ReleaseRef(project: "notes", component: "notes-ios", environment: nil, version: "2.5.0+318"))

        await release.detail.load()

        let detail = try #require(release.detail.value)
        #expect(detail.summary.verdict == .unmeasured)
        #expect(detail.summary.count == nil)
        #expect(detail.summary.store?.stage == .inReview)
        #expect(detail.summary.store?.externalTesting == "WAITING_FOR_BETA_REVIEW")
        #expect(detail.changes == nil)
        #expect(detail.slower.isEmpty && detail.errors.isEmpty && detail.incidents.isEmpty)
    }

    @Test func `compares lives of different lengths in an hour under a day, and in a day over it`() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        // 3 hours, 900 requests: 300 an hour.
        let short = LifeTotals(from: start, to: start.addingTimeInterval(3 * 3_600), requests: 900)
        #expect(short.rateUnit == .hour)
        #expect(short.rate(900, per: .hour) == 300)
        // 6 days, 900 requests: 150 a day, and the shorter life in the same unit.
        let long = LifeTotals(from: start, to: start.addingTimeInterval(6 * 86_400), requests: 900, failed: 9)
        #expect(long.rateUnit == .day)
        #expect(long.rate(900, per: .day) == 150)
        #expect(short.rate(900, per: .day) == 7_200)
        // A minute's life counts as an hour, not sixty times its runs.
        #expect(LifeTotals(from: start, to: start.addingTimeInterval(60)).rate(10, per: .hour) == 10)
        #expect(long.failedShare == 0.01)
        #expect(short.failedShare == nil)
    }

    @Test func `keeps a zoom of a life within it and at least three steps wide`() {
        #expect(LifeWindow.within(from: 9, to: 4, steps: 20) == LifeWindow(first: 4, last: 9))
        #expect(LifeWindow.within(from: 19, to: 19, steps: 20) == LifeWindow(first: 17, last: 19))
        #expect(LifeWindow.within(from: -3, to: 40, steps: 20).isWhole(steps: 20))
        #expect(LifeWindow.within(from: 1, to: 1, steps: 2) == LifeWindow(first: 0, last: 1))
        // A zoom of 72 five-minute steps doesn't fit the same life in 7 hours: it shows it whole.
        #expect(LifeWindow(first: 60, last: 71).within(steps: 7) == .whole(steps: 7))
        #expect(LifeWindow(first: 2, last: 4).within(steps: 7) == LifeWindow(first: 2, last: 4))
        // VoiceOver zooms in and out about the middle, as far as the life and three steps allow.
        #expect(LifeWindow.whole(steps: 10).zoomed(in: true, steps: 10) == LifeWindow(first: 1, last: 7))
        #expect(LifeWindow(first: 4, last: 6).zoomed(in: true, steps: 10) == LifeWindow(first: 4, last: 6))
        #expect(LifeWindow(first: 4, last: 6).zoomed(in: false, steps: 10) == LifeWindow(first: 3, last: 7))
        #expect(LifeWindow.whole(steps: 10).zoomed(in: false, steps: 10).isWhole(steps: 10))
    }

    @Test func `counts warnings of a long life over the part whose logs are kept`() {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        let day: TimeInterval = 86_400
        let long = LifeTotals(
            from: start, to: start.addingTimeInterval(180 * day), warnings: 900,
            logsFrom: start.addingTimeInterval(90 * day))
        #expect(long.logRate(900, per: .day) == 10)
        #expect(long.rate(900, per: .day) == 5)
    }

    @Test func `briefs an agent on a release with the commands and calls that read it whole`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/releases/notes-api/2026.10.21-e91f09c", 200, releaseAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let release = try #require(pairing.models).release(feedRelease)
        await release.detail.load()
        let detail = try #require(release.detail.value)
        #expect(
            releaseBrief(project: "notes", detail: detail) == """
                Find out whether release 2026.10.21-e91f09c of notes-api (production) works, in Cluenori project notes.
                Compare it with the release before it, 2026.10.20-a1b2c3d: Cluenori says "worse".
                It ran from 2026-10-21T09:00:00.000Z to 2026-10-21T12:00:00.000Z.
                Read it whole, step by step: ./cluenori release notes notes-api 2026.10.21-e91f09c --environment production --life
                Its operations: GET /api/projects/notes/operations?component=notes-api&environment=production&release=2026.10.21-e91f09c&from=2026-10-21T09%3A00%3A00.000Z&to=2026-10-21T12%3A00%3A00.000Z
                Its errors: GET /api/projects/notes/errors?component=notes-api&environment=production&release=2026.10.21-e91f09c&from=2026-10-21T09%3A00%3A00.000Z&to=2026-10-21T12%3A00%3A00.000Z
                Its warnings and errors: GET /api/projects/notes/logs?component=notes-api&environment=production&release=2026.10.21-e91f09c&from=2026-10-21T09%3A00%3A00.000Z&to=2026-10-21T12%3A00%3A00.000Z
                """)
    }

    @Test func `opens only https pages from an answer's links`() {
        #expect(URL(webPage: "https://github.com/acme/notes/pull/41") != nil)
        #expect(URL(webPage: "http://github.com/acme/notes/pull/41") == nil)
        #expect(URL(webPage: "javascript:alert(1)") == nil)
        #expect(URL(webPage: "itms-apps://apps.apple.com/app/id1") == nil)
        #expect(URL(webPage: "https:///no-host") == nil)
        #expect(URL(webPage: "") == nil)
    }
}

/// The parameters that narrow a question to the release `feedRelease`.
let feedReleaseFilter = ["component": "notes-api", "environment": "production", "release": "2026.10.21-e91f09c"]

/// The parameters of `query` that narrow a question: its component, environment, and release.
func narrowing(_ query: [String: String]?) -> [String: String] {
    (query ?? [:]).filter { ["component", "environment", "release"].contains($0.key) }
}

struct ReleaseTelemetryTests {
    @Test func `asks for a release's operations alone, by its component, environment, and version`() async throws {
        let deployment = notesDeployment()
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let models = try #require(pairing.models)

        let operations = models.operations(.release(feedRelease), period: .day)
        await operations.table.load()

        #expect(operations.table.value?.rows.count == 1)
        let query = try #require(deployment.queries("/api/projects/notes/operations").last)
        #expect(narrowing(query) == feedReleaseFilter)
        #expect(query["from"] != nil && query["to"] != nil)

        // The project's, the same screen without the release, asks for every release.
        await models.operations(.project("notes"), period: .day).table.load()
        #expect(narrowing(deployment.queries("/api/projects/notes/operations").last).isEmpty)
    }

    @Test func `asks for a release's errors, and one of them in that release`() async throws {
        let deployment = notesDeployment()
        deployment.answer(
            "GET /api/projects/notes/errors/4f1c9a2e7b3d5068",
            404,
            #"{"_tag":"ErrorGroupNotFound","error":"4f1c9a2e7b3d5068"}"#
        )
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let models = try #require(pairing.models)

        await models.errors(.release(feedRelease), period: .week).table.load()
        let error = models.error(.release(feedRelease), id: "4f1c9a2e7b3d5068", period: .week)
        await error.detail.load()

        #expect(narrowing(deployment.queries("/api/projects/notes/errors").last) == feedReleaseFilter)
        #expect(
            narrowing(deployment.queries("/api/projects/notes/errors/4f1c9a2e7b3d5068").last) == feedReleaseFilter)
        // An error the release doesn't have is missing from it, as from a period.
        #expect(error.detail.problem == .missing)
    }

    @Test func `asks for a release's logs, older pages and filtered ones too`() async throws {
        let deployment = notesDeployment()
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let logs = try #require(pairing.models).logs(.release(feedRelease), period: .day)

        await logs.refresh()
        deployment.answer("GET /api/projects/notes/logs", 200, logsAnswer(ids: 1...100, next: nil))
        await logs.loadOlder()
        await logs.filter(level: .error, search: "timeout")

        let queries = deployment.queries("/api/projects/notes/logs")
        #expect(queries.count == 3)
        #expect(queries.allSatisfy { narrowing($0) == feedReleaseFilter })
        #expect(queries[1]["before"] == "101")
        #expect(queries[2]["level"] == "error" && queries[2]["search"] == "timeout")
    }

    @Test func `asks for an operation in one release, its load and its percentiles alike`() async throws {
        let deployment = notesDeployment()
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let operation = try #require(pairing.models).operation(
            OperationRef(
                project: "notes", component: "notes-api", environment: "production", name: "GET /api/feed",
                release: "2026.10.21-e91f09c"),
            period: .day
        )

        await operation.refresh()

        let load = try #require(deployment.queries("/api/projects/notes/load").last)
        let table = try #require(deployment.queries("/api/projects/notes/operations").last)
        #expect(narrowing(load) == feedReleaseFilter)
        #expect(narrowing(table) == feedReleaseFilter)
        #expect(load["operation"] == "GET /api/feed" && table["operation"] == "GET /api/feed")
    }

    @Test func `narrows to a release of a component that doesn't say where it runs by its component and version`()
        async throws
    {
        let deployment = notesDeployment()
        deployment.answer(
            "GET /api/projects/notes/releases/notes-ios/2.4.0%2B312",
            200,
            #"""
            {"summary":{"component":"notes-ios","release":"2.4.0+312","firstSeen":"2026-10-14T10:00:00.000Z",
              "lastSeen":"2026-10-21T13:40:00.000Z","count":950,"errors":3,"verdict":"first","slower":0,
              "failingMore":0,"newErrors":0},
            "slower":[],"failingMore":[],"faster":[],"failingLess":[],"newOperations":[],"errors":[],
            "incidents":[],"problems":[],"promotions":[],"deployTargets":[],"notes":[]}
            """#
        )
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let build = ReleaseRef(project: "notes", component: "notes-ios", environment: nil, version: "2.4.0+312")

        try await #require(pairing.models).errors(.release(build), period: .day).table.load()

        #expect(
            narrowing(deployment.queries("/api/projects/notes/errors").last)
                == ["component": "notes-ios", "release": "2.4.0+312"])
    }

    @Test func `keeps a release's answers apart from the project's, and shows them offline`() async throws {
        let directory = try cacheDirectory()
        let online = notesDeployment()
        let first = PairingModel(
            store: MemoryStore(paired), details: details, transport: online.transport, cacheDirectory: directory)
        await first.models?.operations(.release(feedRelease), period: .day).table.load()

        let offline = FakeDeployment()
        offline.setOffline(true)
        let next = PairingModel(
            store: MemoryStore(paired), details: details, transport: offline.transport, cacheDirectory: directory)
        let models = try #require(next.models)
        let release = models.operations(.release(feedRelease), period: .day)
        #expect(release.table.value?.rows.count == 1)
        // The project's own operations were never asked, so the phone has none of them to show.
        #expect(models.operations(.project("notes"), period: .day).table.value == nil)

        await release.table.load()

        #expect(release.table.value?.rows.count == 1)
        #expect(release.table.problem == .unreachable)
        #expect(release.table.receivedAt != nil)
    }

    @Test func `opens the project's operations and errors with what its overview kept`() async throws {
        let deployment = notesDeployment()
        let pairing = PairingModel(
            store: MemoryStore(paired), details: details, transport: deployment.transport,
            cacheDirectory: try cacheDirectory())
        let models = try #require(pairing.models)
        await models.project("notes", environment: nil, period: .day).refresh()

        #expect(models.operations(.project("notes"), period: .day).table.value?.count == 120)
        #expect(models.errors(.project("notes"), period: .day).table.value != nil)
        #expect(models.operations(.release(feedRelease), period: .day).table.value == nil)
    }
}
