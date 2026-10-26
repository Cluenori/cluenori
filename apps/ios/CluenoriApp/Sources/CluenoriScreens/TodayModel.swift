import CluenoriClient
import Foundation
import Observation

/// What an incident is about, by the detector that opened it: a monitor down, an operation failing,
/// or one that stopped running.
public enum IncidentCause: Equatable, Sendable {
    case down
    case failing
    case stopped
    /// A detector this version of the app doesn't know, from a newer deployment.
    case other

    public init(_ evidence: Evidence) {
        switch evidence {
        case .down: self = .down
        case .failing: self = .failing
        case .stopped: self = .stopped
        case .unknown: self = .other
        }
    }
}

/// One item of Today, as Now's "Needs you" shows it: its project, its evidence, and the screen of the
/// item itself it opens.
public struct TodayRow: Identifiable, Equatable, Sendable {
    /// What needs attention, with what shows it.
    public enum Evidence: Equatable, Sendable {
        /// An open incident.
        case incident(title: String, cause: IncidentCause, openedAt: Date, acknowledged: Bool)
        /// An error group new in the last day, happening in the last 15 minutes, or both.
        case error(title: String, occurrences: Int, firstSeen: Date, lastSeen: Date, isNew: Bool, ongoing: Bool)
        /// An operation whose p95 over the last day is well over its usual.
        case slower(operation: String, p95Ms: Double, usualP95Ms: Double)
        /// An operation that usually ran about every `usualGapMs`, as Cluenori guessed from its
        /// history, and hasn't since `lastRanAt`: a hint, never an alert; it may be fine.
        case quiet(operation: String, usualGapMs: Double, lastRanAt: Date)
        /// A promotion to production that needs a member: approved in App Store review and waiting to
        /// be released, waiting for its environment's approval on GitHub, or ended without its release
        /// getting there. `since` is when it ended, or, while it hasn't, when it started.
        case promotion(release: String, component: String, environment: String, state: PromotionItemState, since: Date)
        /// A project that sent nothing in the last day; when it last did, if in the 8 days before.
        case silent(lastDataAt: Date?)
        /// A kind of item this version of the app doesn't know, from a newer deployment.
        case unknown(kind: String)
    }

    /// What kind of item it is, as its dot and its project's status show it.
    public enum Kind: Equatable, Sendable {
        case incident(acknowledged: Bool)
        case error
        case slower
        case quiet
        case promotion
        case silent
        case unknown
    }

    public let id: String
    /// Its project's key; empty for an item this version doesn't know.
    public let projectKey: String
    /// Its project's name.
    public let project: String
    public let evidence: Evidence
    /// The screen of the item itself; nil for an item this version doesn't know.
    public let route: Route?

    public var kind: Kind {
        switch evidence {
        case .incident(_, _, _, let acknowledged): .incident(acknowledged: acknowledged)
        case .error: .error
        case .slower: .slower
        case .quiet: .quiet
        case .promotion: .promotion
        case .silent: .silent
        case .unknown: .unknown
        }
    }
}

/// A project's apps' people on one UTC day, and on the same day a week before: those active that day
/// (daily people, DAU) and in the 30 days ending it (monthly people, MAU).
public struct PeopleNow: Equatable, Sendable {
    /// The UTC day counted, at its start: the latest whole one.
    public let day: Date
    public let daily: Int
    /// Nil when the 30 days ending it aren't all counted.
    public let monthly: Int?
    /// The same day a week before; nil when it isn't counted.
    public let dailyWeekBefore: Int?
    /// Nil when that day, or the 30 days ending it, aren't all counted.
    public let monthlyWeekBefore: Int?

    public init(day: Date, daily: Int, monthly: Int?, dailyWeekBefore: Int?, monthlyWeekBefore: Int?) {
        self.day = day
        self.daily = daily
        self.monthly = monthly
        self.dailyWeekBefore = dailyWeekBefore
        self.monthlyWeekBefore = monthlyWeekBefore
    }

    /// How daily people moved against a week before, as a share: 0.06 for 6% more. Nil when the
    /// week before isn't counted, or had no one, so no share says it.
    public var dailyChange: Double? {
        Self.change(from: dailyWeekBefore, to: daily)
    }

    private static func change(from before: Int?, to now: Int) -> Double? {
        guard let before, before > 0 else { return nil }
        return Double(now - before) / Double(before)
    }
}

/// How a project is going beside what needs you, in its production environments: its load over the
/// last 24 hours by the hour, and its apps' people.
public struct Pulse: Equatable, Sendable {
    /// Each hour of the last 24 that had an operation, oldest first. An hour not here had nothing
    /// reported, which isn't the same as nothing done.
    public let hours: [PulseHour]
    /// Nil when its apps sent nothing by the latest whole day: unknown, never 0.
    public let people: PeopleNow?

    public init(hours: [PulseHour], people: PeopleNow?) {
        self.hours = hours
        self.people = people
    }

    /// How many operations ran over the 24 hours.
    public var operations: Int {
        hours.reduce(0) { $0 + $1.count }
    }

    /// How many of them failed.
    public var failed: Int {
        hours.reduce(0) { $0 + $1.errors }
    }
}

/// A project as Now lists it: its name, what needs you there, the most urgent first, and its pulse.
public struct ProjectNow: Identifiable, Equatable, Sendable {
    public let key: String
    public let name: String
    /// Its items, the most urgent first; none for a project that didn't answer, whose items are
    /// missing.
    public let rows: [TodayRow]
    /// Whether it answered Today.
    public let answered: Bool
    /// Nil when it didn't answer, or the deployment is older than pulses.
    public let pulse: Pulse?

    public var id: String {
        key
    }
}

/// Today, as Now shows it: what needs attention now across the deployment's projects, the most urgent
/// first, and each project with its own items and its pulse. It opens with what it last saw, kept on
/// the phone, and keeps it when asking again fails.
@Observable
public final class TodayModel {
    /// The items, the most urgent first; nil until Today first arrives or is read from the phone.
    public private(set) var rows: [TodayRow]? = nil
    /// The projects: those that need you first, in the order of their most urgent item, then the
    /// rest by name; nil until Today first arrives.
    public private(set) var projects: [ProjectNow]? = nil
    /// When the deployment looked, for the items shown.
    public private(set) var lookedAt: Date? = nil
    public var problem: AnswerProblem? { answer.problem }
    public var isLoading: Bool { answer.isLoading }

    @ObservationIgnored let answer: Answer<TodayList>

    init(api: CluenoriAPI, context: AnswerContext) {
        answer = Answer(context, .init(key: "today") { () async throws(APIError) in try await api.today() })
        show()
    }

    /// Asks the deployment for Today, and keeps it on the phone. A refused key unpairs the phone.
    public func load() async {
        await answer.load()
        show()
    }

    /// The project `key` as Now lists it; nil until Today arrives, or when Today doesn't name it.
    public func project(_ key: String) -> ProjectNow? {
        projects?.first { $0.key == key }
    }

    // The rows and projects are kept as their own properties, so a view reading them doesn't depend
    // on the answer.
    private func show() {
        guard let list = answer.value else { return }
        let names = Dictionary(list.projects.map { ($0.key, $0.name) }, uniquingKeysWith: { first, _ in first })
        let rows = list.items.enumerated().map { index, item in Self.row(item, at: index, names: names) }
        self.rows = rows
        projects = Self.projects(list, rows: rows)
        lookedAt = list.at
    }

    private static func projects(_ list: TodayList, rows: [TodayRow]) -> [ProjectNow] {
        let pulses = Dictionary(
            (list.pulses ?? []).map { ($0.project, $0) }, uniquingKeysWith: { first, _ in first })
        let unanswered = Set(list.unanswered)
        let projects = list.projects.map { project in
            ProjectNow(
                key: project.key,
                name: project.name,
                rows: rows.filter { $0.projectKey == project.key },
                answered: !unanswered.contains(project.key),
                pulse: pulses[project.key].map(Self.pulse)
            )
        }
        // Those that need you, by their most urgent item, which Today put in order; then the rest.
        let firstRow = Dictionary(
            rows.enumerated().map { ($0.element.projectKey, $0.offset) }, uniquingKeysWith: { first, _ in first })
        return projects.sorted { left, right in
            switch (firstRow[left.key], firstRow[right.key]) {
            case (let left?, let right?): left < right
            case (.some, nil): true
            case (nil, .some): false
            case (nil, nil): left.name.localizedStandardCompare(right.name) == .orderedAscending
            }
        }
    }

    private static func pulse(_ pulse: ProjectPulse) -> Pulse {
        Pulse(
            hours: pulse.load,
            people: pulse.people.flatMap { people in
                UTCDay.date(people.latest.day).map { day in
                    PeopleNow(
                        day: day,
                        daily: people.latest.people,
                        monthly: people.latest.monthPeople,
                        dailyWeekBefore: people.weekBefore?.people,
                        monthlyWeekBefore: people.weekBefore?.monthPeople
                    )
                }
            }
        )
    }

    private static func row(_ item: TodayItem, at index: Int, names: [String: String]) -> TodayRow {
        switch item {
        case .incident(let item):
            TodayRow(
                id: "incident \(item.incident.id)",
                projectKey: item.project,
                project: names[item.project] ?? item.project,
                evidence: .incident(
                    title: item.incident.title,
                    cause: IncidentCause(item.incident.evidence),
                    openedAt: item.incident.openedAt,
                    acknowledged: item.incident.acknowledgedAt != nil
                ),
                route: .incident(project: item.project, id: item.incident.id)
            )
        case .error(let item):
            TodayRow(
                id: "error \(item.project) \(item.error.id)",
                projectKey: item.project,
                project: names[item.project] ?? item.project,
                evidence: .error(
                    title: item.error.title,
                    occurrences: item.error.occurrences,
                    firstSeen: item.error.firstSeen,
                    lastSeen: item.error.lastSeen,
                    isNew: item.isNew,
                    ongoing: item.ongoing
                ),
                route: .error(of: .project(item.project), id: item.error.id)
            )
        case .slower(let item):
            TodayRow(
                id: "slower \(item.project) \(item.component) \(item.environment ?? "") \(item.operation)",
                projectKey: item.project,
                project: names[item.project] ?? item.project,
                evidence: .slower(operation: item.operation, p95Ms: item.p95Ms, usualP95Ms: item.usualP95Ms),
                route: .operation(
                    OperationRef(
                        project: item.project,
                        component: item.component,
                        environment: item.environment,
                        name: item.operation
                    )
                )
            )
        case .quiet(let item):
            TodayRow(
                id: "quiet \(item.project) \(item.component) \(item.environment ?? "") \(item.operation)",
                projectKey: item.project,
                project: names[item.project] ?? item.project,
                evidence: .quiet(operation: item.operation, usualGapMs: item.usualGapMs, lastRanAt: item.lastRanAt),
                route: .operation(
                    OperationRef(
                        project: item.project,
                        component: item.component,
                        environment: item.environment,
                        name: item.operation
                    )
                )
            )
        case .promotion(let item):
            TodayRow(
                id: "promotion \(item.project) \(item.promotion)",
                projectKey: item.project,
                project: names[item.project] ?? item.project,
                evidence: .promotion(
                    release: item.release,
                    component: item.component,
                    environment: item.environment,
                    state: item.state,
                    since: item.endedAt ?? item.startedAt
                ),
                route: .release(
                    ReleaseRef(
                        project: item.project, component: item.component, environment: item.environment,
                        version: item.release))
            )
        case .silent(let item):
            TodayRow(
                id: "silent \(item.project)",
                projectKey: item.project,
                project: names[item.project] ?? item.project,
                evidence: .silent(lastDataAt: item.lastDataAt),
                route: .project(item.project)
            )
        case .unknown(let kind):
            TodayRow(
                id: "unknown \(index)", projectKey: "", project: "", evidence: .unknown(kind: kind), route: nil)
        }
    }
}
