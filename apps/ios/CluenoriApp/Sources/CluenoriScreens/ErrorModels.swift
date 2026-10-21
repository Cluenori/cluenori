import CluenoriClient
import Foundation
import Observation

/// Every error group of a project over a period, the most frequent first.
@Observable
public final class ErrorsModel {
    public let project: String
    public let period: PeriodKey
    public let table: Answer<ErrorTable>

    init(project: String, period: PeriodKey, api: CluenoriAPI, context: AnswerContext) {
        self.project = project
        self.period = period
        table = Answer(
            context,
            .init(key: "projects/\(project)/errors/\(period.rawValue)") { () async throws(APIError) in
                let (from, to) = period.endingNow
                return try await api.errors(project: project, from: from, to: to)
            })
    }
}

/// One error group: what it is, how often, and its latest occurrences, with their exceptions.
@Observable
public final class ErrorModel {
    public let project: String
    public let id: String
    public let period: PeriodKey
    /// Fails with `unreadable` for an error the period doesn't have, which the API answers 404.
    public let detail: Answer<ErrorDetail>

    init(project: String, id: String, period: PeriodKey, api: CluenoriAPI, context: AnswerContext) {
        self.project = project
        self.id = id
        self.period = period
        detail = Answer(
            context,
            .init(key: "projects/\(project)/error/\(id)/\(period.rawValue)") { () async throws(APIError) in
                let (from, to) = period.endingNow
                return try await api.error(project: project, error: id, from: from, to: to)
            })
    }
}
