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

    /// How wide a chart's bars are: about 30 to 300 of them, as fine as counts are kept.
    public var step: SeriesStep {
        switch self {
        case .hour: .`1m`
        case .day: .`5m`
        case .week: .`1h`
        case .month: .`1d`
        }
    }

    /// The period ending now: from, to.
    var endingNow: (from: Date, to: Date) {
        let now = Date.now
        return (now.addingTimeInterval(-length), now)
    }
}
