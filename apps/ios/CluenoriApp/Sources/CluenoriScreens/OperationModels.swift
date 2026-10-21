import CluenoriClient
import Foundation
import Observation

/// How a list of operations is ordered: by a percentile, or by how often they ran or failed, the
/// most first.
public enum OperationOrder: String, CaseIterable, Hashable, Sendable {
    case p50, p80, p95, p99, count, errors

    /// `rows`, the most first.
    public func sorted(_ rows: [OperationRow]) -> [OperationRow] {
        rows.sorted { measure($0) > measure($1) }
    }

    private func measure(_ row: OperationRow) -> Double {
        switch self {
        case .p50: row.p50Ms
        case .p80: row.p80Ms
        case .p95: row.p95Ms
        case .p99: row.p99Ms
        case .count: Double(row.count)
        case .errors: Double(row.errors)
        }
    }
}

/// Every operation of a project over a period, with its percentiles.
@Observable
public final class OperationsModel {
    public let project: String
    public let period: PeriodKey
    public let table: Answer<OperationTable>
    public var order = OperationOrder.p95

    init(project: String, period: PeriodKey, api: CluenoriAPI, context: AnswerContext) {
        self.project = project
        self.period = period
        table = Answer(
            context,
            .init(key: "projects/\(project)/operations/\(period.rawValue)") { () async throws(APIError) in
                let (from, to) = period.endingNow
                return try await api.operations(project: project, from: from, to: to)
            })
    }
}

/// One operation over a period: its load and latency over time, and its percentiles.
@Observable
public final class OperationModel {
    public let operation: OperationRef
    public let period: PeriodKey
    public let load: Answer<LoadSeries>
    /// The operation's row: one, or none when it didn't run in the period.
    public let table: Answer<OperationTable>

    init(operation: OperationRef, period: PeriodKey, api: CluenoriAPI, context: AnswerContext) {
        self.operation = operation
        self.period = period
        let key =
            "projects/\(operation.project)/operation/\(operation.component)/\(operation.environment ?? "")/\(operation.name)"
        load = Answer(
            context,
            .init(key: "\(key)/load/\(period.rawValue)") { () async throws(APIError) in
                let (from, to) = period.endingNow
                return try await api.load(
                    project: operation.project,
                    from: from,
                    to: to,
                    step: period.step,
                    environment: operation.environment,
                    component: operation.component,
                    operation: operation.name
                )
            })
        table = Answer(
            context,
            .init(key: "\(key)/operations/\(period.rawValue)") { () async throws(APIError) in
                let (from, to) = period.endingNow
                return try await api.operations(
                    project: operation.project,
                    from: from,
                    to: to,
                    environment: operation.environment,
                    component: operation.component,
                    operation: operation.name
                )
            })
    }

    /// Asks both questions at once.
    public func refresh() async {
        async let load: Void = load.load()
        async let table: Void = table.load()
        _ = await (load, table)
    }
}
