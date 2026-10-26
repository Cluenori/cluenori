import CluenoriClient
import CluenoriScreens
import Foundation
import Testing

/// Five days of notes-ios in production: WAU from its seventh day and MAU from its thirtieth aren't
/// known, so no day has them.
let usageAnswer = #"""
    {"covered":{"from":"2026-10-18T00:00:00.000Z","to":"2026-10-22T15:00:00.000Z"},
    "days":[{"day":"2026-10-18","people":700,"installations":740,"sessions":2100,"foregroundMs":1000},
      {"day":"2026-10-19","people":720,"installations":760,"sessions":2200,"foregroundMs":1000},
      {"day":"2026-10-20","people":0,"installations":0,"sessions":0,"foregroundMs":0},
      {"day":"2026-10-21","people":760,"installations":800,"sessions":2300,"foregroundMs":1000},
      {"day":"2026-10-22","people":512,"installations":540,"sessions":1500,"foregroundMs":1000}],
    "people":820,"installations":860,"sessions":8100,"sessionsPerPerson":9.9,
    "releases":[{"component":"notes-ios","environment":"production","release":"0.3.0+20","people":800,
      "installations":840,"sessions":8000}]}
    """#
let emptyUsageAnswer = #"{"days":[],"people":0,"installations":0,"sessions":0,"releases":[]}"#
let retentionAnswer = #"""
    {"cohorts":[{"week":"2026-10-05","people":200,"active":[200,88,40]},
      {"week":"2026-10-12","people":100,"active":[100,30]},{"week":"2026-10-19","people":0,"active":[0]}],
    "currentWeek":"2026-10-19"}
    """#
/// 0.3.0+20, worse on cold launch and crashes than 0.2.0+10; and 0.3.1+21, which sent its cold
/// launches alone: no warm launches, memory, or MetricKit report yet.
let appHealthAnswer = #"""
    {"releases":[
      {"release":{"component":"notes-ios","environment":"production","release":"0.3.1+21",
        "firstSeen":"2026-10-22T14:30:00.000Z","lastSeen":"2026-10-22T15:00:00.000Z","previous":"0.3.0+20"},
       "health":{"sessions":46,"people":41,"prewarmed":3,
        "cold":{"launches":40,"firstFrameP50Ms":610,"firstFrameP95Ms":1310}},
       "verdict":"tooEarly","worse":[],"better":[]},
      {"release":{"component":"notes-ios","environment":"production","release":"0.3.0+20",
        "firstSeen":"2026-10-16T10:00:00.000Z","lastSeen":"2026-10-22T15:00:00.000Z","previous":"0.2.0+10"},
       "health":{"sessions":40100,"people":4980,"prewarmed":96,
        "cold":{"launches":412,"firstFrameP50Ms":640,"firstFrameP95Ms":1400,
          "ready":{"launches":380,"p50Ms":860,"p95Ms":1800}},
        "warm":{"launches":900,"firstFrameP50Ms":180,"firstFrameP95Ms":320},
        "memory":{"samples":900,"peakP95Bytes":214000000,"footprintP95Bytes":151000000},
        "diagnostics":{"reports":310,"crashes":1283,"hangs":40,"cpuExceptions":2,"diskWriteExceptions":0}},
       "previousHealth":{"sessions":8100,"people":610,"prewarmed":20,
        "cold":{"launches":300,"firstFrameP50Ms":380,"firstFrameP95Ms":600},
        "warm":{"launches":700,"firstFrameP50Ms":170,"firstFrameP95Ms":300}},
       "crashesPerThousand":32,"hangsPerThousand":1,"previousCrashesPerThousand":4,
       "verdict":"worse","worse":["coldLaunch","crashes"],"better":[]}]}
    """#
let featureUseAnswer = #"""
    {"features":[{"people":812,"events":0,"screens":940},
      {"feature":"cards.flip","people":410,"events":3022,"screens":980,
       "memory":{"samples":200,"peakP95Bytes":312000000,"footprintP95Bytes":190000000}}]}
    """#
let personAnswer = #"""
    {"person":"prs-1","users":["user-1842"],"firstSeen":"2026-09-11T08:00:00.000Z",
    "lastSeen":"2026-10-22T14:46:00.000Z",
    "installations":[{"installation":"inst-1","component":"notes-ios","environment":"production","release":"0.3.0+20",
      "device":{"model":"iPhone17,2","platform":"iOS","osVersion":"27.1","locale":"en_GB","timeZone":"Europe/London"},
      "sdk":{"name":"cluenori-swift","version":"0.1.0"},"firstSeen":"2026-09-11T08:00:00.000Z",
      "lastSeen":"2026-10-22T14:46:00.000Z"}],
    "days":[{"day":"2026-10-22","sessions":3,"foregroundMs":600000}],
    "features":[{"feature":"notes.share","days":3,"events":4,"screens":2,"lastDay":"2026-10-22"},
      {"days":5,"events":0,"screens":9,"lastDay":"2026-10-22"}],
    "timeline":[{"component":"notes-ios","environment":"production","release":"0.3.0+20","installation":"inst-1",
      "signal":{"_tag":"screen","id":"sg-1","at":"2026-10-22T14:40:00.000Z","session":"ses-1","screen":"NoteEditor"}}]}
    """#

/// A paired deployment's models, with `deployment` answering.
func pairedModels(_ deployment: FakeDeployment) throws -> DeploymentModels {
    let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
    return try #require(pairing.models)
}

/// notes-ios's analytics in production over 30 days, every question answered.
func notesAnalytics(usage: String = usageAnswer) async throws -> (AnalyticsModel, FakeDeployment) {
    let deployment = FakeDeployment()
    deployment.answer("GET /api/projects/notes/usage", 200, usage)
    deployment.answer("GET /api/projects/notes/retention", 200, retentionAnswer)
    deployment.answer("GET /api/projects/notes/app-health", 200, appHealthAnswer)
    deployment.answer("GET /api/projects/notes/feature-use", 200, featureUseAnswer)
    let analytics = try pairedModels(deployment).analytics(
        AnalyticsRef(project: "notes", component: "notes-ios", environment: "production"), period: .month)
    await analytics.refresh()
    return (analytics, deployment)
}

struct AnalyticsRouteTests {
    @Test(arguments: [
        ("cluenori://projects/notes/analytics", Route.analytics(AnalyticsRef(project: "notes"))),
        (
            "cluenori://projects/notes/analytics?component=notes-ios&environment=production",
            .analytics(AnalyticsRef(project: "notes", component: "notes-ios", environment: "production"))
        ),
        (
            "cluenori://projects/notes/analytics/features?component=notes-ios",
            .features(AnalyticsRef(project: "notes", component: "notes-ios"))
        ),
        ("cluenori://projects/notes/people?user=user-1842", .person(project: "notes", user: "user-1842")),
        (
            "cluenori://projects/notes/analytics/features/notes.share?environment=production",
            .feature(FeatureRef(project: "notes", key: "notes.share", environment: "production"))
        ),
        (
            "cluenori://projects/notes/analytics/people/prs-1",
            .personByID(project: "notes", person: "prs-1")
        ),
        (
            "cluenori://projects/notes/components/notes-ios/version-policy",
            .versionPolicy(project: "notes", component: "notes-ios")
        ),
        ("cluenori://projects/notes/components/notes-ios/sdk-keys", .sdkKeys(project: "notes", component: "notes-ios")),
    ])
    func `reads the analytics screen a link names`(_ text: String, _ route: Route) throws {
        #expect(Route(try #require(URL(string: text))) == route)
    }

    @Test func `reads the release whose app health a link names`() throws {
        let url = try #require(
            URL(string: "cluenori://projects/notes/analytics/app-health/notes-ios/0.3.0+20?environment=production"))
        #expect(
            Route(url)
                == .appHealth(
                    ReleaseRef(project: "notes", component: "notes-ios", environment: "production", version: "0.3.0+20")
                ))
    }

    @Test(arguments: [
        "cluenori://projects/notes/people",
        "cluenori://projects/notes/analytics/releases",
        "cluenori://projects/notes/analytics/app-health/notes-ios",
    ])
    func `reads no analytics screen from a link that names none`(_ text: String) throws {
        #expect(Route(try #require(URL(string: text))) == nil)
    }

    @Test func `opens a release's app health over its component's analytics, and a person over the project's`() {
        let navigation = Navigation()
        let release = ReleaseRef(
            project: "notes", component: "notes-ios", environment: "production", version: "0.3.0+20")
        navigation.open(.appHealth(release))
        #expect(
            navigation.path == [
                .project("notes"),
                .analytics(AnalyticsRef(project: "notes", component: "notes-ios", environment: "production")),
                .appHealth(release),
            ])

        navigation.open(.person(project: "notes", user: "user-1842"))
        #expect(
            navigation.path == [
                .project("notes"), .analytics(AnalyticsRef(project: "notes")),
                .person(project: "notes", user: "user-1842"),
            ])
    }

    @Test func `shows another component's analytics in place, though the screen on top names no environment`() {
        let navigation = Navigation()
        navigation.open(.analytics(AnalyticsRef(project: "notes")))
        // The screen shows the environment chosen for the project.
        let shown = Route.analytics(AnalyticsRef(project: "notes", environment: "production"))

        navigation.showAnalytics(of: "notes-ios", inPlaceOf: shown)

        #expect(
            navigation.path == [
                .project("notes"),
                .analytics(AnalyticsRef(project: "notes", component: "notes-ios", environment: "production")),
            ])
        navigation.showAnalytics(of: nil, inPlaceOf: navigation.path[1])
        #expect(navigation.path.last == shown)
    }

    @Test func `shows a project's analytics in another environment when one is chosen`() throws {
        let navigation = Navigation()
        navigation.open(.features(AnalyticsRef(project: "notes", component: "notes-ios", environment: "production")))
        let choice = try pairedModels(FakeDeployment()).environments("notes")

        navigation.show("beta", of: choice)

        #expect(
            navigation.path.last
                == .features(AnalyticsRef(project: "notes", component: "notes-ios", environment: "beta")))
    }
}

struct AnalyticsModelTests {
    @Test func `asks each question of the component and environment, from the first of the period's UTC days`()
        async throws
    {
        let (_, deployment) = try await notesAnalytics()

        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = try #require(TimeZone(identifier: "UTC"))
        let today = utc.startOfDay(for: .now)
        let first = try #require(utc.date(byAdding: .day, value: -29, to: today))
        for path in ["usage", "retention", "app-health", "feature-use"] {
            let query = try #require(deployment.queries("/api/projects/notes/\(path)").first)
            #expect(query["component"] == "notes-ios")
            #expect(query["environment"] == "production")
            let from = try Date(
                query["from"] ?? "", strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true))
            #expect(from == first)
        }
    }

    @Test func `charts each day counted, and leaves out what isn't known, never as 0`() async throws {
        let (analytics, _) = try await notesAnalytics()

        let series = analytics.usageSeries
        #expect(series.map(\.kind) == [.dailyPeople, .weeklyPeople, .monthlyPeople, .sessions])
        let daily = try #require(series.first)
        // A day counted with no one is 0: it was counted.
        #expect(daily.points.map(\.value) == [700, 720, 0, 760, 512])
        #expect(daily.latest == 512)
        #expect(daily.latestDay == UTCDay.date("2026-10-22"))
        let weekly = series[1]
        #expect(weekly.points.isEmpty)
        #expect(weekly.latest == nil)
        #expect(weekly.latestDay == UTCDay.date("2026-10-22"))
        #expect(analytics.usageDays.lowerBound == UTCDay.date("2026-09-23"))
        #expect(analytics.usageDays.upperBound == UTCDay.date("2026-10-23"))
        #expect(!analytics.sentNothing)
    }

    @Test func `says the apps sent nothing when no day is counted and no release has health`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/usage", 200, emptyUsageAnswer)
        deployment.answer("GET /api/projects/notes/app-health", 200, #"{"releases":[]}"#)
        let analytics = try pairedModels(deployment).analytics(AnalyticsRef(project: "notes"), period: .week)
        #expect(!analytics.sentNothing)

        await analytics.refresh()

        #expect(analytics.sentNothing)
        #expect(analytics.usageSeries.allSatisfy { $0.points.isEmpty && $0.latest == nil })
    }

    @Test func `gives each cohort's share active each week, the last of the week now so far`() async throws {
        let (analytics, _) = try await notesAnalytics()

        let rows = analytics.retentionRows
        // A cohort of no one has no shares to show.
        #expect(rows.map(\.people) == [200, 100])
        #expect(rows[0].shares == [1, 0.44, 0.2])
        #expect(rows[0].lastIsSoFar)
        #expect(rows[1].shares == [1, 0.3])
        #expect(rows[1].lastIsSoFar)
    }

    @Test func `lists a release's measures beside the release before, and what made its verdict`() async throws {
        let (analytics, _) = try await notesAnalytics()
        let release = ReleaseRef(
            project: "notes", component: "notes-ios", environment: "production", version: "0.3.0+20")
        let health = try #require(analytics.health(of: release))

        #expect(health.verdict == .worse)
        #expect(health.groups.map(\.kind) == [.coldLaunch, .warmLaunch, .memory, .metricKit, .use])
        let cold = health.groups[0].lines
        #expect(cold.map(\.kind) == [.firstFrameP50, .firstFrameP95, .readyP50, .readyP95, .launches])
        #expect(
            cold[1]
                == HealthLine(
                    kind: .firstFrameP95, value: .milliseconds(1400), previous: .milliseconds(600), move: .worse))
        // The release before sent no time to its first useful screen: nothing to show beside it.
        #expect(cold[3].previous == nil)
        #expect(health.groups[1].lines.allSatisfy { $0.move == nil })
        // Memory the release before never sent isn't shown as 0.
        #expect(health.groups[2].lines.allSatisfy { $0.previous == nil })
        let metricKit = health.groups[3].lines
        #expect(
            metricKit.first
                == HealthLine(
                    kind: .crashesPerThousand, value: .perThousand(32), previous: .perThousand(4), move: .worse))
        #expect(metricKit[1] == HealthLine(kind: .hangsPerThousand, value: .perThousand(1), previous: nil, move: nil))
        #expect(metricKit.map(\.kind).suffix(3) == [.crashes, .hangs, .reports])
    }

    @Test func `leaves out every measure a release didn't send`() async throws {
        let (analytics, _) = try await notesAnalytics()
        let release = ReleaseRef(
            project: "notes", component: "notes-ios", environment: "production", version: "0.3.1+21")
        let health = try #require(analytics.health(of: release))

        #expect(health.verdict == .tooEarly)
        #expect(health.groups.map(\.kind) == [.coldLaunch, .use])
        #expect(health.groups[0].lines.map(\.kind) == [.firstFrameP50, .firstFrameP95, .launches])
        // The answer has no health of the release before it: nothing shows beside it.
        #expect(health.groups[0].lines.allSatisfy { $0.previous == nil })
    }

    @Test func `finds no release the period doesn't list`() async throws {
        let (analytics, _) = try await notesAnalytics()
        #expect(
            analytics.health(
                of: ReleaseRef(project: "notes", component: "notes-ios", environment: "beta", version: "0.3.0+20"))
                == nil)
    }

    @Test func `keeps what it showed when the phone goes offline, and says so`() async throws {
        let (analytics, deployment) = try await notesAnalytics()
        deployment.setOffline(true)

        await analytics.refresh()

        #expect(analytics.usage.problem == .unreachable)
        #expect(analytics.usage.value?.people == 820)
        #expect(analytics.featureUse.value?.features.first?.feature == nil)
    }

    @Test func `asks again over another period, keeping the component and environment`() async throws {
        let (analytics, deployment) = try await notesAnalytics()

        await analytics.choose(.quarter)

        #expect(analytics.period == .quarter)
        let queries = deployment.queries("/api/projects/notes/usage")
        #expect(queries.count == 2)
        #expect(queries[1]["component"] == "notes-ios")
        let first = try Date(
            queries[0]["from"] ?? "", strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true))
        let longer = try Date(
            queries[1]["from"] ?? "", strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true))
        #expect(first.timeIntervalSince(longer) == 60 * 86_400)
    }
}

struct PersonTests {
    @Test func `finds a person by the app's user ID for them`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/people", 200, personAnswer)
        let person = try pairedModels(deployment).person("notes", user: "user-1842")

        await person.load()

        #expect(person.person.value?.users == ["user-1842"])
        #expect(person.person.value?.installations.first?.country == nil)
        #expect(deployment.queries("/api/projects/notes/people").first == ["user": "user-1842"])
    }

    @Test func `says no person has a user ID the apps never sent`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/people", 404, #"{"_tag":"PersonNotFound"}"#)
        let person = try pairedModels(deployment).person("notes", user: "user-0000")

        await person.load()

        #expect(person.person.value == nil)
        #expect(person.person.problem == .missing)
    }

    @Test func `opens a person by their ID, with the features they named, and a brief for an agent`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/people/prs-1", 200, personAnswer)
        let person = try pairedModels(deployment).person("notes", id: "prs-1")

        await person.load()

        // What the app marked with no feature isn't a feature of theirs to open.
        #expect(person.features.map(\.feature) == ["notes.share"])
        let brief = try #require(person.agentBrief)
        #expect(brief.contains("./cluenori person notes prs-1"))
        #expect(brief.contains("Features they used, the last first: notes.share"))
    }

    @Test(arguments: [
        (" user-1842 ", "user-1842"), ("8C1F4E2A-55D0-4B7E-9F31-2A6C0D9E7B11", "8C1F4E2A-55D0-4B7E-9F31-2A6C0D9E7B11"),
    ])
    func `takes a user ID as the deployment does`(_ text: String, _ user: String) {
        #expect(PersonModel.userID(text) == user)
    }

    @Test(arguments: ["", "  ", "user 1842", "користувач", String(repeating: "a", count: 129)])
    func `takes no user ID the deployment wouldn't`(_ text: String) {
        #expect(PersonModel.userID(text) == nil)
    }
}

let policiesAnswer = #"""
    {"policies":[{"component":"notes-ios","minimum":"0.2.0","recommended":"0.3.1",
    "storeUrl":"https://apps.apple.com/app/id0000000000","words":[{"locale":"en-US","decision":"require",
    "text":{"title":"Update Notes","message":"This version can't sync any more."}}],
    "setAt":"2026-10-18T10:00:00.000Z"}]}
    """#

/// The notes project's version policies, asked for.
func notesPolicies() async throws -> (VersionPolicyModel, FakeDeployment) {
    let deployment = FakeDeployment()
    deployment.answer("GET /api/projects/notes/version-policies", 200, policiesAnswer)
    let policies = try pairedModels(deployment).versionPolicies("notes")
    await policies.load()
    return (policies, deployment)
}

struct VersionPolicyTests {
    @Test func `shows a component's policy, and none for another`() async throws {
        let (policies, _) = try await notesPolicies()

        #expect(policies.policy(of: "notes-ios")?.minimum == "0.2.0")
        #expect(policies.policy(of: "notes-api") == nil)
    }

    @Test func `sets a policy once, keeping its words, and shows it at once`() async throws {
        let (policies, deployment) = try await notesPolicies()
        deployment.answer(
            "PUT /api/projects/notes/version-policies/notes-ios", 200,
            #"""
            {"component":"notes-ios","minimum":"0.3.0","recommended":"0.3.1","storeUrl":"https://apps.apple.com/app/id0000000000",
            "words":[{"locale":"en-US","decision":"require","text":{"title":"Update Notes","message":"This version can't sync any more."}}],
            "setAt":"2026-10-22T10:00:00.000Z"}
            """#)

        #expect(
            await policies.set(
                "notes-ios", minimum: " 0.3.0 ", recommended: "0.3.1", storePage: "", minimumOS: ""))

        let bodies = deployment.bodies("PUT /api/projects/notes/version-policies/notes-ios")
        #expect(bodies.count == 1)
        let sent = try JSONDecoder().decode(VersionPolicyTo.self, from: try #require(bodies.first))
        #expect(sent.minimum == "0.3.0")
        #expect(sent.storeUrl == nil)
        #expect(sent.words?.first?.text.title == "Update Notes")
        #expect(policies.policy(of: "notes-ios")?.minimum == "0.3.0")
        #expect(policies.changes.isEmpty)
    }

    @Test func `says why the deployment refused a policy, and keeps the one shown`() async throws {
        let (policies, deployment) = try await notesPolicies()
        let reason = "The recommended version 0.1.0 is lower than the minimum 0.2.0."
        deployment.answer(
            "PUT /api/projects/notes/version-policies/notes-ios", 422,
            #"{"_tag":"VersionPolicyRefused","reason":"\#(reason)"}"#)

        #expect(
            !(await policies.set("notes-ios", minimum: "0.2.0", recommended: "0.1.0", storePage: "", minimumOS: "")))

        #expect(policies.changes["notes-ios"] == .failed(.refused(reason: reason)))
        #expect(policies.policy(of: "notes-ios")?.recommended == "0.3.1")
    }

    @Test(arguments: [
        ("", "", "", "", VersionPolicyProblem.noVersion),
        ("", "", "", "26.0", .noVersion),
        ("0.2", "1.2.3.4.5", "", "", .notAVersion),
        ("0.2.0", "", "", "twenty-six", .notAVersion),
        ("0.2.0", "", "http://apps.apple.com/app/id1", "", .notAStorePage),
        ("0.2.0", "", "https://apps.apple.com/app/id 1", "", .notAStorePage),
    ])
    func `sends no policy the deployment would refuse to read`(
        _ minimum: String, _ recommended: String, _ storePage: String, _ minimumOS: String,
        _ problem: VersionPolicyProblem
    ) async throws {
        let (policies, deployment) = try await notesPolicies()

        #expect(
            !(await policies.set(
                "notes-ios", minimum: minimum, recommended: recommended, storePage: storePage, minimumOS: minimumOS)))

        #expect(policies.changes["notes-ios"] == .failed(problem))
        #expect(!deployment.requests.contains { $0.hasPrefix("PUT") })
    }

    @Test func `clears a policy, after which no release is asked to update`() async throws {
        let (policies, deployment) = try await notesPolicies()
        deployment.answer("DELETE /api/projects/notes/version-policies/notes-ios", 204)

        #expect(await policies.clear("notes-ios"))

        #expect(policies.policy(of: "notes-ios") == nil)
        #expect(policies.policies.value?.policies.isEmpty == true)
    }

    @Test func `keeps the policy shown when clearing it fails offline, and keeps nothing to send later`() async throws {
        let (policies, deployment) = try await notesPolicies()
        deployment.setOffline(true)

        #expect(!(await policies.clear("notes-ios")))

        #expect(policies.changes["notes-ios"] == .failed(.unreachable))
        #expect(policies.policy(of: "notes-ios") != nil)
        deployment.setOffline(false)
        await policies.load()
        #expect(deployment.requests.filter { $0.hasPrefix("DELETE") }.count == 1)
    }
}

let sdkKeysAnswer = #"""
    {"keys":[{"key":"cluenori-sdk.notes.notes-ios.older","component":"notes-ios","issuedAt":"2026-09-01T10:00:00.000Z",
      "revokedAt":"2026-10-01T10:00:00.000Z"},
     {"key":"cluenori-sdk.notes.notes-ios.newer","component":"notes-ios","issuedAt":"2026-09-30T10:00:00.000Z"}]}
    """#

/// notes-ios's SDK keys, asked for.
func notesKeys() async throws -> (SdkKeysModel, FakeDeployment) {
    let deployment = FakeDeployment()
    deployment.answer("GET /api/projects/notes/components/notes-ios/sdk-keys", 200, sdkKeysAnswer)
    let keys = try pairedModels(deployment).sdkKeys("notes", component: "notes-ios")
    await keys.load()
    return (keys, deployment)
}

struct SdkKeysTests {
    @Test func `lists the active keys first, then the revoked`() async throws {
        let (keys, _) = try await notesKeys()

        #expect(keys.keys.map(\.key) == ["cluenori-sdk.notes.notes-ios.newer", "cluenori-sdk.notes.notes-ios.older"])
    }

    @Test func `issues a key once, shown at once, the others still active`() async throws {
        let (keys, deployment) = try await notesKeys()
        deployment.answer(
            "POST /api/projects/notes/components/notes-ios/sdk-keys", 201,
            #"{"key":"cluenori-sdk.notes.notes-ios.newest","component":"notes-ios","issuedAt":"2026-10-22T10:00:00.000Z"}"#
        )

        #expect(await keys.issue())

        #expect(keys.keys.map(\.key).first == "cluenori-sdk.notes.notes-ios.newest")
        #expect(keys.keys.filter { $0.revokedAt == nil }.count == 2)
        #expect(keys.lastIssued == "cluenori-sdk.notes.notes-ios.newest")
        #expect(deployment.requests.filter { $0.hasPrefix("POST") }.count == 1)
    }

    @Test func `revokes a key, shown revoked at once`() async throws {
        let (keys, deployment) = try await notesKeys()
        deployment.answer(
            "POST /api/projects/notes/components/notes-ios/sdk-keys/cluenori-sdk.notes.notes-ios.newer/revoke", 200,
            #"{"key":"cluenori-sdk.notes.notes-ios.newer","component":"notes-ios","issuedAt":"2026-09-30T10:00:00.000Z","revokedAt":"2026-10-22T10:00:00.000Z"}"#
        )

        #expect(await keys.revoke("cluenori-sdk.notes.notes-ios.newer"))

        #expect(keys.keys.allSatisfy { $0.revokedAt != nil })
        #expect(keys.revoking.isEmpty)
    }

    @Test func `says why a key wasn't issued, and keeps the keys shown`() async throws {
        let (keys, deployment) = try await notesKeys()
        deployment.setOffline(true)

        #expect(!(await keys.issue()))

        #expect(keys.issuing == .failed(.unreachable))
        #expect(keys.keys.count == 2)
        keys.dismissProblems()
        #expect(keys.issuing == nil)
    }

    @Test func `says a key the component doesn't have is gone`() async throws {
        let (keys, deployment) = try await notesKeys()
        deployment.answer(
            "POST /api/projects/notes/components/notes-ios/sdk-keys/cluenori-sdk.notes.notes-ios.newer/revoke", 404,
            #"{"_tag":"SdkKeyNotFound","key":"cluenori-sdk.notes.notes-ios.newer"}"#)

        #expect(!(await keys.revoke("cluenori-sdk.notes.notes-ios.newer")))

        #expect(keys.revoking["cluenori-sdk.notes.notes-ios.newer"] == .failed(.missing))
    }
}

/// notes.share over 3 days, the last of them today: the app used it the first and last day; its
/// service ran two operations for it on the last, one failing, and sent warnings and errors the
/// day before, its logs kept from that day.
let featureAnswer = #"""
    {"feature":"notes.share","asOf":"2026-10-22T15:00:00.000Z",
    "use":{"days":[{"day":"2026-10-20","people":4,"events":6,"screens":2},
      {"day":"2026-10-22","people":2,"events":3,"screens":1}],
      "people":5,"latestPeople":[{"person":"prs-1","users":["user-1842"],"days":2,"events":5,"lastDay":"2026-10-22"}],
      "releases":[]},
    "logs":{"covered":{"from":"2026-10-21T09:00:00.000Z","to":"2026-10-22T15:00:00.000Z"},
      "days":[{"day":"2026-10-21","warnings":3,"errors":1}],"errors":[]},
    "operations":[
      {"day":"2026-10-22","component":"notes-api","operation":"POST /api/notes/{id}/share","count":7,"errors":1},
      {"day":"2026-10-22","component":"notes-api","operation":"GET /api/notes/{id}/share-link","count":9,"errors":0},
      {"day":"2026-10-21","component":"notes-api","operation":"POST /api/notes/{id}/share","count":4,"errors":0}]}
    """#

struct FeatureTests {
    @Test func `tells a feature's days, the services' part unknown before its logs were kept`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/features/notes.share", 200, featureAnswer)
        let feature = try pairedModels(deployment).feature(
            FeatureRef(project: "notes", key: "notes.share", environment: "production"))

        await feature.load()

        #expect(deployment.queries("/api/projects/notes/features/notes.share").first == ["environment": "production"])
        let days = feature.days(last: 3)
        #expect(days.map(\.day) == ["2026-10-20", "2026-10-21", "2026-10-22"].compactMap(UTCDay.date))
        #expect(days.map(\.people) == [4, 0, 2])
        #expect(days.map(\.operations) == [0, 4, 16])
        #expect(days.map(\.failed) == [0, 0, 1])
        // The 20th is before the logs kept: unknown, not none; the 22nd had none.
        #expect(days.map(\.warnings) == [nil, 3, 0])
        #expect(days.map(\.errors) == [nil, 1, 0])
        #expect(feature.servicesNamedIt)
        #expect(
            feature.operations.map(\.operation) == ["POST /api/notes/{id}/share", "GET /api/notes/{id}/share-link"])
        #expect(feature.operations.map(\.count) == [11, 9])
        let brief = try #require(feature.agentBrief)
        #expect(brief.contains("./cluenori feature notes notes.share --environment production"))
        #expect(brief.contains("Apps: 5 people used it, from 2026-10-20 to 2026-10-22."))
    }

    @Test func `says when nothing kept names a feature`() async throws {
        let deployment = FakeDeployment()
        deployment.answer(
            "GET /api/projects/notes/features/notes.nothing", 404,
            #"{"_tag":"FeatureNotFound","feature":"notes.nothing"}"#)
        let feature = try pairedModels(deployment).feature(FeatureRef(project: "notes", key: "notes.nothing"))

        await feature.load()

        #expect(feature.story.value == nil)
        #expect(feature.story.problem == .missing)
    }
}

struct PeopleCountsTests {
    @Test func `counts people on the latest whole UTC day against a week before, unknown never 0`() throws {
        let usage = try JSONDecoder.api.decode(
            AppUsage.self,
            from: Data(
                #"""
                {"days":[{"day":"2026-10-14","people":50,"weekPeople":200,"installations":1,"sessions":1,"foregroundMs":1},
                  {"day":"2026-10-21","people":60,"weekPeople":180,"installations":1,"sessions":1,"foregroundMs":1},
                  {"day":"2026-10-22","people":9,"weekPeople":181,"installations":1,"sessions":1,"foregroundMs":1}],
                "people":1,"installations":1,"sessions":1,"releases":[]}
                """#.utf8))
        let now = try #require(UTCDay.date("2026-10-22")).addingTimeInterval(15 * 3_600)

        let counts = PeopleCounts.of(usage, now: now)

        // Yesterday, not today so far.
        #expect(counts.day == UTCDay.date("2026-10-21"))
        #expect(counts.daily.value == 60)
        #expect(counts.daily.change == 0.2)
        #expect(counts.weekly.value == 180)
        #expect(counts.weekly.change == -0.1)
        #expect(counts.monthly.value == nil)
        #expect(counts.monthly.change == nil)
    }
}
