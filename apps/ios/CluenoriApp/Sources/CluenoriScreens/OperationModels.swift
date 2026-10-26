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

/// One step of a chart, opened by a tap: the step, and the part of it the series' counts cover,
/// which is all of it but at the period's edges.
public struct Moment: Hashable, Sendable {
    /// Where the step starts and ends on the chart.
    public let start: Date
    public let end: Date
    /// The part of the step the counts cover: what its requests are asked for.
    public let from: Date
    public let to: Date

    /// The step of `series` that holds `date`; nil when the series doesn't cover it.
    public init?(at date: Date, in series: LoadSeries) {
        guard let covered = series.covered, date >= covered.from, date < covered.to else { return nil }
        let width = series.step.seconds
        start = Date(timeIntervalSince1970: (date.timeIntervalSince1970 / width).rounded(.down) * width)
        end = start.addingTimeInterval(width)
        from = max(start, covered.from)
        to = min(end, covered.to)
    }

    /// What ran in it, from the series; nil when nothing was reported then.
    public func point(in series: LoadSeries) -> LoadPoint? {
        series.points.first { $0.start == start }
    }
}

extension SeriesStep {
    /// How wide each step is.
    public var seconds: TimeInterval {
        switch self {
        case .`1m`: 60
        case .`5m`: 300
        case .`1h`: 3_600
        default: 86_400
        }
    }
}

extension KeptTraces {
    /// The requests kept, each once: the failed, newest first, then the slowest, slowest first.
    public var requests: [KeptTraceRow] {
        var seen = Set<String>()
        return (failed + slowest).filter { seen.insert("\($0.trace) \($0.operation)").inserted }
    }
}

/// The requests kept from moments of a chart, each asked once, by its question's key.
struct MomentRequests {
    private var asked: [Moment: Answer<KeptTraces>] = [:]

    mutating func requests(
        _ moment: Moment, key: String, api: CluenoriAPI, context: AnswerContext,
        ask: @escaping @Sendable (Moment) async throws(APIError) -> KeptTraces
    ) -> Answer<KeptTraces> {
        if let answer = asked[moment] { return answer }
        let answer = Answer(
            context,
            .init(key: "\(key)/moment/\(Int(moment.from.timeIntervalSince1970))") { () async throws(APIError) in
                try await ask(moment)
            })
        asked[moment] = answer
        return answer
    }
}

/// Every operation of a project in one environment over a period, or of one of its releases over
/// its span, with its percentiles, and their load, where a tap opens a moment and the requests kept
/// from it.
@Observable
public final class OperationsModel {
    public let telemetry: Telemetry
    /// The release it is narrowed to, whose span it looks over; nil for a project's, over the period.
    public let release: ReleaseModel?
    public let table: Answer<OperationTable>
    public let load: Answer<LoadSeries>
    public var order = OperationOrder.p95
    /// The moment opened on the chart, marked on it; nil for none.
    public var moment: Moment? = nil

    @ObservationIgnored private let api: CluenoriAPI
    @ObservationIgnored private let context: AnswerContext
    @ObservationIgnored private var moments = MomentRequests()

    init(telemetry: Telemetry, period: PeriodKey, release: ReleaseModel?, api: CluenoriAPI, context: AnswerContext) {
        self.telemetry = telemetry
        self.release = release
        self.api = api
        self.context = context
        let window = release.map(Window.span) ?? .period(period)
        let narrowed = telemetry.release
        load = Answer(
            context,
            .init(key: "\(telemetry.key)/load/\(window.key)") { () async throws(APIError) in
                let (from, to) = try await window.bounds()
                return try await api.load(
                    project: telemetry.project,
                    from: from,
                    to: to,
                    step: PeriodKey.step(over: to.timeIntervalSince(from)),
                    environment: telemetry.environment,
                    component: narrowed?.component,
                    release: narrowed?.version
                )
            })
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

    /// Asks both questions at once.
    public func refresh() async {
        async let load: Void = load.load()
        async let table: Void = table.load()
        _ = await (load, table)
    }

    /// The requests kept from `moment`, of every operation.
    public func requests(in moment: Moment) -> Answer<KeptTraces> {
        let telemetry = telemetry
        let api = api
        return moments.requests(moment, key: "\(telemetry.key)/operations", api: api, context: context) {
            moment async throws(APIError) in
            try await api.keptTraces(
                project: telemetry.project, from: moment.from, to: moment.to, environment: telemetry.environment,
                component: telemetry.release?.component, release: telemetry.release?.version)
        }
    }
}

/// One operation and its requests, in its environment, over a period and every release, or over one
/// release's span: its load and latency over time, where a tap opens a moment and the requests kept
/// from it; its percentiles; and its slowest and failed requests.
@Observable
public final class OperationModel {
    public let operation: OperationRef
    /// The release it is narrowed to, whose span it looks over; nil for every release, over the period.
    public let release: ReleaseModel?
    public let period: PeriodKey
    public let load: Answer<LoadSeries>
    /// The operation's row: one, or none when it didn't run in the period, with when it last ran.
    public let table: Answer<OperationTable>
    /// Its slowest and failed requests in the period, of those kept 14 days.
    public let kept: Answer<KeptTraces>
    /// The moment opened on its charts, marked on them; nil for none.
    public var moment: Moment? = nil

    @ObservationIgnored private let api: CluenoriAPI
    @ObservationIgnored private let context: AnswerContext
    @ObservationIgnored private let key: String
    @ObservationIgnored private var moments = MomentRequests()

    init(operation: OperationRef, period: PeriodKey, release: ReleaseModel?, api: CluenoriAPI, context: AnswerContext) {
        self.operation = operation
        self.release = release
        self.period = period
        self.api = api
        self.context = context
        let window = release.map(Window.span) ?? .period(period)
        let key =
            "projects/\(operation.project)/operation/\(operation.component)/\(operation.environment ?? "")/\(operation.name)"
            + (operation.release.map { "/release/\($0)" } ?? "")
        self.key = key
        kept = Answer(
            context,
            .init(key: "\(key)/kept/\(window.key)") { () async throws(APIError) in
                let (from, to) = try await window.bounds()
                return try await api.keptTraces(
                    project: operation.project,
                    from: from,
                    to: to,
                    environment: operation.environment,
                    component: operation.component,
                    release: operation.release,
                    operation: operation.name
                )
            })
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

    /// Asks its questions at once.
    public func refresh() async {
        async let load: Void = load.load()
        async let table: Void = table.load()
        async let kept: Void = kept.load()
        _ = await (load, table, kept)
    }

    /// The requests of this operation kept from `moment`.
    public func requests(in moment: Moment) -> Answer<KeptTraces> {
        let operation = operation
        let api = api
        return moments.requests(moment, key: key, api: api, context: context) { moment async throws(APIError) in
            try await api.keptTraces(
                project: operation.project, from: moment.from, to: moment.to, environment: operation.environment,
                component: operation.component, release: operation.release, operation: operation.name)
        }
    }
}

/// One request and its trace, by its trace ID, whenever it happened: its spans as a waterfall and
/// its logs, from the archive, kept 90 days.
@Observable
public final class TraceModel {
    public let trace: TraceRef
    public let view: Answer<TraceView>

    init(trace: TraceRef, api: CluenoriAPI, context: AnswerContext) {
        self.trace = trace
        view = Answer(
            context,
            .init(key: "projects/\(trace.project)/trace/\(trace.id)") { () async throws(APIError) in
                try await api.trace(project: trace.project, trace: trace.id, around: trace.around)
            })
    }

    /// One span on the waterfall: where its bar starts and how wide it is, as shares of the trace.
    public struct Row: Hashable, Identifiable, Sendable {
        public let span: TraceSpan
        public let offset: Double
        public let width: Double
        public var id: String { span.span }
    }

    /// A trace's spans in tree order, each placed on one time line from the first start to the last
    /// end; a trace of no length gives each the whole line.
    public static func waterfall(_ view: TraceView) -> [Row] {
        guard let start = view.spans.map(\.start).min() else { return [] }
        let end = view.spans.map { $0.start.addingTimeInterval($0.durationMs / 1_000) }.max() ?? start
        let total = end.timeIntervalSince(start)
        return view.spans.map { span in
            guard total > 0 else { return Row(span: span, offset: 0, width: 1) }
            let offset = span.start.timeIntervalSince(start) / total
            return Row(span: span, offset: offset, width: min(1 - offset, span.durationMs / 1_000 / total))
        }
    }

    /// The HTTP status a span answered with, when it says one: a whole number from 100 to 599.
    public static func status(of span: TraceSpan) -> Int? {
        guard case .number(let value) = span.attributes["http.response.status_code"],
            let status = Int(exactly: value), (100...599).contains(status)
        else { return nil }
        return status
    }

    /// One shell argument, whatever it holds: an operation's name is what the app sent, so a
    /// command quotes it rather than letting the shell read it.
    static func shellArgument(_ text: String) -> String {
        "'" + text.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    /// What an agent needs to look into a request: where it is, and how to read it and its
    /// operation; nil for a trace of no spans.
    public static func agentBrief(project: String, view: TraceView) -> String? {
        guard let root = view.spans.first else { return nil }
        let at = root.start.formatted(.iso8601)
        let status = status(of: root).map { ", answered \($0)" } ?? ""
        let failed = root.failed ? ", failed" : ""
        let message = root.statusMessage.map { ": \($0)" } ?? ""
        return [
            "Investigate this request in Cluenori project \(project).",
            "Trace \(view.trace): \(root.name) in \(root.component), at \(at), took \(Int(root.durationMs.rounded())) ms\(status)\(failed)\(message).",
            "\(view.spans.count) spans, \(view.logs.count) log records.",
            "Read every span and log with the API: GET /api/projects/\(project)/traces/\(view.trace)?around=\(at); or ./cluenori trace \(project) \(view.trace) --at \(at).",
            "Its operation over time, with its other slow and failed requests: ./cluenori operation \(project) \(shellArgument(root.name)) --component \(root.component).",
        ].joined(separator: "\n")
    }
}
