import CluenoriClient
import Foundation
import Observation

/// One item of Today, as a row shows it: its project's name, its evidence, and the screen it opens.
public struct TodayRow: Identifiable, Equatable, Sendable {
    /// What needs attention, with what shows it.
    public enum Evidence: Equatable, Sendable {
        /// An open incident.
        case incident(title: String, openedAt: Date, acknowledged: Bool)
        /// An error group new in the last day, happening in the last 15 minutes, or both.
        case error(title: String, occurrences: Int, lastSeen: Date, isNew: Bool, ongoing: Bool)
        /// An operation whose p95 over the last day is well over its usual.
        case slower(operation: String, p95Ms: Double, usualP95Ms: Double)
        /// A project that sent nothing in the last day; when it last did, if in the 8 days before.
        case silent(lastDataAt: Date?)
        /// A kind of item this version of the app doesn't know, from a newer deployment.
        case unknown(kind: String)
    }

    public let id: String
    public let project: String
    public let evidence: Evidence
    /// The screen with the evidence; nil for an item this version doesn't know.
    public let route: Route?
}

/// Today: what needs attention now across the deployment's projects, the most urgent first. It
/// opens with what it last saw, kept on the phone, and keeps it when asking again fails.
@Observable
public final class TodayModel {
    /// The items, the most urgent first; nil until Today first arrives or is read from the phone.
    public private(set) var rows: [TodayRow]? = nil
    /// The names of projects that didn't answer, whose items are missing.
    public private(set) var unanswered: [String] = []
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

    // The rows are kept as their own property, so a view reading them doesn't depend on the answer.
    private func show() {
        guard let list = answer.value else { return }
        let names = Dictionary(list.projects.map { ($0.key, $0.name) }, uniquingKeysWith: { first, _ in first })
        rows = list.items.enumerated().map { index, item in Self.row(item, at: index, names: names) }
        unanswered = list.unanswered.map { names[$0] ?? $0 }
        lookedAt = list.at
    }

    private static func row(_ item: TodayItem, at index: Int, names: [String: String]) -> TodayRow {
        switch item {
        case .incident(let item):
            TodayRow(
                id: "incident \(item.incident.id)",
                project: names[item.project] ?? item.project,
                evidence: .incident(
                    title: item.incident.title,
                    openedAt: item.incident.openedAt,
                    acknowledged: item.incident.acknowledgedAt != nil
                ),
                route: .project(item.project)
            )
        case .error(let item):
            TodayRow(
                id: "error \(item.project) \(item.error.id)",
                project: names[item.project] ?? item.project,
                evidence: .error(
                    title: item.error.title,
                    occurrences: item.error.occurrences,
                    lastSeen: item.error.lastSeen,
                    isNew: item.isNew,
                    ongoing: item.ongoing
                ),
                route: .error(of: .project(item.project), id: item.error.id)
            )
        case .slower(let item):
            TodayRow(
                id: "slower \(item.project) \(item.component) \(item.environment ?? "") \(item.operation)",
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
        case .silent(let item):
            TodayRow(
                id: "silent \(item.project)",
                project: names[item.project] ?? item.project,
                evidence: .silent(lastDataAt: item.lastDataAt),
                route: .project(item.project)
            )
        case .unknown(let kind):
            TodayRow(id: "unknown \(index)", project: "", evidence: .unknown(kind: kind), route: nil)
        }
    }
}
