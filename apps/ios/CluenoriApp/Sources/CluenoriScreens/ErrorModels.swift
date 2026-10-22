import CluenoriClient
import Foundation
import Observation

/// Every error group of a project in one environment over a period, or of one of its releases over
/// its span, the most frequent first.
@Observable
public final class ErrorsModel {
    public let telemetry: Telemetry
    /// The release it is narrowed to, whose span it looks over; nil for a project's, over the period.
    public let release: ReleaseModel?
    public let table: Answer<ErrorTable>

    init(telemetry: Telemetry, period: PeriodKey, release: ReleaseModel?, api: CluenoriAPI, context: AnswerContext) {
        self.telemetry = telemetry
        self.release = release
        let window = release.map(Window.span) ?? .period(period)
        let narrowed = telemetry.release
        table = Answer(
            context,
            .init(key: "\(telemetry.key)/errors/\(window.key)") { () async throws(APIError) in
                let (from, to) = try await window.bounds()
                return try await api.errors(
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

/// One error group, in a project's environment over a period, or in one of its releases over its
/// span: what it is, how often, and its latest occurrences, with their exceptions.
@Observable
public final class ErrorModel {
    public let telemetry: Telemetry
    public let id: String
    /// The release it is narrowed to, whose span it looks over; nil for a project's, over the period.
    public let release: ReleaseModel?
    /// Fails with `missing` for an error the period, or the release, doesn't have, which the API
    /// answers 404.
    public let detail: Answer<ErrorDetail>

    init(
        telemetry: Telemetry,
        id: String,
        period: PeriodKey,
        release: ReleaseModel?,
        api: CluenoriAPI,
        context: AnswerContext
    ) {
        self.telemetry = telemetry
        self.id = id
        self.release = release
        let window = release.map(Window.span) ?? .period(period)
        let narrowed = telemetry.release
        detail = Answer(
            context,
            .init(key: "\(telemetry.key)/error/\(id)/\(window.key)") { () async throws(APIError) in
                let (from, to) = try await window.bounds()
                return try await api.error(
                    project: telemetry.project,
                    error: id,
                    from: from,
                    to: to,
                    environment: telemetry.environment,
                    component: narrowed?.component,
                    release: narrowed?.version
                )
            })
    }
}
