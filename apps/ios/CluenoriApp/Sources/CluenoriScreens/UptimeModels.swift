import CluenoriClient
import Foundation
import Observation

/// One incident, whatever any period: the incident, its life, and the releases that ran when it
/// opened. Kept on the phone. Acknowledging it is the project's `IncidentsModel`'s.
@Observable
public final class IncidentModel {
    public let project: String
    public let id: String
    /// Fails with `missing` for an incident the project doesn't have.
    public let detail: Answer<IncidentDetail>

    init(project: String, id: String, api: CluenoriAPI, context: AnswerContext) {
        self.project = project
        self.id = id
        detail = Answer(
            context,
            .init(key: "projects/\(project)/incident/\(id)") { () async throws(APIError) in
                try await api.incident(project: project, incident: id)
            })
    }
}

/// A project's monitors, oldest first, each with how it is now and its last 90 days. Kept on the
/// phone. And removing one, sent once and never kept to send later.
@Observable
public final class MonitorsModel {
    /// Why removing a monitor didn't happen.
    public enum Problem: Equatable, Sendable {
        /// The deployment didn't answer: the phone may be offline.
        case unreachable
        /// The deployment answered in a way this app doesn't understand, or refused.
        case unreadable
    }

    /// What adding a monitor came to.
    public enum Added: Equatable, Sendable {
        /// Added, with its ID.
        case added(String)
        /// The same subject, condition and environment is already monitored, by the monitor of this ID.
        case exists(String)
        /// The project has as many monitors as it may.
        case limitReached(Int)
        /// The deployment didn't answer: the phone may be offline.
        case unreachable
        /// The deployment answered in a way this app doesn't understand, or refused.
        case unreadable
    }

    public let project: String
    public let monitors: Answer<MonitorList>
    /// The monitor being removed, while it is.
    public private(set) var removing: String? = nil
    /// Whether a monitor is being added.
    public private(set) var adding = false

    @ObservationIgnored private let api: CluenoriAPI
    @ObservationIgnored private let keyRejected: () -> Void

    init(project: String, api: CluenoriAPI, context: AnswerContext) {
        self.project = project
        self.api = api
        keyRejected = context.keyRejected
        monitors = Answer(
            context,
            .init(key: "projects/\(project)/monitors") { () async throws(APIError) in
                try await api.monitors(project: project)
            })
    }

    /// Removes monitor `id`, for whoever paired the phone: it is no longer looked at, and its open
    /// incident resolves. Nil once removed, and gone from the list at once (as when it was already
    /// gone), or why not.
    public func remove(_ id: String) async -> Problem? {
        guard removing == nil else { return .unreadable }
        removing = id
        defer { removing = nil }
        do {
            try await api.removeMonitor(project: project, monitor: id)
        } catch .unauthorized {
            keyRejected()
            return .unreadable
        } catch .unreachable {
            return .unreachable
        } catch .monitorNotFound {
            // Already gone: what was asked holds.
        } catch {
            return .unreadable
        }
        if let list = monitors.value {
            monitors.show(MonitorList(monitors: list.monitors.filter { $0.monitor.id != id }))
        }
        return nil
    }

    /// Adds `monitor`, for whoever paired the phone, sent once and never kept to send later; once
    /// added, the list is asked again, so it shows it.
    public func add(_ monitor: AddMonitor) async -> Added {
        guard !adding else { return .unreadable }
        adding = true
        defer { adding = false }
        let added: Monitor
        do {
            added = try await api.addMonitor(project: project, monitor)
        } catch .unauthorized {
            keyRejected()
            return .unreadable
        } catch .unreachable {
            return .unreachable
        } catch .monitorExists(let exists) {
            return .exists(exists.monitor)
        } catch .monitorLimitReached(let limit) {
            return .limitReached(limit.limit)
        } catch {
            return .unreadable
        }
        await monitors.load()
        return .added(added.id)
    }
}

extension LatencyAbove {
    /// The percentile it judges as written: `p95`.
    public var percentileName: String {
        if let whole = Int(exactly: percentile) { "p\(whole)" } else { "p\(percentile)" }
    }
}

/// A monitor of an operation as "Monitor this" types it: when it fires, its number as typed, its
/// window as typed with a unit, and the level of its alerts. `monitor` checks it by the API's rules,
/// so the form says what is wrong before sending.
public nonisolated struct OperationMonitorDraft: Equatable, Sendable {
    /// When it fires: the conditions that fit an operation.
    public enum Kind: CaseIterable, Sendable {
        case nothingFor, latencyAbove, errorRateAbove
    }

    /// Which latency a monitor of latency judges, and how many runs it needs to, as the API's
    /// `runsJudged`: fewer are unknown, never judged.
    public enum Percentile: Double, CaseIterable, Sendable {
        case p50 = 50
        case p95 = 95
        case p99 = 99

        public var runsJudged: Int {
            switch self {
            case .p50: 5
            case .p95: 20
            case .p99: 100
            }
        }
    }

    /// The unit of its window, in minutes.
    public enum Unit: Int, CaseIterable, Sendable {
        case minutes = 1
        case hours = 60
        case days = 1440
    }

    /// Why a draft isn't a monitor the API would add.
    public enum Refusal: Error, Equatable, Sendable {
        /// The number isn't one, or is out of its kind's range.
        case threshold(Kind)
        /// The window isn't whole minutes from 1 minute to 1 day; for nothing-for, to 7 days.
        case window(Kind)
    }

    public var kind: Kind {
        didSet { if kind != oldValue { threshold = Self.firstThreshold(kind) } }
    }
    public var threshold: String
    /// The latency judged, for `latencyAbove`.
    public var percentile = Percentile.p95
    public var amount: String
    public var unit: Unit
    public var level: AlertLevel

    /// A draft of `kind` over `minutes`, shown in hours when they are whole hours, alerting
    /// time-sensitive, as on the web.
    public init(kind: Kind, minutes: Int, level: AlertLevel = .timeSensitive) {
        self.kind = kind
        threshold = Self.firstThreshold(kind)
        if minutes % 60 == 0 {
            amount = String(minutes / 60)
            unit = .hours
        } else {
            amount = String(minutes)
            unit = .minutes
        }
        self.level = level
    }

    /// The draft "Monitor this" opens on: nothing for an hour.
    public static let first = OperationMonitorDraft(kind: .nothingFor, minutes: 60)

    /// The draft for a quiet operation that is a job: nothing for twice its usual gap, in whole
    /// minutes, as on the web.
    public static func job(usualGapMs: Double) -> OperationMonitorDraft {
        // A gap past what a monitor may wait shows one minute past it, which the form refuses, rather
        // than a number that doesn't fit an Int or a shorter window than the job's.
        let minutes = (2 * usualGapMs / 60_000).rounded(.up)
        return OperationMonitorDraft(kind: .nothingFor, minutes: Int(min(max(1, minutes), 10_081)))
    }

    private static func firstThreshold(_ kind: Kind) -> String {
        switch kind {
        case .nothingFor: ""
        case .latencyAbove: "500"
        case .errorRateAbove: "5"
        }
    }

    /// The monitor it says, of `operation` in `component`, and in `environment` when given, or why
    /// the API would refuse it: the bounds are the API's (`AddMonitor`). Numbers are read in `locale`,
    /// as the person typed them.
    public func monitor(
        operation: String, component: String, environment: String?, locale: Locale
    ) -> Result<AddMonitor, Refusal> {
        // Whole minutes once in minutes: 1.5 hours is 90.
        let window = Self.number(amount, locale).map { $0 * Double(unit.rawValue) }
        let most = kind == .nothingFor ? 10_080.0 : 1_440.0
        guard let window, window == window.rounded(), window >= 1, window <= most else {
            return .failure(.window(kind))
        }
        let minutes = Int(window)
        let subject = OperationSubject(operation: operation)
        let condition: MonitorCondition
        switch kind {
        case .nothingFor:
            condition = .nothingFor(NothingFor(subject: .operation(subject), minutes: minutes))
        case .latencyAbove:
            guard let ms = Self.number(threshold, locale), ms >= 1, ms <= 600_000 else {
                return .failure(.threshold(kind))
            }
            condition = .latencyAbove(
                LatencyAbove(subject: subject, percentile: percentile.rawValue, ms: ms, minutes: minutes))
        case .errorRateAbove:
            guard let percent = Self.number(threshold, locale), percent > 0, percent < 100 else {
                return .failure(.threshold(kind))
            }
            condition = .errorRateAbove(ErrorRateAbove(subject: subject, percent: percent, minutes: minutes))
        }
        return .success(AddMonitor(component: component, environment: environment, condition: condition, level: level))
    }

    // A finite number typed in `locale`, the whole field of it, nil for anything else: `25garbage`
    // is no number, though a parser would read 25 from it.
    private static func number(_ text: String, _ locale: Locale) -> Double? {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty,
            let (end, value) = try? FloatingPointFormatStyle<Double>.number.locale(locale).consuming(
                trimmed, startingAt: trimmed.startIndex, in: trimmed.startIndex..<trimmed.endIndex),
            end == trimmed.endIndex, value.isFinite
        else { return nil }
        return value
    }
}

/// One monitor, whatever any period: how it is now and its last 90 days, its last 24 hours by five
/// minutes, its latest failed checks, and its incidents. Kept on the phone.
@Observable
public final class MonitorModel {
    public let project: String
    public let id: String
    /// Fails with `missing` for a monitor the project doesn't have, or no longer has.
    public let detail: Answer<MonitorDetail>

    init(project: String, id: String, api: CluenoriAPI, context: AnswerContext) {
        self.project = project
        self.id = id
        detail = Answer(
            context,
            .init(key: "projects/\(project)/monitor/\(id)") { () async throws(APIError) in
                try await api.monitor(project: project, monitor: id)
            })
    }
}

/// What a monitor watches: a URL it fetches, an operation, an event, an error group or a log
/// message, as data; the web's `subjectWords` says the same.
public enum MonitorSubject: Equatable, Sendable {
    case url(String)
    case operation(String)
    case event(String)
    case error(String)
    case message(Int)
    /// A subject this version of the app doesn't know, from a newer deployment.
    case unknown
}

extension MonitorCondition {
    /// What it watches.
    public var subject: MonitorSubject {
        switch self {
        case .noAnswer(let condition): .url(condition.subject.url)
        case .nothingFor(let condition):
            switch condition.subject {
            case .operation(let subject): .operation(subject.operation)
            case .event(let subject): .event(subject.event)
            case .unknown: .unknown
            }
        case .moreThan(let condition):
            switch condition.subject {
            case .error(let subject): .error(subject.error)
            case .message(let subject): .message(subject.message)
            case .event(let subject): .event(subject.event)
            case .unknown: .unknown
            }
        case .latencyAbove(let condition): .operation(condition.subject.operation)
        case .errorRateAbove(let condition): .operation(condition.subject.operation)
        case .unknown: .unknown
        }
    }
}

extension Monitor {
    /// The URL it fetches every minute, when it is a URL monitor; nil for a monitor of counts.
    public var url: String? {
        if case .noAnswer(let condition) = condition { condition.subject.url } else { nil }
    }
}

/// How a monitor is now: a URL's by its last check, passing, failing or not checked yet; a monitor
/// of counts's by whether it fires, or not looked at yet.
public enum MonitorStatus: Equatable, Sendable {
    case up
    case down
    case unchecked
}

extension MonitorState {
    public var status: MonitorStatus {
        guard monitor.url != nil else {
            if firing { return .down }
            return measured == nil ? .unchecked : .up
        }
        guard let lastCheck else { return .unchecked }
        return lastCheck.problem == nil ? .up : .down
    }
}

extension UptimeAnswer {
    /// Whether the answer says fine or firing rather than up or down: once any monitor is of counts,
    /// which no check makes "up".
    public static func saysFine(_ monitors: [MonitorState]) -> Bool {
        monitors.contains { $0.monitor.url == nil }
    }
}

/// Uptime's answer, whether everything is up, as data; the web's `uptimeAnswerOf` says the same.
public enum UptimeAnswer: Equatable, Sendable {
    /// The project has no monitors.
    case noMonitors
    /// `down` of `of` monitors fail now.
    case down(Int, of: Int)
    /// No monitor has had a check yet.
    case noneChecked
    /// Every checked monitor passes; `unchecked` more haven't had a check yet.
    case up(Int, unchecked: Int)

    public init(_ monitors: [MonitorState]) {
        let down = monitors.filter { $0.status == .down }.count
        let checked = monitors.filter { $0.status != .unchecked }.count
        if monitors.isEmpty {
            self = .noMonitors
        } else if down > 0 {
            self = .down(down, of: monitors.count)
        } else if checked == 0 {
            self = .noneChecked
        } else {
            self = .up(checked, unchecked: monitors.count - checked)
        }
    }
}

/// One UTC day of a monitor's strip, and how it went.
public struct StripDay: Equatable, Sendable {
    public enum Tone: Equatable, Sendable {
        /// Every check passed.
        case up
        /// Some failed.
        case some
        /// Every check failed.
        case down
        /// None while it was watched: unknown, never shown as up.
        case unchecked
        /// Before it was added.
        case before
    }

    /// `2026-10-26`, as the deployment names UTC days.
    public let day: String
    public let checks: Int
    public let failed: Int
    public let tone: Tone
}

/// Uptime's rules over a monitor's days, pure: "now" is passed in.
public enum UptimeFacts {
    private static let dayStyle = Date.ISO8601FormatStyle(timeZone: .gmt).year().month().day()
    private static let daySeconds: TimeInterval = 86_400

    /// The UTC day `date` falls in, as the deployment names it.
    public static func day(of date: Date) -> String {
        date.formatted(dayStyle)
    }

    // The start of the UTC day `date` falls in.
    private static func startOfDay(_ date: Date) -> Date {
        Date(timeIntervalSince1970: (date.timeIntervalSince1970 / daySeconds).rounded(.down) * daySeconds)
    }

    /// A monitor's last `length` UTC days up to the one `now` falls in, oldest first.
    public static func strip(of state: MonitorState, now: Date, length: Int) -> [StripDay] {
        let byDay = Dictionary(state.days.map { ($0.day, $0) }, uniquingKeysWith: { _, last in last })
        let added = day(of: state.monitor.addedAt)
        let today = startOfDay(now)
        return (0..<length).map { index in
            let name = day(of: today.addingTimeInterval(-Double(length - 1 - index) * daySeconds))
            guard let counted = byDay[name], counted.checks > 0 else {
                return StripDay(day: name, checks: 0, failed: 0, tone: name < added ? .before : .unchecked)
            }
            let tone: StripDay.Tone =
                counted.failed == 0 ? .up : counted.failed == counted.checks ? .down : .some
            return StripDay(day: name, checks: counted.checks, failed: counted.failed, tone: tone)
        }
    }

    /// A monitor's days within the last `days` UTC days up to `now`'s.
    public static func lastDays(of state: MonitorState, now: Date, days: Int) -> [MonitorDay] {
        let first = day(of: startOfDay(now).addingTimeInterval(-Double(days - 1) * daySeconds))
        return state.days.filter { $0.day >= first }
    }

    /// The share of checks that passed over some days, rounded down to a hundredth of a percent, so
    /// one failed check never reads 100%; nil when there were none.
    public static func passedShare(_ days: [MonitorDay]) -> Double? {
        passedShare(checks: days.reduce(0) { $0 + $1.checks }, failed: days.reduce(0) { $0 + $1.failed })
    }

    /// The share of `checks` that passed, `failed` of them failing, rounded down as above.
    public static func passedShare(checks: Int, failed: Int) -> Double? {
        guard checks > 0 else { return nil }
        return (Double(checks - failed) / Double(checks) * 10_000).rounded(.down) / 10_000
    }
}

/// What an agent needs to look into an incident or a monitor, in English: what it is, where, how it
/// went, and the CLI commands and API calls that read the rest. The web's `incidentBriefOf` and
/// `monitorBriefOf` say the same.
public enum UptimeBriefs {
    // Machine-readable times and numbers: the same on every phone, whatever its locale.
    private static func iso(_ date: Date) -> String {
        date.formatted(.iso8601)
    }

    private static func percent(_ share: Double) -> String {
        String(format: "%.1f%%", locale: Locale(identifier: "en_US_POSIX"), share * 100)
    }

    // An uptime, already rounded down to a hundredth of a percent (`UptimeFacts.passedShare`), with
    // both its decimals: one failed check of 14,400 reads 99.99%, never 100.0%.
    private static func uptime(_ share: Double) -> String {
        String(format: "%.2f%%", locale: Locale(identifier: "en_US_POSIX"), share * 100)
    }

    /// A monitor's URL as a brief names it: without its user, password, query or fragment, where
    /// tokens go, so a brief handed to an agent carries none; `?…` says a query was left out. A URL
    /// that doesn't parse, which may hide them anywhere, is left out whole. Other secrets in a URL's
    /// path are not recognized, and stay.
    public static func briefURL(_ url: String) -> String {
        guard let parts = URLComponents(string: url), let scheme = parts.scheme, let host = parts.host,
            parts.port.map({ (0...65_535).contains($0) }) ?? true
        else {
            return "(a URL that doesn't parse)"
        }
        let port = parts.port.map { ":\($0)" } ?? ""
        let left = parts.query != nil || parts.fragment != nil ? "?…" : ""
        return "\(scheme)://\(host)\(port)\(parts.path)\(left)"
    }

    private static func milliseconds(_ ms: Double) -> String {
        ms >= 1000
            ? String(format: "%.1f s", locale: Locale(identifier: "en_US_POSIX"), ms / 1000) : "\(Int(ms.rounded())) ms"
    }

    // A word for a shell's single quotes.
    private static func quoted(_ text: String) -> String {
        "'" + text.replacing("'", with: "'\\''") + "'"
    }

    // "30 minutes", "12 hours", "1 day", "90 minutes": a monitor's window, as its owner set it.
    private static func minutes(_ minutes: Int) -> String {
        let (count, unit): (Int, String) =
            minutes % 1440 == 0
            ? (minutes / 1440, "day") : minutes % 60 == 0 ? (minutes / 60, "hour") : (minutes, "minute")
        return "\(count) \(unit)\(count == 1 ? "" : "s")"
    }

    private static func number(_ value: Double) -> String {
        value.rounded() == value
            ? "\(Int(value))" : String(format: "%.1f", locale: Locale(identifier: "en_US_POSIX"), value)
    }

    /// What a monitor watches, in words: its URL (as `briefURL` names it) or operation, "event
    /// user.registered", "error 3f9c0e2a7b1d4c58", "log message 12".
    public static func subject(_ subject: MonitorSubject) -> String {
        switch subject {
        case .url(let url): briefURL(url)
        case .operation(let operation): operation
        case .event(let event): "event \(event)"
        case .error(let error): "error \(error)"
        case .message(let message): "log message \(message)"
        case .unknown: "a subject this app doesn't know"
        }
    }

    /// When a monitor fires, in a line: "doesn't answer two checks in a row", "nothing for 30
    /// minutes", "p95 above 500 ms over 15 minutes".
    public static func condition(_ condition: MonitorCondition) -> String {
        switch condition {
        case .noAnswer: "doesn't answer two checks in a row"
        case .nothingFor(let nothing): "nothing for \(minutes(nothing.minutes))"
        case .moreThan(let more): "more than \(more.count) in \(minutes(more.minutes))"
        case .latencyAbove(let latency):
            "\(latency.percentileName) above \(milliseconds(latency.ms)) over \(minutes(latency.minutes))"
        case .errorRateAbove(let rate): "more than \(number(rate.percent))% failed over \(minutes(rate.minutes))"
        case .unknown(let tag): "a condition this app doesn't know (\(tag))"
        }
    }

    // What a monitor of counts measured: "0 in 30 minutes", "p95 820 ms", "12% failed".
    private static func measured(_ condition: MonitorCondition, _ value: Double) -> String {
        switch condition {
        case .nothingFor(let nothing): "\(number(value)) in \(minutes(nothing.minutes))"
        case .moreThan(let more): "\(number(value)) in \(minutes(more.minutes))"
        case .latencyAbove(let latency): "\(latency.percentileName) \(milliseconds(value))"
        case .errorRateAbove: "\(number(value))% failed"
        case .noAnswer, .unknown: number(value)
        }
    }

    private static func kind(_ evidence: Evidence) -> String {
        switch evidence {
        case .down: "down"
        case .failing: "failing"
        case .stopped: "stopped"
        case .monitor: "monitor"
        case .unknown(let tag): tag
        }
    }

    private static func saw(_ evidence: Evidence) -> String {
        switch evidence {
        case .down(let down): "\(down.failures) checks failed in a row, the last: \(down.problem)"
        case .failing(let failing):
            "\(percent(failing.count == 0 ? 0 : Double(failing.failed) / Double(failing.count))) of \(failing.count) failed in the last 15 minutes, usually \(percent(failing.usualRate))"
        case .stopped(let stopped):
            "last ran \(iso(stopped.lastRanAt)), usually every \(milliseconds(stopped.usualGapMs))"
        case .monitor(let monitor):
            "\(measured(monitor.condition, monitor.value)); it fires on \(condition(monitor.condition))"
        case .unknown: "evidence this app doesn't know"
        }
    }

    private static let changeWords: [IncidentUpdateChange: String] = [
        .opened: "opened", .reopened: "came back", .worsened: "got worse", .acknowledged: "acknowledged",
        .resolved: "resolved",
    ]

    /// One incident's brief: what it is and where, what its detector saw, the release that ran, its
    /// life, and how to read it.
    public static func incident(project: String, detail: IncidentDetail) -> String {
        let incident = detail.incident
        let environment = incident.environment
        let title: String =
            switch incident.evidence {
            case .down(let down): incident.title.replacing(down.url, with: briefURL(down.url))
            default: incident.title
            }
        let place = incident.component + (environment.map { " (\($0))" } ?? "")
        let about: String =
            switch incident.evidence {
            case .down(let down):
                "Its monitor: ./cluenori monitor show \(project) \(down.monitor), or GET /api/projects/\(project)/monitors/\(down.monitor)."
            case .failing(let failing):
                "Its operation over time: ./cluenori operation \(project) \(quoted(failing.operation)) --component \(incident.component)\(environment.map { " --environment \($0)" } ?? "")."
            case .stopped(let stopped):
                "Its operation over time: ./cluenori operation \(project) \(quoted(stopped.operation)) --component \(incident.component)\(environment.map { " --environment \($0)" } ?? "")."
            case .monitor(let monitor):
                "Its monitor: ./cluenori monitor show \(project) \(monitor.monitor), or GET /api/projects/\(project)/monitors/\(monitor.monitor)."
            case .unknown: ""
            }
        let releases =
            detail.releases.isEmpty
            ? "No release of it reported running in the hour before it opened."
            : "Running when it opened: "
                + detail.releases.map {
                    "\(incident.component) \($0.release)\($0.environment.map { " in \($0)" } ?? "")"
                }
                .joined(separator: ", ") + "."
        let life = detail.updates.map { "\(changeWords[$0.change] ?? $0.change.rawValue) \(iso($0.at))" }
        return [
            "Look into this \(kind(incident.evidence)) incident in Cluenori project \(project): \(title)",
            "Incident \(incident.id), in \(place), opened \(iso(incident.openedAt))"
                + (incident.resolvedAt.map { ", resolved \(iso($0))." } ?? ", still open."),
            "What its detector saw: \(saw(incident.evidence)).",
            releases,
            "Its life: \(life.joined(separator: "; ")).",
            "Read it with ./cluenori incident \(project) \(incident.id), or GET /api/projects/\(project)/incidents/\(incident.id). \(about)",
        ].joined(separator: "\n")
    }

    /// How a monitor is now, said up to its last check: `Up for 3 days`, `Down: HTTP 503`; a monitor
    /// of counts's by what it last measured: `Firing: p95 820 ms`.
    public static func standing(_ state: MonitorState) -> String {
        if state.monitor.url == nil {
            guard let measure = state.measured else { return "Not looked at yet" }
            let value = measure.value.map { measured(state.monitor.condition, $0) } ?? "too few runs to judge"
            return "\(state.firing ? "Firing" : "Fine"): \(value)"
        }
        guard let check = state.lastCheck else { return "Not checked yet" }
        let lasted = state.since.map { " since \(iso($0))" } ?? ""
        return check.problem.map { "Down\(lasted): \($0)" } ?? "Up\(lasted)"
    }

    /// One monitor's brief: what it checks, how it is, its uptime, its latest failed checks, and
    /// how to read it.
    public static func monitor(project: String, detail: MonitorDetail, now: Date) -> String {
        let state = detail.state
        let monitor = state.monitor
        let read =
            "Read it with ./cluenori monitor show \(project) \(monitor.id), or GET /api/projects/\(project)/monitors/\(monitor.id); its incidents with ./cluenori incident \(project) <ID>."
        guard let url = monitor.url else {
            let place = monitor.component + (monitor.environment.map { " (\($0))" } ?? "")
            let incidents =
                detail.incidents.isEmpty
                ? "It never fired."
                : "Its incidents, the latest first: "
                    + detail.incidents.prefix(5).map {
                        "\($0.id) opened \(iso($0.openedAt))\($0.resolvedAt == nil ? ", open" : "")"
                    }
                    .joined(separator: "; ") + "."
            return [
                "Look into this monitor in Cluenori project \(project): \(subject(monitor.condition.subject)): \(condition(monitor.condition)), of \(place), looked at every minute since \(iso(monitor.addedAt)); its alerts come \(monitor.level.rawValue).",
                "Now: \(standing(state))\(state.measured.map { ", at \(iso($0.at))" } ?? "").",
                incidents,
                read,
            ].joined(separator: "\n")
        }
        let week = UptimeFacts.passedShare(UptimeFacts.lastDays(of: state, now: now, days: 7)).map(uptime)
        let all = UptimeFacts.passedShare(state.days).map(uptime)
        let failures = detail.failures.prefix(5).map { check in
            "\(iso(check.at)) \(check.problem ?? "")\(check.ms.map { " in \(milliseconds($0))" } ?? "")"
        }
        return
            ([
                "Look into this monitor in Cluenori project \(project): \(briefURL(url)), of \(monitor.component), fetched every minute since \(iso(monitor.addedAt)); a check passes with a status below 400 within 10 seconds.",
                "Now: \(standing(state))\(state.lastCheck.map { ", last checked \(iso($0.at))" } ?? "").",
                "Up \(week ?? "unknown") over the last 7 days, \(all ?? "unknown") over its last \(state.days.count) days with checks.",
            ]
            + (failures.isEmpty ? [] : ["Its latest failed checks: \(failures.joined(separator: "; "))."])
            + [read]).joined(separator: "\n")
    }
}
