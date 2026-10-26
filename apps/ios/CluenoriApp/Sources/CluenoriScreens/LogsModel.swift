import CluenoriClient
import Foundation
import Observation

/// A project's warnings and errors in one environment over a period, or one of its releases' over
/// its span, as log messages, the most lines first: of one level or all, and counting the lines with
/// a text in them or every line. Kept on the phone.
@Observable
public final class LogsModel {
    public let telemetry: Telemetry
    /// The release it is narrowed to, whose span it looks over; nil for a project's, over the period.
    public let release: ReleaseModel?
    /// Only this level and above; nil for warnings and errors alike.
    public private(set) var level: IndexedLevel? = nil
    /// Only lines with this text; empty for every line.
    public private(set) var search = ""
    public let messages: Answer<LogMessageTable>

    @ObservationIgnored private let api: CluenoriAPI
    @ObservationIgnored private let window: Window

    init(telemetry: Telemetry, period: PeriodKey, release: ReleaseModel?, api: CluenoriAPI, context: AnswerContext) {
        self.telemetry = telemetry
        self.release = release
        self.api = api
        window = release.map(Window.span) ?? .period(period)
        messages = Answer(context, Self.question(api, telemetry, window, nil, ""))
    }

    /// Asks again.
    public func refresh() async {
        await messages.load()
    }

    /// Counts only `level` and above and lines with `search` in them, asking again.
    public func filter(level: IndexedLevel?, search: String) async {
        let text = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard level != self.level || text != self.search else { return }
        self.level = level
        self.search = text
        messages.change(to: Self.question(api, telemetry, window, level, text))
        await messages.load()
    }

    private static func question(
        _ api: CluenoriAPI,
        _ telemetry: Telemetry,
        _ window: Window,
        _ level: IndexedLevel?,
        _ search: String
    ) -> Answer<LogMessageTable>.Question {
        let release = telemetry.release
        return .init(key: "\(telemetry.key)/log-messages/\(window.key)/\(level?.rawValue ?? "all")/\(search)") {
            () async throws(APIError) in
            let (from, to) = try await window.bounds()
            return try await api.logMessages(
                project: telemetry.project,
                from: from,
                to: to,
                environment: telemetry.environment,
                component: release?.component,
                release: release?.version,
                level: level,
                search: search.isEmpty ? nil : search
            )
        }
    }
}

/// One log message, whatever the period, with how many of its lines a project's environment holds
/// over the period, or a release's over its span, and its newest 100 lines there.
@Observable
public final class LogMessageModel {
    public let telemetry: Telemetry
    public let id: Int
    /// The release it is narrowed to, whose span it looks over; nil for a project's, over the period.
    public let release: ReleaseModel?
    /// Found whatever the period. Fails with `missing` for a message the project doesn't have.
    public let detail: Answer<LogMessageDetail>
    /// Its newest lines in the period, at most 100.
    public let lines: Answer<LogPage>

    init(
        telemetry: Telemetry,
        id: Int,
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
            .init(key: "\(telemetry.key)/log-message/\(id)/\(window.key)") { () async throws(APIError) in
                let (from, to) = try await window.bounds()
                return try await api.logMessage(
                    project: telemetry.project,
                    message: String(id),
                    from: from,
                    to: to,
                    environment: telemetry.environment,
                    component: narrowed?.component,
                    release: narrowed?.version
                )
            })
        lines = Answer(
            context,
            .init(key: "\(telemetry.key)/log-message/\(id)/lines/\(window.key)") { () async throws(APIError) in
                let (from, to) = try await window.bounds()
                return try await api.logs(
                    project: telemetry.project,
                    from: from,
                    to: to,
                    environment: telemetry.environment,
                    component: narrowed?.component,
                    release: narrowed?.version,
                    message: String(id)
                )
            })
    }

    /// Asks both again, at once.
    public func refresh() async {
        async let detail: Void = detail.load()
        async let lines: Void = lines.load()
        _ = await (detail, lines)
    }
}

/// One warning or error of a project, by its ID, whenever it was logged: kept 90 days.
@Observable
public final class LogLineModel {
    public let project: String
    public let id: Int
    /// Fails with `missing` once the line is no longer kept.
    public let line: Answer<LogLine>

    init(project: String, id: Int, api: CluenoriAPI, context: AnswerContext) {
        self.project = project
        self.id = id
        line = Answer(
            context,
            .init(key: "projects/\(project)/log-line/\(id)") { () async throws(APIError) in
                try await api.logLine(project: project, line: String(id))
            })
    }
}
