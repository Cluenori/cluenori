import CluenoriClient
import Foundation
import Observation

/// A project's overview in one environment over a period: its open incidents, its load, its errors,
/// and its latest warnings and errors, each shown at once from the phone and asked again together.
/// Its incidents are every environment's: the question takes none. Its delivery, which is every
/// environment's at once, is `DeploymentModels.delivery`'s.
@Observable
public final class ProjectModel {
    public let key: String
    /// The environment it shows; nil for every environment, from a deployment that doesn't tell them
    /// apart.
    public let environment: String?
    public private(set) var period: PeriodKey
    public let incidents: Answer<IncidentList>
    public let load: Answer<LoadSeries>
    public let operations: Answer<OperationTable>
    public let errors: Answer<ErrorTable>
    public let logs: Answer<LogPage>

    @ObservationIgnored private let api: CluenoriAPI
    @ObservationIgnored private let telemetry: Telemetry

    init(key: String, environment: String?, period: PeriodKey, api: CluenoriAPI, context: AnswerContext) {
        self.key = key
        self.environment = environment
        self.period = period
        self.api = api
        let telemetry = Telemetry.project(key, environment: environment)
        self.telemetry = telemetry
        incidents = Answer(
            context,
            .init(key: "projects/\(key)/incidents") { () async throws(APIError) in
                try await api.incidents(project: key)
            })
        load = Answer(context, Self.loadQuestion(api, telemetry, period))
        operations = Answer(context, Self.operationsQuestion(api, telemetry, period))
        errors = Answer(context, Self.errorsQuestion(api, telemetry, period))
        logs = Answer(context, Self.logsQuestion(api, telemetry, period))
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
        load.change(to: Self.loadQuestion(api, telemetry, period))
        operations.change(to: Self.operationsQuestion(api, telemetry, period))
        errors.change(to: Self.errorsQuestion(api, telemetry, period))
        logs.change(to: Self.logsQuestion(api, telemetry, period))
        await refresh()
    }

    private static func loadQuestion(_ api: CluenoriAPI, _ telemetry: Telemetry, _ period: PeriodKey)
        -> Answer<LoadSeries>.Question
    {
        .init(key: "\(telemetry.key)/load/\(period.rawValue)") { () async throws(APIError) in
            let (from, to) = period.endingNow
            return try await api.load(
                project: telemetry.project, from: from, to: to, step: period.step, environment: telemetry.environment)
        }
    }

    private static func operationsQuestion(
        _ api: CluenoriAPI,
        _ telemetry: Telemetry,
        _ period: PeriodKey
    ) -> Answer<OperationTable>.Question {
        .init(key: "\(telemetry.key)/operations/\(period.rawValue)") { () async throws(APIError) in
            let (from, to) = period.endingNow
            return try await api.operations(
                project: telemetry.project, from: from, to: to, environment: telemetry.environment)
        }
    }

    private static func errorsQuestion(_ api: CluenoriAPI, _ telemetry: Telemetry, _ period: PeriodKey)
        -> Answer<ErrorTable>.Question
    {
        .init(key: "\(telemetry.key)/errors/\(period.rawValue)") { () async throws(APIError) in
            let (from, to) = period.endingNow
            return try await api.errors(
                project: telemetry.project, from: from, to: to, environment: telemetry.environment)
        }
    }

    private static func logsQuestion(_ api: CluenoriAPI, _ telemetry: Telemetry, _ period: PeriodKey)
        -> Answer<LogPage>.Question
    {
        .init(key: "\(telemetry.key)/logs/\(period.rawValue)") { () async throws(APIError) in
            let (from, to) = period.endingNow
            return try await api.logs(
                project: telemetry.project, from: from, to: to, environment: telemetry.environment)
        }
    }
}
