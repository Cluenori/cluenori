import CluenoriClient
import Foundation
import Observation

/// A project's warnings and errors over a period, newest first, 100 at a time: of one level or all,
/// and with a text in them or not. The newest page is kept on the phone; older ones load on demand.
@Observable
public final class LogsModel {
    public let project: String
    public let period: PeriodKey
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
    @ObservationIgnored private var next: Int? = nil

    init(project: String, period: PeriodKey, api: CluenoriAPI, context: AnswerContext) {
        self.project = project
        self.period = period
        self.api = api
        page = Answer(context, Self.question(api, project, period, nil, ""))
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
        page.change(to: Self.question(api, project, period, level, text))
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
        let (from, to) = period.endingNow
        let asked = (level, search)
        // Not handled: a failure here leaves the older lines out until the list is asked again;
        // the newest page shows its own problem.
        guard
            let older = try? await api.logs(
                project: project,
                from: from,
                to: to,
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
        _ project: String,
        _ period: PeriodKey,
        _ level: IndexedLevel?,
        _ search: String
    ) -> Answer<LogPage>.Question {
        .init(key: "projects/\(project)/logs/\(period.rawValue)/\(level?.rawValue ?? "all")/\(search)") {
            () async throws(APIError) in
            let (from, to) = period.endingNow
            return try await api.logs(
                project: project,
                from: from,
                to: to,
                level: level,
                search: search.isEmpty ? nil : search
            )
        }
    }
}
