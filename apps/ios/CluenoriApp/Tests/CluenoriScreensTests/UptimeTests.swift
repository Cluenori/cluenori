import CluenoriClient
import CluenoriScreens
import Foundation
import Testing

private func date(_ text: String) -> Date {
    try! Date(text, strategy: .iso8601)
}

private func state(added: String, days: [MonitorDay], problem: String?? = .some(nil)) -> MonitorState {
    MonitorState(
        monitor: Monitor(id: "m1", component: "notes-api", url: "https://notes.example/health", addedAt: date(added)),
        lastCheck: problem.map { MonitorCheck(at: date("2026-10-26T00:29:00Z"), status: 200, ms: 84, problem: $0) },
        days: days)
}

struct UptimeFactsTests {
    // 00:30 UTC on Oct 26: a phone east of UTC is already well into the 26th, one west still on the
    // 25th; the days are UTC's either way.
    let now = date("2026-10-26T00:30:00Z")

    @Test func `colors each UTC day by its checks, unknown when it had none, and nothing before it was added`() {
        let monitor = state(
            added: "2026-10-22T18:00:00Z",
            days: [
                MonitorDay(day: "2026-10-22", checks: 360, failed: 0),
                MonitorDay(day: "2026-10-24", checks: 1440, failed: 3),
                MonitorDay(day: "2026-10-25", checks: 2, failed: 2),
                MonitorDay(day: "2026-10-26", checks: 30, failed: 0),
            ])

        let strip = UptimeFacts.strip(of: monitor, now: now, length: 6)

        #expect(
            strip.map(\.day) == ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26"])
        #expect(strip.map(\.tone) == [.before, .up, .unchecked, .some, .down, .up])
    }

    @Test func `counts the last days up to today's, and never rounds a failed check up to 100%`() {
        let monitor = state(
            added: "2026-09-01T00:00:00Z",
            days: [
                MonitorDay(day: "2026-10-19", checks: 1440, failed: 1440),
                MonitorDay(day: "2026-10-20", checks: 20_000, failed: 1),
            ])

        // The last 7 days are the 20th to the 26th: the 19th's failures are outside them.
        let week = UptimeFacts.lastDays(of: monitor, now: now, days: 7)
        #expect(week.map(\.day) == ["2026-10-20"])
        // 19,999 of 20,000 passed: 99.995%, which reads 99.99%, never 100%.
        #expect(UptimeFacts.passedShare(week) == 0.9999)
        #expect(UptimeFacts.passedShare([]) == nil)
    }

    @Test func `answers whether everything is up, a monitor down outweighing those not checked`() {
        let up = state(added: "2026-10-01T00:00:00Z", days: [])
        let down = state(added: "2026-10-01T00:00:00Z", days: [], problem: "HTTP 503")
        let unchecked = state(added: "2026-10-26T00:29:30Z", days: [], problem: nil)

        #expect(UptimeAnswer([]) == .noMonitors)
        #expect(UptimeAnswer([up, down, unchecked]) == .down(1, of: 3))
        #expect(UptimeAnswer([up, unchecked]) == .up(1, unchecked: 1))
        #expect(UptimeAnswer([unchecked]) == .noneChecked)
    }
}

let monitorAnswer = #"""
    {"state":{"monitor":{"id":"m1","component":"notes-api","url":"https://notes.example/health",
    "addedAt":"2026-10-01T00:00:00.000Z"},
    "lastCheck":{"at":"2026-10-26T00:29:00.000Z","status":503,"ms":120,"problem":"HTTP 503"},
    "since":"2026-10-26T00:25:00.000Z","days":[{"day":"2026-10-25","checks":1440,"failed":4,"averageMs":90}]},
    "recent":[{"start":"2026-10-26T00:25:00.000Z","checks":5,"failed":4,"averageMs":118,"slowestMs":130}],
    "failures":[{"at":"2026-10-26T00:29:00.000Z","status":503,"ms":120,"problem":"HTTP 503"}],"incidents":[]}
    """#

let incidentDetailAnswer = #"""
    {"incident":{"id":"i1","component":"notes-api","environment":"production","subject":"GET /api/o'clock",
    "title":"GET /api/o'clock: 9% failed, usually 0.2%",
    "evidence":{"_tag":"failing","operation":"GET /api/o'clock","failed":54,"count":600,"usualRate":0.002},
    "openedAt":"2026-10-25T10:00:00.000Z","acknowledgedAt":"2026-10-25T10:03:00.000Z",
    "resolvedAt":"2026-10-25T10:20:00.000Z"},
    "updates":[{"change":"opened","at":"2026-10-25T10:00:00.000Z","title":"GET /api/o'clock: 9% failed, usually 0.2%"},
    {"change":"acknowledged","at":"2026-10-25T10:03:00.000Z"},{"change":"resolved","at":"2026-10-25T10:20:00.000Z"}],
    "releases":[{"environment":"production","release":"2026.10.25-a1b2c3d"}]}
    """#

struct UptimeModelTests {
    @Test func `asks for an incident's life, and says when the project doesn't have it`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/incidents/i1", 200, incidentDetailAnswer)
        deployment.answer("GET /api/projects/notes/incidents/i2", 404, #"{"_tag":"IncidentNotFound","incident":"i2"}"#)
        let models = try #require(
            PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport).models)

        let found = models.incident("notes", id: "i1")
        await found.detail.load()
        #expect(found.detail.value?.updates.map(\.change) == [.opened, .acknowledged, .resolved])

        let gone = models.incident("notes", id: "i2")
        await gone.detail.load()
        #expect(gone.detail.problem == .missing)
    }

    @Test func `briefs an agent on an incident: what it saw, the release that ran, its life, and how to read it`()
        async throws
    {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/incidents/i1", 200, incidentDetailAnswer)
        let models = try #require(
            PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport).models)
        let incident = models.incident("notes", id: "i1")
        await incident.detail.load()
        let detail = try #require(incident.detail.value)

        let brief = UptimeBriefs.incident(project: "notes", detail: detail)

        #expect(brief.contains("9.0% of 600 failed in the last 15 minutes, usually 0.2%"))
        #expect(brief.contains("Running when it opened: notes-api 2026.10.25-a1b2c3d in production."))
        #expect(
            brief.contains(
                "Its life: opened 2026-10-25T10:00:00Z; acknowledged 2026-10-25T10:03:00Z; resolved 2026-10-25T10:20:00Z."
            ))
        // The operation's name is quoted for a shell, its apostrophe too.
        #expect(
            brief.contains(
                #"./cluenori operation notes 'GET /api/o'\''clock' --component notes-api --environment production."#))
    }

    @Test func `asks for a monitor's history, and briefs an agent on it`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects/notes/monitors/m1", 200, monitorAnswer)
        let models = try #require(
            PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport).models)

        let monitor = models.monitor("notes", id: "m1")
        await monitor.detail.load()
        let detail = try #require(monitor.detail.value)

        #expect(detail.state.status == .down)
        let brief = UptimeBriefs.monitor(project: "notes", detail: detail, now: date("2026-10-26T00:30:00Z"))
        #expect(brief.contains("Now: Down since 2026-10-26T00:25:00Z: HTTP 503, last checked 2026-10-26T00:29:00Z."))
        #expect(brief.contains("Up 99.7% over the last 7 days"))
        #expect(brief.contains("Its latest failed checks: 2026-10-26T00:29:00Z HTTP 503 in 120 ms."))
    }
}
