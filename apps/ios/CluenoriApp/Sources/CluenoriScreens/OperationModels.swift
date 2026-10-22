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

/// Every operation of a project in one environment over a period, or of one of its releases over
/// its span, with its percentiles.
@Observable
public final class OperationsModel {
    public let telemetry: Telemetry
    /// The release it is narrowed to, whose span it looks over; nil for a project's, over the period.
    public let release: ReleaseModel?
    public let table: Answer<OperationTable>
    public var order = OperationOrder.p95

    init(telemetry: Telemetry, period: PeriodKey, release: ReleaseModel?, api: CluenoriAPI, context: AnswerContext) {
        self.telemetry = telemetry
        self.release = release
        let window = release.map(Window.span) ?? .period(period)
        let narrowed = telemetry.release
        table = Answer(
            context,
            .init(key: "\(telemetry.key)/operations/\(window.key)") { () async throws(APIError) in
                let (from, to) = try await window.bounds()
                return try await api.operations(
                    project: telemetry.project,
                    from: from,
                    to: to,
                    environment: telemetry.environment,
                    component: narrowed?.component,
                    release: narrowed?.version
                )
            })
    }
}

/// One operation in its environment, over a period and every release, or over one release's span:
/// its load and latency over time, and its percentiles.
@Observable
public final class OperationModel {
    public let operation: OperationRef
    /// The release it is narrowed to, whose span it looks over; nil for every release, over the period.
    public let release: ReleaseModel?
    public let period: PeriodKey
    public let load: Answer<LoadSeries>
    /// The operation's row: one, or none when it didn't run in the period.
    public let table: Answer<OperationTable>

    init(operation: OperationRef, period: PeriodKey, release: ReleaseModel?, api: CluenoriAPI, context: AnswerContext) {
        self.operation = operation
        self.release = release
        self.period = period
        let window = release.map(Window.span) ?? .period(period)
        let key =
            "projects/\(operation.project)/operation/\(operation.component)/\(operation.environment ?? "")/\(operation.name)"
            + (operation.release.map { "/release/\($0)" } ?? "")
        load = Answer(
            context,
            .init(key: "\(key)/load/\(window.key)") { () async throws(APIError) in
                let (from, to) = try await window.bounds()
                return try await api.load(
                    project: operation.project,
                    from: from,
                    to: to,
                    step: PeriodKey.step(over: to.timeIntervalSince(from)),
                    environment: operation.environment,
                    component: operation.component,
                    release: operation.release,
                    operation: operation.name
                )
            })
        table = Answer(
            context,
            .init(key: "\(key)/operations/\(window.key)") { () async throws(APIError) in
                let (from, to) = try await window.bounds()
                return try await api.operations(
                    project: operation.project,
                    from: from,
                    to: to,
                    environment: operation.environment,
                    component: operation.component,
                    release: operation.release,
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
