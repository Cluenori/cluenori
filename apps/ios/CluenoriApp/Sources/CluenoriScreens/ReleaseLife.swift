import CluenoriClient
import Foundation

/// How a release's counts are compared with the release before's: in an hour for a life under a
/// day, else in a day, so lives of different lengths compare.
public enum RateUnit: Sendable {
    case hour, day

    public var seconds: TimeInterval {
        switch self {
        case .hour: 3_600
        case .day: 86_400
        }
    }
}

extension LifeTotals {
    /// How long it lived, from its first operation or signal to its last.
    public var lived: TimeInterval { max(to.timeIntervalSince(from), 0) }

    /// The unit its counts are compared in: an hour under a day, else a day.
    public var rateUnit: RateUnit { lived < RateUnit.day.seconds ? .hour : .day }

    /// How many of `value` it had in each `unit`, over how long it lived: at least an hour, so a
    /// release that ran a minute doesn't count sixty times its runs.
    public func rate(_ value: Int, per unit: RateUnit) -> Double {
        Double(value) * unit.seconds / max(RateUnit.hour.seconds, lived)
    }

    /// How many of its warnings or errors, `value`, it had in each `unit`, over the part of its life
    /// whose logs are kept (90 days), so an older release's isn't spread over days nothing was kept.
    public func logRate(_ value: Int, per unit: RateUnit) -> Double {
        let since = max(from, logsFrom ?? from)
        return Double(value) * unit.seconds / max(RateUnit.hour.seconds, to.timeIntervalSince(since))
    }

    /// The share of its requests that failed; nil without requests.
    public var failedShare: Double? {
        guard let requests, let failed, requests > 0 else { return nil }
        return Double(failed) / Double(requests)
    }
}

extension LifeStep {
    /// How long each step is.
    public var seconds: TimeInterval {
        switch self {
        case .`5m`: 300
        case .`1h`: 3_600
        default: 86_400
        }
    }
}

/// The steps of a release's life a chart shows, by their index in its points, first to last
/// inclusive.
public struct LifeWindow: Equatable, Sendable {
    public let first: Int
    public let last: Int

    public init(first: Int, last: Int) {
        self.first = first
        self.last = last
    }

    /// All of a life of `steps` steps.
    public static func whole(steps: Int) -> LifeWindow {
        LifeWindow(first: 0, last: max(0, steps - 1))
    }

    /// A window kept within a life of `steps` steps and at least `narrowest` steps wide (or the
    /// whole life, when it is shorter), whichever way it was dragged.
    public static func within(from: Int, to: Int, steps: Int, narrowest: Int = 3) -> LifeWindow {
        let last = max(0, steps - 1)
        let low = min(max(0, min(from, to)), last)
        let high = min(max(0, max(from, to)), last)
        let width = min(steps, narrowest)
        if high - low + 1 >= width {
            return LifeWindow(first: low, last: high)
        }
        let first = max(0, min(low, steps - width))
        return LifeWindow(first: first, last: first + width - 1)
    }

    /// It within a life of `steps` steps, as wide as it is where it fits; the whole life when it no
    /// longer fits, as when the life is shown in other steps.
    public func within(steps: Int) -> LifeWindow {
        last < steps ? self : .whole(steps: steps)
    }

    /// It a third narrower or, out, a third wider about its middle, kept within a life of `steps`
    /// steps and at least three steps wide.
    public func zoomed(in zoomIn: Bool, steps: Int) -> LifeWindow {
        let change = max(1, (last - first + 1) / 3)
        return zoomIn
            ? .within(from: first + change / 2, to: last - (change - change / 2), steps: steps)
            : .within(from: first - change, to: last + change, steps: steps)
    }

    /// Whether it shows all of a life of `steps` steps.
    public func isWhole(steps: Int) -> Bool { first == 0 && last >= steps - 1 }
}

/// What an agent needs to dig into a release: which one, its life against the one before, and how
/// to read everything behind the screen, through the CLI and the API. The same brief as the web's.
public func releaseBrief(project: String, detail: ReleaseDetail) -> String {
    let summary = detail.summary
    let iso = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
    // As JavaScript's encodeURIComponent leaves them.
    var unreserved = CharacterSet.alphanumerics.intersection(
        .init(charactersIn: Unicode.Scalar(0)...Unicode.Scalar(127)))
    unreserved.insert(charactersIn: "-_.!~*'()")
    func encoded(_ value: String) -> String { value.addingPercentEncoding(withAllowedCharacters: unreserved) ?? value }
    var scope = ["component=\(encoded(summary.component))"]
    if let environment = summary.environment { scope.append("environment=\(encoded(environment))") }
    scope.append("release=\(encoded(summary.release))")
    if let life = detail.life {
        scope.append("from=\(encoded(life.totals.from.formatted(iso)))")
        scope.append("to=\(encoded(life.totals.to.formatted(iso)))")
    }
    let query = scope.joined(separator: "&")
    let inEnvironment = summary.environment.map { " (\($0))" } ?? ""
    let environmentFlag = summary.environment.map { " --environment \($0)" } ?? ""
    var lines = [
        "Find out whether release \(summary.release) of \(summary.component)\(inEnvironment) works, in Cluenori project \(project).",
        summary.previous.map {
            "Compare it with the release before it, \($0): Cluenori says \"\(summary.verdict.rawValue)\"."
        } ?? "There is no release before it to compare with.",
        detail.life.map {
            "It ran from \($0.totals.from.formatted(iso)) to \($0.totals.to.formatted(iso))."
        } ?? "It hasn't run or sent anything yet.",
        "Read it whole, step by step: ./cluenori release \(project) \(summary.component) \(summary.release)\(environmentFlag) --life",
    ]
    if detail.life != nil {
        lines.append("Its operations: GET /api/projects/\(project)/operations?\(query)")
        lines.append("Its errors: GET /api/projects/\(project)/errors?\(query)")
        lines.append("Its warnings and errors: GET /api/projects/\(project)/logs?\(query)")
    }
    return lines.joined(separator: "\n")
}
