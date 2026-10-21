import CluenoriClient
import Foundation
import Observation

/// A project's overview over a period: its open incidents, its load, its errors, and its latest
/// warnings and errors, each shown at once from the phone and asked again together.
@Observable
public final class ProjectModel {
    public let key: String
    public private(set) var period: PeriodKey
    public let incidents: Answer<IncidentList>
    public let load: Answer<LoadSeries>
    public let operations: Answer<OperationTable>
    public let errors: Answer<ErrorTable>
    public let logs: Answer<LogPage>

    @ObservationIgnored private let api: CluenoriAPI

    init(key: String, period: PeriodKey, api: CluenoriAPI, context: AnswerContext) {
        self.key = key
        self.period = period
        self.api = api
        incidents = Answer(
            context,
            .init(key: "projects/\(key)/incidents") { () async throws(APIError) in
                try await api.incidents(project: key)
            })
        load = Answer(context, Self.loadQuestion(api, key, period))
        operations = Answer(context, Self.operationsQuestion(api, key, period))
        errors = Answer(context, Self.errorsQuestion(api, key, period))
        logs = Answer(context, Self.logsQuestion(api, key, period))
    }

    /// Asks every question at once.
    public func refresh() async {
        async let incidents: Void = incidents.load()
        async let load: Void = load.load()
        async let operations: Void = operations.load()
        async let errors: Void = errors.load()
        async let logs: Void = logs.load()
        _ = await (incidents, load, operations, errors, logs)
    }

    /// Looks over `period` instead, showing what the phone kept for it, then asking again.
    public func choose(_ period: PeriodKey) async {
        guard period != self.period else { return }
        self.period = period
        load.change(to: Self.loadQuestion(api, key, period))
        operations.change(to: Self.operationsQuestion(api, key, period))
        errors.change(to: Self.errorsQuestion(api, key, period))
        logs.change(to: Self.logsQuestion(api, key, period))
        await refresh()
    }

    private static func loadQuestion(_ api: CluenoriAPI, _ key: String, _ period: PeriodKey)
        -> Answer<LoadSeries>.Question
    {
        .init(key: "projects/\(key)/load/\(period.rawValue)") { () async throws(APIError) in
            let (from, to) = period.endingNow
            return try await api.load(project: key, from: from, to: to, step: period.step)
        }
    }

    private static func operationsQuestion(
        _ api: CluenoriAPI,
        _ key: String,
        _ period: PeriodKey
    ) -> Answer<OperationTable>.Question {
        .init(key: "projects/\(key)/operations/\(period.rawValue)") { () async throws(APIError) in
            let (from, to) = period.endingNow
            return try await api.operations(project: key, from: from, to: to)
        }
    }

    private static func errorsQuestion(_ api: CluenoriAPI, _ key: String, _ period: PeriodKey)
        -> Answer<ErrorTable>.Question
    {
        .init(key: "projects/\(key)/errors/\(period.rawValue)") { () async throws(APIError) in
            let (from, to) = period.endingNow
            return try await api.errors(project: key, from: from, to: to)
        }
    }

    private static func logsQuestion(_ api: CluenoriAPI, _ key: String, _ period: PeriodKey) -> Answer<LogPage>.Question
    {
        .init(key: "projects/\(key)/logs/\(period.rawValue)") { () async throws(APIError) in
            let (from, to) = period.endingNow
            return try await api.logs(project: key, from: from, to: to)
        }
    }
}
