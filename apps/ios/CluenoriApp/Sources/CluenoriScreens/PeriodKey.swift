import CluenoriClient
import Foundation

/// How far back a screen looks, as the web's period switch: the last hour, day, 7 days, or 30 days.
public enum PeriodKey: String, CaseIterable, Hashable, Sendable {
    case hour = "1h"
    case day = "24h"
    case week = "7d"
    case month = "30d"

    /// How long it is.
    public var length: TimeInterval {
        switch self {
        case .hour: 3_600
        case .day: 86_400
        case .week: 7 * 86_400
        case .month: 30 * 86_400
        }
    }

    /// The next longer period, to look further back; nil for the longest.
    public var longer: PeriodKey? {
        let all = Self.allCases
        guard let index = all.firstIndex(of: self), index + 1 < all.count else { return nil }
        return all[index + 1]
    }

    /// How wide a chart's bars are: about 30 to 300 of them, as fine as counts are kept.
    public var step: SeriesStep {
        switch self {
        case .hour: .`1m`
        case .day: .`5m`
        case .week: .`1h`
        case .month: .`1d`
        }
    }

    /// How wide a chart's bars are over `length`, as over the shortest period at least as long: a
    /// release's span charts as its period would.
    static func step(over length: TimeInterval) -> SeriesStep {
        (allCases.first { $0.length >= length } ?? .month).step
    }

    /// The period ending now: from, to.
    var endingNow: (from: Date, to: Date) {
        let now = Date.now
        return (now.addingTimeInterval(-length), now)
    }
}

/// When a screen's questions look, and how their answers are kept apart: over the period chosen,
/// ending now, for a project's telemetry; over a release's whole span, for one release's.
struct Window {
    /// What sets its answers apart from another window's of the same question.
    let key: String
    /// Its from and to, as a question asks them; may ask the deployment first.
    let bounds: () async throws(APIError) -> (from: Date, to: Date)

    static func period(_ period: PeriodKey) -> Window {
        Window(key: period.rawValue) { period.endingNow }
    }

    /// A release's span, from its detail; one window whatever the span, as a release keeps one.
    static func span(of release: ReleaseModel) -> Window {
        Window(key: "span") { () async throws(APIError) in
            try await release.span()
        }
    }
}
