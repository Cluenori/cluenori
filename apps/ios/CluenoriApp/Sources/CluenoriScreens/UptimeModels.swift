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
/// phone.
@Observable
public final class MonitorsModel {
    public let project: String
    public let monitors: Answer<MonitorList>

    init(project: String, api: CluenoriAPI, context: AnswerContext) {
        self.project = project
        monitors = Answer(
            context,
            .init(key: "projects/\(project)/monitors") { () async throws(APIError) in
                try await api.monitors(project: project)
            })
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

/// How a monitor is now, from its last check: passing, failing, or not checked yet.
public enum MonitorStatus: Equatable, Sendable {
    case up
    case down
    case unchecked
}

extension MonitorState {
    public var status: MonitorStatus {
        guard let lastCheck else { return .unchecked }
        return lastCheck.problem == nil ? .up : .down
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
    /// tokens go, so a brief handed to an agent carries none; `?…` says a query was left out. Other
    /// secrets in a URL's path are not recognized, and stay.
    public static func briefURL(_ url: String) -> String {
        guard let parts = URLComponents(string: url), let scheme = parts.scheme, let host = parts.host else {
            return url
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

    private static func kind(_ evidence: Evidence) -> String {
        switch evidence {
        case .down: "down"
        case .failing: "failing"
        case .stopped: "stopped"
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

    /// How a monitor is now, said up to its last check: `Up for 3 days`, `Down: HTTP 503`.
    public static func standing(_ state: MonitorState) -> String {
        guard let check = state.lastCheck else { return "Not checked yet" }
        let lasted = state.since.map { " since \(iso($0))" } ?? ""
        return check.problem.map { "Down\(lasted): \($0)" } ?? "Up\(lasted)"
    }

    /// One monitor's brief: what it checks, how it is, its uptime, its latest failed checks, and
    /// how to read it.
    public static func monitor(project: String, detail: MonitorDetail, now: Date) -> String {
        let state = detail.state
        let monitor = state.monitor
        let week = UptimeFacts.passedShare(UptimeFacts.lastDays(of: state, now: now, days: 7)).map(uptime)
        let all = UptimeFacts.passedShare(state.days).map(uptime)
        let failures = detail.failures.prefix(5).map { check in
            "\(iso(check.at)) \(check.problem ?? "")\(check.ms.map { " in \(milliseconds($0))" } ?? "")"
        }
        return
            ([
                "Look into this monitor in Cluenori project \(project): \(briefURL(monitor.url)), of \(monitor.component), fetched every minute since \(iso(monitor.addedAt)); a check passes with a status below 400 within 10 seconds.",
                "Now: \(standing(state))\(state.lastCheck.map { ", last checked \(iso($0.at))" } ?? "").",
                "Up \(week ?? "unknown") over the last 7 days, \(all ?? "unknown") over its last \(state.days.count) days with checks.",
            ]
            + (failures.isEmpty ? [] : ["Its latest failed checks: \(failures.joined(separator: "; "))."])
            + [
                "Read it with ./cluenori monitor show \(project) \(monitor.id), or GET /api/projects/\(project)/monitors/\(monitor.id); its incidents with ./cluenori incident \(project) <ID>."
            ]).joined(separator: "\n")
    }
}
