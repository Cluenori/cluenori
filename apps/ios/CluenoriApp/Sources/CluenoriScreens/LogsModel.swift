import CluenoriClient
import Foundation
import Observation

/// A project's warnings and errors in one environment over a period, or one of its releases' over
/// its span, newest first, 100 at a time: of one level or all, and with a text in them or not. The
/// newest page is kept on the phone; older ones load on demand.
@Observable
public final class LogsModel {
    public let telemetry: Telemetry
    /// The release it is narrowed to, whose span it looks over; nil for a project's, over the period.
    public let release: ReleaseModel?
    /// Only this level; nil for warnings, errors, and fatal ones alike.
    public private(set) var level: IndexedLevel? = nil
    /// Only lines with this text; empty for every line.
    public private(set) var search = ""
    /// The newest page.
    public let page: Answer<LogPage>
    /// The pages older than the newest, as `loadOlder` adds them.
    public private(set) var older: [LogLine] = []
    /// Whether there are older lines than those shown.
    public private(set) var hasOlder = false
    public private(set) var isLoadingOlder = false

    @ObservationIgnored private let api: CluenoriAPI
    @ObservationIgnored private let window: Window
    @ObservationIgnored private var next: Int? = nil

    init(telemetry: Telemetry, period: PeriodKey, release: ReleaseModel?, api: CluenoriAPI, context: AnswerContext) {
        self.telemetry = telemetry
        self.release = release
        self.api = api
        window = release.map(Window.span) ?? .period(period)
        page = Answer(context, Self.question(api, telemetry, window, nil, ""))
        next = page.value?.next
        hasOlder = next != nil
    }

    /// Asks for the newest page again, and drops the older pages shown.
    public func refresh() async {
        await page.load()
        older = []
        next = page.value?.next
        hasOlder = next != nil
    }

    /// Shows only `level` and lines with `search` in them, asking again.
    public func filter(level: IndexedLevel?, search: String) async {
        let text = search.trimmingCharacters(in: .whitespacesAndNewlines)
        guard level != self.level || text != self.search else { return }
        self.level = level
        self.search = text
        page.change(to: Self.question(api, telemetry, window, level, text))
        older = []
        next = page.value?.next
        hasOlder = next != nil
        await refresh()
    }

    /// Adds the next older page, when there is one.
    public func loadOlder() async {
        guard let before = next, !isLoadingOlder else { return }
        isLoadingOlder = true
        defer { isLoadingOlder = false }
        let asked = (level, search)
        let release = telemetry.release
        // Not handled: a failure here leaves the older lines out until the list is asked again;
        // the newest page shows its own problem.
        guard
            let (from, to) = try? await window.bounds(),
            let older = try? await api.logs(
                project: telemetry.project,
                from: from,
                to: to,
                environment: telemetry.environment,
                component: release?.component,
                release: release?.version,
                level: level,
                search: search.isEmpty ? nil : search,
                before: String(before)
            ), asked == (level, search)
        else { return }
        self.older += older.lines
        next = older.next
        hasOlder = next != nil
    }

    private static func question(
        _ api: CluenoriAPI,
        _ telemetry: Telemetry,
        _ window: Window,
        _ level: IndexedLevel?,
        _ search: String
    ) -> Answer<LogPage>.Question {
        let release = telemetry.release
        return .init(key: "\(telemetry.key)/logs/\(window.key)/\(level?.rawValue ?? "all")/\(search)") {
            () async throws(APIError) in
            let (from, to) = try await window.bounds()
            return try await api.logs(
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
