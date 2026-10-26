import CluenoriClient
import CluenoriScreens
import Foundation
import Testing

private func date(_ text: String) -> Date {
    try! Date(text, strategy: .iso8601)
}

private func urlMonitor(_ url: String, added: Date) -> Monitor {
    Monitor(
        id: "m1", component: "notes-api", condition: .noAnswer(NoAnswer(subject: UrlSubject(url: url))), level: .alarm,
        addedAt: added)
}

private func state(added: String, days: [MonitorDay], problem: String?? = .some(nil)) -> MonitorState {
    MonitorState(
        monitor: urlMonitor("https://notes.example/health", added: date(added)),
        lastCheck: problem.map { MonitorCheck(at: date("2026-10-26T00:29:00Z"), status: 200, ms: 84, problem: $0) },
        days: days, firing: false)
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
    {"state":{"monitor":{"id":"m1","component":"notes-api",
    "condition":{"_tag":"noAnswer","subject":{"_tag":"url","url":"https://notes.example/health"}},
    "level":"alarm","addedAt":"2026-10-01T00:00:00.000Z"},"firing":true,
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
        #expect(brief.contains("Up 99.72% over the last 7 days"))
        #expect(brief.contains("Its latest failed checks: 2026-10-26T00:29:00Z HTTP 503 in 120 ms."))
    }

    @Test func `hands an agent a monitor's URL without its token, and never rounds a failed check to 100%`() {
        let detail = MonitorDetail(
            state: MonitorState(
                monitor: urlMonitor(
                    "https://ops:pw@notes.example/health?token=s3cret", added: date("2026-10-01T00:00:00Z")),
                days: [MonitorDay(day: "2026-10-25", checks: 14_400, failed: 1)], firing: false),
            recent: [], failures: [], incidents: [])

        let brief = UptimeBriefs.monitor(project: "notes", detail: detail, now: date("2026-10-26T00:30:00Z"))

        #expect(brief.contains("https://notes.example/health?…, of notes-api"))
        #expect(!brief.contains("s3cret") && !brief.contains("pw@"))
        // A port no URL has: nothing of it is handed on.
        #expect(
            UptimeBriefs.briefURL("https://ops:pw@notes.example:999999/health?token=s3cret")
                == "(a URL that doesn't parse)")
        #expect(brief.contains("Up 99.99% over the last 7 days"))
    }

    @Test func `says a monitor of counts fires by its incident, not by checks it never has`() {
        let job = MonitorState(
            monitor: Monitor(
                id: "m2", component: "notes-api", environment: "prod",
                condition: .nothingFor(
                    NothingFor(subject: .operation(OperationSubject(operation: "cleanup.run")), minutes: 90)),
                level: .timeSensitive, addedAt: date("2026-10-20T00:00:00Z")),
            days: [], measured: MonitorMeasure(at: date("2026-10-26T00:29:00Z"), value: 0), firing: true)
        let unseen = MonitorState(
            monitor: job.monitor, days: [], firing: false)

        #expect(job.status == .down && unseen.status == .unchecked)
        #expect(UptimeAnswer([job, state(added: "2026-10-01T00:00:00Z", days: [])]) == .down(1, of: 2))
        #expect(
            UptimeAnswer.saysFine([job]) && !UptimeAnswer.saysFine([state(added: "2026-10-01T00:00:00Z", days: [])]))

        let brief = UptimeBriefs.monitor(
            project: "notes", detail: MonitorDetail(state: job, recent: [], failures: [], incidents: []),
            now: date("2026-10-26T00:30:00Z"))
        #expect(brief.contains("cleanup.run: nothing for 90 minutes, of notes-api (prod)"))
        #expect(brief.contains("Now: Firing: 0 in 90 minutes, at 2026-10-26T00:29:00Z."))
        #expect(brief.contains("its alerts come timeSensitive"))
    }
}

struct MonitorThisTests {
    let english = Locale(identifier: "en_US")
    let turkish = Locale(identifier: "tr_TR")

    private func condition(_ draft: OperationMonitorDraft, _ locale: Locale) -> MonitorCondition? {
        guard
            case .success(let monitor) = draft.monitor(
                operation: "POST /api/export", component: "notes-api", environment: "production", locale: locale)
        else { return nil }
        return monitor.condition
    }

    @Test
    func `turns the form into the API's monitor, its window in minutes and its number as the phone's locale writes it`()
    {
        var draft = OperationMonitorDraft(kind: .errorRateAbove, minutes: 15)
        draft.threshold = "2,5"
        draft.amount = "2"
        draft.unit = .hours
        // In Turkish the comma is the decimal point: 2,5%, over 120 minutes.
        #expect(
            condition(draft, turkish)
                == .errorRateAbove(
                    ErrorRateAbove(subject: OperationSubject(operation: "POST /api/export"), percent: 2.5, minutes: 120)
                ))

        draft.kind = .latencyAbove
        #expect(draft.threshold == "500" && draft.percentile == .p95)
        draft.threshold = "1500.5"
        draft.percentile = .p99
        #expect(
            condition(draft, english)
                == .latencyAbove(
                    LatencyAbove(
                        subject: OperationSubject(operation: "POST /api/export"), percentile: 99, ms: 1500.5,
                        minutes: 120)))
    }

    @Test func `refuses what the API would: windows past a day, nothing-for past 7 days, and rates of 0 or 100`() {
        var nothing = OperationMonitorDraft(kind: .nothingFor, minutes: 60)
        nothing.amount = "7"
        nothing.unit = .days
        #expect(
            condition(nothing, english)
                == .nothingFor(
                    NothingFor(subject: .operation(OperationSubject(operation: "POST /api/export")), minutes: 10_080)))
        nothing.amount = "8"
        #expect(condition(nothing, english) == nil)
        nothing.amount = "1.5"
        nothing.unit = .minutes
        #expect(condition(nothing, english) == nil)

        var slow = OperationMonitorDraft(kind: .latencyAbove, minutes: 60)
        slow.amount = "2"
        slow.unit = .days
        #expect(
            slow.monitor(operation: "o", component: "c", environment: nil, locale: english)
                == .failure(.window(.latencyAbove)))
        slow.unit = .hours
        slow.threshold = "0"
        #expect(
            slow.monitor(operation: "o", component: "c", environment: nil, locale: english)
                == .failure(.threshold(.latencyAbove)))

        var failing = OperationMonitorDraft(kind: .errorRateAbove, minutes: 15)
        for refused in ["0", "100", "", "five"] {
            failing.threshold = refused
            #expect(condition(failing, english) == nil)
        }
        failing.threshold = "99.9"
        #expect(condition(failing, english) != nil)
    }

    @Test func `reads the whole field as a number, never a number's start, and whole minutes after the unit`() {
        var failing = OperationMonitorDraft(kind: .errorRateAbove, minutes: 15)
        for typed in ["25garbage", "2.5.1", "1e9999", "5 %"] {
            failing.threshold = typed
            #expect(condition(failing, english) == nil, "\(typed)")
        }
        // In Polish the decimal point is a comma: 2.5 is no number there.
        failing.threshold = "2.5"
        #expect(condition(failing, Locale(identifier: "pl_PL")) == nil)

        var nothing = OperationMonitorDraft(kind: .nothingFor, minutes: 60)
        nothing.amount = "60junk"
        nothing.unit = .minutes
        #expect(condition(nothing, english) == nil)
        nothing.amount = "1,5"
        nothing.unit = .hours
        #expect(
            condition(nothing, Locale(identifier: "pl_PL"))
                == .nothingFor(
                    NothingFor(subject: .operation(OperationSubject(operation: "POST /api/export")), minutes: 90)))
        nothing.amount = "1.01"
        #expect(condition(nothing, english) == nil)
    }

    @Test func `drafts a quiet job's monitor as nothing for twice its usual gap, whole minutes up`() {
        // Every 31 minutes and a half: 63 minutes, not 60 or 62.
        let job = OperationMonitorDraft.job(usualGapMs: 31.5 * 60_000)
        #expect(job.kind == .nothingFor && job.amount == "63" && job.unit == .minutes && job.level == .timeSensitive)
        #expect(OperationMonitorDraft.job(usualGapMs: 30 * 60_000).amount == "1")
        #expect(OperationMonitorDraft.job(usualGapMs: 30 * 60_000).unit == .hours)
        // A gap too long to wait for is refused, never cut to one that fits or crashing.
        let endless = OperationMonitorDraft.job(usualGapMs: 1e30)
        #expect(
            endless.monitor(operation: "o", component: "c", environment: nil, locale: english)
                == .failure(.window(.nothingFor)))
    }

    @Test func `adds a monitor once, shows it in the list, and opens the one already there`() async throws {
        let deployment = FakeDeployment()
        let added = #"""
            {"id":"m9","component":"notes-api","environment":"production","condition":{"_tag":"nothingFor","subject":{"_tag":"operation","operation":"POST /api/export"},"minutes":63},"level":"alarm","addedAt":"2026-10-26T10:00:00.000Z"}
            """#
        deployment.answer("POST /api/projects/notes/monitors", 201, added)
        deployment.answer(
            "GET /api/projects/notes/monitors", 200,
            #"{"monitors":[{"monitor":\#(added),"days":[],"firing":false}]}"#)
        let models = try #require(
            PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport).models)
        let monitors = models.monitors("notes")
        var draft = OperationMonitorDraft.job(usualGapMs: 31.5 * 60_000)
        draft.level = .alarm
        let monitor = try draft.monitor(
            operation: "POST /api/export", component: "notes-api", environment: "production", locale: english
        ).get()

        #expect(await monitors.add(monitor) == .added("m9"))
        #expect(monitors.monitors.value?.monitors.map(\.monitor.id) == ["m9"])
        let body = try #require(deployment.bodies("POST /api/projects/notes/monitors").first)
        let sent = try #require(try JSONSerialization.jsonObject(with: body) as? [String: Any])
        let condition = try #require(sent["condition"] as? [String: Any])
        #expect(sent["environment"] as? String == "production" && sent["level"] as? String == "alarm")
        #expect(condition["_tag"] as? String == "nothingFor" && condition["minutes"] as? Int == 63)

        deployment.answer("POST /api/projects/notes/monitors", 409, #"{"_tag":"MonitorExists","monitor":"m9"}"#)
        #expect(await monitors.add(monitor) == .exists("m9"))
        deployment.answer("POST /api/projects/notes/monitors", 409, #"{"_tag":"MonitorLimitReached","limit":30}"#)
        #expect(await monitors.add(monitor) == .limitReached(30))
    }
}
