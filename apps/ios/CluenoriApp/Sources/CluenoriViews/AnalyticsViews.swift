import Charts
import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

// The rows, charts and words of a project's apps' analytics: usage by UTC day, retention, app
// health, and features.

/// UTC, which apps' days are counted in: their dates are read in it, whatever the phone's zone.
let utc = TimeZone(identifier: "UTC") ?? .gmt

/// A UTC day, as a date people read: `Oct 22`.
func utcDayStyle() -> Date.FormatStyle {
    var style = Date.FormatStyle.dateTime.month(.abbreviated).day()
    style.timeZone = utc
    return style
}

/// The analytics period switch: 7, 30 or 90 UTC days, as on the web.
struct AnalyticsPeriodPicker: View {
    @Binding var period: AnalyticsPeriod

    var body: some View {
        Picker(selection: $period) {
            ForEach(AnalyticsPeriod.allCases, id: \.self) { period in
                Text(verbatim: "\(period.days)d").tag(period)
            }
        } label: {
            Text("Period", bundle: #bundle, comment: "The picker of how far back screens look.")
        }
        .pickerStyle(.segmented)
    }
}

/// The analytics period as words inside a sentence: "the last 30 days".
func analyticsPeriodPhrase(_ period: AnalyticsPeriod) -> Text {
    Text(
        "the last \(period.days) days",
        bundle: #bundle,
        comment: "A period of UTC days, inside a sentence. The variable is how many days: 7, 30 or 90."
    )
}

/// What one usage series counts, as its chart is titled: `DAU`, `WAU`, `MAU`, `Sessions`.
struct UsageSeriesName: View {
    let kind: UsageSeries.Kind

    var body: some View {
        switch kind {
        case .dailyPeople: Text("DAU", bundle: #bundle, comment: "Daily active people, the standard term.")
        case .weeklyPeople:
            Text("WAU", bundle: #bundle, comment: "People active in the 7 days ending each day, the standard term.")
        case .monthlyPeople:
            Text("MAU", bundle: #bundle, comment: "People active in the 30 days ending each day, the standard term.")
        case .sessions: Text("Sessions", bundle: #bundle, comment: "Sessions started each day.")
        }
    }
}

/// One usage series: its name and its latest day's count, readable at once, over bars by UTC day.
/// A day without a bar wasn't counted, which isn't the same as none.
struct UsageChartRow: View {
    let series: UsageSeries
    /// The UTC days the chart spans: the whole period.
    let days: ClosedRange<Date>
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            TitleAndValue {
                UsageSeriesName(kind: series.kind)
                    .font(.subheadline.weight(.semibold))
            } value: {
                VStack(alignment: size.isAccessibilitySize ? .leading : .trailing, spacing: 0) {
                    if let latest = series.latest {
                        Text(latest, format: .number)
                            .font(.title3.monospacedDigit().weight(.semibold))
                    } else {
                        unknownLatest
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.trailing)
                    }
                    if let day = series.latestDay {
                        Group {
                            // Today's count grows until the UTC day ends.
                            if day == UTCDay.start(of: .now) {
                                Text(
                                    "\(day, format: utcDayStyle()), so far", bundle: #bundle,
                                    comment:
                                        "The latest day of a usage chart, which hasn't ended. The variable is a day.")
                            } else {
                                Text(day, format: utcDayStyle())
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                }
            }
            .accessibilityElement(children: .combine)
            if !series.points.isEmpty {
                Chart(series.points, id: \.day) { point in
                    RectangleMark(
                        xStart: .value(String(localized: "Day", bundle: #bundle), point.day.addingTimeInterval(3_600)),
                        xEnd: .value(String(localized: "Day", bundle: #bundle), point.day.addingTimeInterval(82_800)),
                        yStart: .value(String(localized: "Count", bundle: #bundle), 0),
                        yEnd: .value(String(localized: "Count", bundle: #bundle), point.value)
                    )
                    .foregroundStyle(series.kind == .sessions ? Color.purple : Color.accentColor)
                    .accessibilityLabel(Text(point.day, format: utcDayStyle()))
                    .accessibilityValue(Text(point.value, format: .number))
                }
                .chartXScale(domain: days)
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                        AxisGridLine()
                        AxisValueLabel(format: utcDayStyle())
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading, values: .automatic(desiredCount: 2))
                }
                // Its days are UTC days, whatever the phone's zone.
                .environment(\.timeZone, utc)
                // Its axes' labels stop growing where they would overlap; the counts above it don't.
                .dynamicTypeSize(...DynamicTypeSize.xLarge)
                .frame(height: 72)
                .accessibilityLabel(
                    Text(
                        "\(Text(verbatim: seriesName)) by UTC day",
                        bundle: #bundle,
                        comment: "What a usage chart shows to VoiceOver. The variable is DAU, WAU, MAU or Sessions."
                    ))
            }
        }
        .padding(.vertical, 4)
    }

    private var seriesName: String {
        switch series.kind {
        case .dailyPeople: "DAU"
        case .weeklyPeople: "WAU"
        case .monthlyPeople: "MAU"
        case .sessions: String(localized: "Sessions", bundle: #bundle, comment: "Sessions started each day.")
        }
    }

    // The latest day's count, when it isn't known: a week or month reaching before the first day
    // counted.
    @ViewBuilder private var unknownLatest: some View {
        switch series.kind {
        case .weeklyPeople:
            Text(
                "Unknown until 7 days are counted", bundle: #bundle,
                comment: "WAU when fewer than 7 days of the apps' use are counted.")
        case .monthlyPeople:
            Text(
                "Unknown until 30 days are counted", bundle: #bundle,
                comment: "MAU when fewer than 30 days of the apps' use are counted.")
        default:
            Text("Unknown", bundle: #bundle, comment: "A count the deployment doesn't know.")
        }
    }
}

/// A row's title with its value trailing it, side by side; stacked at accessibility sizes, so
/// neither a version nor a word is broken to fit beside the other.
struct TitleAndValue<Title: View, Value: View>: View {
    @ViewBuilder let title: Title
    @ViewBuilder let value: Value
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        if size.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 2) {
                title
                value
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                title
                Spacer(minLength: 8)
                value
            }
        }
    }
}

/// A count with its name: `People  5,105`, the number never truncated.
struct CountRow: View {
    let title: Text
    let value: Int

    var body: some View {
        LabeledContent {
            Text(value, format: .number)
                .monospacedDigit()
                .foregroundStyle(.primary)
        } label: {
            title
        }
    }
}

/// One release's share of a period's usage: `0.3.0+20`, where it ran, its people and sessions.
struct ReleaseUsageRow: View {
    let release: String
    let component: String
    let environment: String
    let people: Int
    let sessions: Int
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        TitleAndValue {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: release)
                    .unhyphenated()
                    .font(.body.monospaced())
                    .lineLimit(2)
                Text(verbatim: "\(component) · \(environment)")
                    .unhyphenated()
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        } value: {
            VStack(alignment: size.isAccessibilitySize ? .leading : .trailing, spacing: 2) {
                Text(
                    "^[\(people) person](inflect: true)", bundle: #bundle,
                    comment: "How many people a release had. The variable is a count."
                )
                .monospacedDigit()
                Text(
                    "^[\(sessions) session](inflect: true)", bundle: #bundle,
                    comment: "How many sessions a release had. The variable is a count."
                )
                .monospacedDigit()
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
            .multilineTextAlignment(size.isAccessibilitySize ? .leading : .trailing)
        }
        .accessibilityElement(children: .combine)
    }
}

/// One weekly cohort: its week and people, and the share of them active each week since, the last
/// marked when it is the week now, so far: `44% · 31% · 12% so far`.
struct RetentionCohortRow: View {
    let row: RetentionRow

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            TitleAndValue {
                Text(
                    "Week of \(row.week, format: utcDayStyle())", bundle: #bundle,
                    comment: "A weekly cohort, by the Monday its week starts. The variable is a day.")
            } value: {
                Text(
                    "^[\(row.people) person](inflect: true)", bundle: #bundle,
                    comment: "How many people a cohort has. The variable is a count."
                )
                .monospacedDigit()
                .foregroundStyle(.secondary)
            }
            if row.shares.count > 1 {
                RetentionBars(shares: row.shares, lastIsSoFar: row.lastIsSoFar)
                    .frame(height: 28)
                    .accessibilityHidden(true)
                Text(verbatim: sharesText)
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            } else {
                Text(
                    "First week, so far", bundle: #bundle,
                    comment: "A cohort first seen in the week now is in: nothing to show of the weeks after."
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    // The shares after the first week, which is all of them: `44% · 31% · 12% so far`.
    private var sharesText: String {
        let after = Array(row.shares.dropFirst())
        return after.enumerated().map { index, share in
            let percent = share.formatted(.percent.precision(.fractionLength(0)))
            guard index == after.count - 1, row.lastIsSoFar else { return percent }
            return String(
                localized: "\(percent) so far", bundle: #bundle,
                comment:
                    "The share of a cohort active in the week now is in, which hasn't ended. The variable is a percentage."
            )
        }.joined(separator: " · ")
    }
}

/// A cohort's shares as small bars, one per week, the week now, so far, lighter.
private struct RetentionBars: View {
    let shares: [Double]
    let lastIsSoFar: Bool

    var body: some View {
        GeometryReader { geometry in
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(Array(shares.enumerated()), id: \.offset) { index, share in
                    let soFar = lastIsSoFar && index == shares.count - 1
                    Rectangle()
                        .fill(Color.accentColor.opacity(soFar ? 0.4 : 1))
                        .frame(height: max(2, geometry.size.height * min(max(share, 0), 1)))
                        .frame(maxWidth: 28)
                }
            }
            .frame(maxHeight: .infinity, alignment: .bottom)
        }
    }
}

/// What a release's app health compares by, in a verdict's reasons: `cold launch slower`.
func healthMeasureWords(_ measure: HealthMeasure, worse: Bool) -> String? {
    switch (measure, worse) {
    case (.coldLaunch, true):
        String(localized: "cold launch slower", bundle: #bundle, comment: "What made a release's app health worse.")
    case (.coldLaunch, false):
        String(localized: "cold launch faster", bundle: #bundle, comment: "What made a release's app health better.")
    case (.warmLaunch, true):
        String(localized: "warm launch slower", bundle: #bundle, comment: "What made a release's app health worse.")
    case (.warmLaunch, false):
        String(localized: "warm launch faster", bundle: #bundle, comment: "What made a release's app health better.")
    case (.memory, true):
        String(localized: "more memory", bundle: #bundle, comment: "What made a release's app health worse.")
    case (.memory, false):
        String(localized: "less memory", bundle: #bundle, comment: "What made a release's app health better.")
    case (.crashes, true):
        String(localized: "more crashes", bundle: #bundle, comment: "What made a release's app health worse.")
    case (.crashes, false):
        String(localized: "fewer crashes", bundle: #bundle, comment: "What made a release's app health better.")
    case (.hangs, true):
        String(localized: "more hangs", bundle: #bundle, comment: "What made a release's app health worse.")
    case (.hangs, false):
        String(localized: "fewer hangs", bundle: #bundle, comment: "What made a release's app health better.")
    default: nil
    }
}

/// An app health verdict in words, with what made it so: `Worse: cold launch slower, more crashes`,
/// `Better: fewer hangs`, `About the same`.
struct HealthVerdictText: View {
    let verdict: HealthVerdict
    let worse: [HealthMeasure]
    let better: [HealthMeasure]

    var body: some View {
        switch verdict {
        case .worse:
            let reasons = worse.compactMap { healthMeasureWords($0, worse: true) }
            if reasons.isEmpty {
                Text("Worse", bundle: #bundle, comment: "A release's verdict: something got worse.")
            } else {
                Text(
                    "Worse: \(reasons, format: .list(type: .and, width: .narrow))", bundle: #bundle,
                    comment:
                        "A release's app health verdict, with what got worse, such as: cold launch slower, more crashes."
                )
            }
        case .better:
            let reasons = better.compactMap { healthMeasureWords($0, worse: false) }
            if reasons.isEmpty {
                Text("Better", bundle: #bundle, comment: "A release's verdict: something got better, nothing worse.")
            } else {
                Text(
                    "Better: \(reasons, format: .list(type: .and, width: .narrow))", bundle: #bundle,
                    comment: "A release's app health verdict, with what got better, such as: fewer hangs.")
            }
        case .same:
            Text("About the same", bundle: #bundle, comment: "A release's verdict: nothing moved enough to tell.")
        case .tooEarly:
            Text("Too early to tell", bundle: #bundle, comment: "A release's verdict: it hasn't run enough yet.")
        case .first:
            Text("First release counted", bundle: #bundle, comment: "A release's verdict: none before it to compare.")
        case .unmeasured:
            Text(
                "Nothing measured yet", bundle: #bundle,
                comment: "A release's app health verdict: no sessions or launches from it yet.")
        default:
            Text(
                "A verdict this version can't show. Update the app.",
                bundle: #bundle,
                comment: "A release's verdict of a kind this app doesn't know."
            )
        }
    }
}

extension HealthVerdict {
    /// The release verdict of the same name, whose symbol and color it shows with.
    var asVerdict: Verdict {
        Verdict(rawValue: rawValue)
    }
}

/// One release's app health in a list: its verdict, what made it so, where it ran, and how much.
struct ReleaseHealthRow: View {
    let release: String
    let component: String
    let environment: String
    let previous: String?
    let sessions: Int
    let verdict: HealthVerdict
    let worse: [HealthMeasure]
    let better: [HealthMeasure]

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: verdict.asVerdict.symbol)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(verdict.asVerdict.tint)
                .font(.title3)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                TitleAndValue {
                    Text(verbatim: release)
                        .unhyphenated()
                        .font(.body.monospaced())
                        .lineLimit(2)
                } value: {
                    Text(
                        "^[\(sessions) session](inflect: true)", bundle: #bundle,
                        comment: "How many sessions a release had. The variable is a count."
                    )
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
                }
                HealthVerdictText(verdict: verdict, worse: worse, better: better)
                    .font(.subheadline)
                    .foregroundStyle(verdict.asVerdict.tint)
                Group {
                    if let previous {
                        Text(
                            "\(component) · \(environment) · after \(Text(verbatim: previous).monospaced())",
                            bundle: #bundle,
                            comment:
                                "Where a release ran, and the release before it. The variables are a component, an environment and a version."
                        )
                    } else {
                        Text(verbatim: "\(component) · \(environment)")
                            .unhyphenated()
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// What a feature key names in a list: the key, or `(no feature)` for signals the app marked with
/// none.
struct FeatureName: View {
    let feature: String?

    var body: some View {
        if let feature {
            Text(verbatim: feature)
                .unhyphenated()
                .font(.body.monospaced())
        } else {
            Text(
                "(no feature)", bundle: #bundle,
                comment: "The row of signals the app marked with no feature key. Parentheses as is."
            )
            .italic()
            .foregroundStyle(.secondary)
        }
    }
}

/// How one feature was used: its people, events and screens, and the app's peak memory there when
/// measured.
struct FeatureRow: View {
    let feature: String?
    let people: Int
    let events: Int
    let screens: Int
    /// Absent when never measured in it.
    let peakMemoryP95Bytes: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            TitleAndValue {
                FeatureName(feature: feature)
                    .lineLimit(2)
            } value: {
                Text(
                    "^[\(people) person](inflect: true)", bundle: #bundle,
                    comment: "How many people used a feature. The variable is a count."
                )
                .monospacedDigit()
                .fontWeight(.semibold)
            }
            Text(
                "\(Text("^[\(events) event](inflect: true)", bundle: #bundle, comment: "How many events a feature had. The variable is a count.")) · \(Text("^[\(screens) screen](inflect: true)", bundle: #bundle, comment: "How many screens a feature showed. The variable is a count."))",
                bundle: #bundle,
                comment: "A feature's events and screens. The variables are counts, as words."
            )
            .font(.subheadline.monospacedDigit())
            .foregroundStyle(.secondary)
            if let peakMemoryP95Bytes {
                Text(
                    "peak memory p95 \(Int64(peakMemoryP95Bytes.rounded()), format: .byteCount(style: .memory))",
                    bundle: #bundle,
                    comment: "The p95 of the app's peak memory in a feature. The variable is a size, such as 312 MB."
                )
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// A part of a release's app health, as its section is headed.
struct HealthGroupTitle: View {
    let kind: HealthGroup.Kind

    var body: some View {
        switch kind {
        case .coldLaunch: Text("Cold launch", bundle: #bundle, comment: "Section of a release's cold launch times.")
        case .warmLaunch: Text("Warm launch", bundle: #bundle, comment: "Section of a release's warm launch times.")
        case .memory: Text("Memory", bundle: #bundle, comment: "Section of a release's memory use.")
        case .metricKit:
            Text(
                "Crashes and hangs", bundle: #bundle,
                comment: "Section of what MetricKit reported of a release: crashes, hangs.")
        case .use: Text("Use", bundle: #bundle, comment: "Section of how much a release was used.")
        }
    }
}

/// One measure of a release's app health, beside the release before it's: `p95 to first frame
/// 1.4 s, was 600 ms`, in the verdict's color when it is what made it worse or better.
struct HealthLineRow: View {
    let line: HealthLine

    var body: some View {
        LabeledContent {
            VStack(alignment: .trailing, spacing: 2) {
                Text(verbatim: Self.words(line.value))
                    .monospacedDigit()
                    .fontWeight(line.move == nil ? .regular : .semibold)
                    .foregroundStyle(tint)
                if let previous = line.previous {
                    Text(
                        "was \(Self.words(previous))", bundle: #bundle,
                        comment:
                            "A measure of the release before, beside this release's. The variable is a value, such as 600 ms."
                    )
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
                }
            }
            .multilineTextAlignment(.trailing)
        } label: {
            HealthLineName(kind: line.kind)
        }
        .accessibilityElement(children: .combine)
    }

    private var tint: Color {
        switch line.move {
        case .worse: Verdict.worse.tint
        case .better: Verdict.better.tint
        case nil: .primary
        }
    }

    /// A measure's value as people read it: `1.4 s`, `312 MB`, `4,210`, `3.2`.
    static func words(_ value: HealthLine.Value) -> String {
        switch value {
        case .milliseconds(let milliseconds):
            Duration.milliseconds(milliseconds).formatted(DurationText.style(milliseconds))
        case .bytes(let bytes): Int64(bytes.rounded()).formatted(.byteCount(style: .memory))
        case .count(let count): count.formatted(.number)
        case .perThousand(let rate): rate.formatted(.number.precision(.fractionLength(0...1)))
        }
    }
}

/// What a measure of app health is.
struct HealthLineName: View {
    let kind: HealthLine.Kind

    var body: some View {
        switch kind {
        case .launches:
            Text(
                "Launches", bundle: #bundle, comment: "How many launches of a kind were timed, prewarmed ones left out."
            )
        case .firstFrameP50:
            Text("p50 to first frame", bundle: #bundle, comment: "A launch time's median to the first frame.")
        case .firstFrameP95:
            Text("p95 to first frame", bundle: #bundle, comment: "A launch time's p95 to the first frame.")
        case .readyP50:
            Text(
                "p50 to first useful screen", bundle: #bundle,
                comment: "A launch time's median to the app's first useful screen.")
        case .readyP95:
            Text(
                "p95 to first useful screen", bundle: #bundle,
                comment: "A launch time's p95 to the app's first useful screen.")
        case .peakP95: Text("Peak memory p95", bundle: #bundle, comment: "The p95 of a release's peak memory.")
        case .footprintP95: Text("Footprint p95", bundle: #bundle, comment: "The p95 of a release's memory footprint.")
        case .crashesPerThousand:
            Text("Crashes per 1,000 sessions", bundle: #bundle, comment: "MetricKit's crashes, per 1,000 sessions.")
        case .hangsPerThousand:
            Text("Hangs per 1,000 sessions", bundle: #bundle, comment: "MetricKit's hangs, per 1,000 sessions.")
        case .crashes: Text("Crashes", bundle: #bundle, comment: "How many crashes MetricKit reported.")
        case .hangs: Text("Hangs", bundle: #bundle, comment: "How many hangs MetricKit reported.")
        case .reports: Text("MetricKit reports", bundle: #bundle, comment: "How many reports MetricKit sent.")
        case .sessions: Text("Sessions", bundle: #bundle, comment: "How many sessions a release had.")
        case .people: Text("People", bundle: #bundle, comment: "How many people a release had.")
        case .prewarmed:
            Text(
                "Prewarmed launches", bundle: #bundle,
                comment: "Launches iOS prewarmed, whose times aren't comparable, so only counted.")
        }
    }
}

/// Copies `text` to the phone's pasteboard.
@MainActor func copyToPasteboard(_ text: String) {
    #if canImport(UIKit)
        UIPasteboard.general.string = text
    #endif
}

// MARK: - Previews, on made-up values

#if DEBUG
    enum AnalyticsPreviewData {
        static let now = UTCDay.date("2026-10-22")!.addingTimeInterval(15 * 3_600)

        static func days(_ count: Int, weekFrom: Int = 7, monthFrom: Int = 30) -> [UsageDay] {
            (0..<count).map { index in
                let day = UTCDay.date("2026-10-22")!.addingTimeInterval(-Double(count - 1 - index) * 86_400)
                let people = 700 + (index * 37 % 120)
                let text = day.formatted(.iso8601.year().month().day())
                return UsageDay(
                    day: text, people: people, installations: people + 40,
                    weekPeople: index + 1 >= weekFrom ? 2_300 + index * 5 : nil,
                    monthPeople: index + 1 >= monthFrom ? 5_100 : nil, sessions: people * 3,
                    foregroundMs: Double(people) * 240_000)
            }
        }

        static let usage = AppUsage(
            covered: Period(from: UTCDay.date("2026-09-23")!, to: now), days: days(30), people: 5_105,
            installations: 6_020, sessions: 48_200, sessionsPerPerson: 9.4, sessionsPerPersonDay: 2.1,
            releases: [
                ReleaseUsage(
                    component: "notes-ios", environment: "production", release: "0.3.0+20", people: 4_980,
                    installations: 5_600, sessions: 40_100),
                ReleaseUsage(
                    component: "notes-ios", environment: "production", release: "0.2.0+10", people: 610,
                    installations: 640, sessions: 8_100),
            ])

        // Five days counted: WAU from the 7th and MAU from the 30th aren't known.
        static let partialUsage = AppUsage(
            covered: Period(from: UTCDay.date("2026-10-18")!, to: now), days: days(5), people: 820,
            installations: 860, sessions: 2_400, sessionsPerPerson: 2.9, releases: [])

        static let retention = AppRetention(
            cohorts: [
                RetentionCohort(week: "2026-09-28", people: 210, active: [210, 96, 71, 58, 22]),
                RetentionCohort(week: "2026-10-05", people: 184, active: [184, 80, 61, 19]),
                RetentionCohort(week: "2026-10-12", people: 140, active: [140, 61, 14]),
                RetentionCohort(week: "2026-10-19", people: 96, active: [96]),
            ], currentWeek: "2026-10-19")

        static func launch(_ p50: Double, _ p95: Double, ready: Bool = true) -> LaunchTimes {
            LaunchTimes(
                launches: 412, firstFrameP50Ms: p50, firstFrameP95Ms: p95,
                ready: ready ? ReadyTimes(launches: 380, p50Ms: p50 + 220, p95Ms: p95 + 400) : nil)
        }

        static let worse = ReleaseHealth(
            release: AppRelease(
                component: "notes-ios", environment: "production", release: "0.3.0+20",
                firstSeen: now.addingTimeInterval(-6 * 86_400), lastSeen: now, previous: "0.2.0+10"),
            health: AppHealth(
                sessions: 40_100, people: 4_980, cold: launch(640, 1_400), warm: launch(180, 320), prewarmed: 96,
                memory: MemoryUse(samples: 900, peakP95Bytes: 214_000_000, footprintP95Bytes: 151_000_000),
                diagnostics: AppDiagnostics(
                    reports: 310, crashes: 1_283, hangs: 40, cpuExceptions: 2, diskWriteExceptions: 0)),
            previousHealth: AppHealth(
                sessions: 8_100, people: 610, cold: launch(380, 600), warm: launch(170, 300), prewarmed: 20,
                memory: MemoryUse(samples: 300, peakP95Bytes: 205_000_000, footprintP95Bytes: 149_000_000),
                diagnostics: AppDiagnostics(
                    reports: 90, crashes: 32, hangs: 9, cpuExceptions: 0, diskWriteExceptions: 0)),
            crashesPerThousand: 32, hangsPerThousand: 1, previousCrashesPerThousand: 4, previousHangsPerThousand: 1.1,
            verdict: .worse, worse: [.coldLaunch, .crashes], better: [])

        // Sent launches alone: no memory, no MetricKit report yet, no time to the first useful screen.
        static let partial = ReleaseHealth(
            release: AppRelease(
                component: "notes-ios", environment: "production", release: "0.3.1+21",
                firstSeen: now.addingTimeInterval(-1_800), lastSeen: now, previous: "0.3.0+20"),
            health: AppHealth(sessions: 46, people: 41, cold: launch(610, 1_310, ready: false), prewarmed: 3),
            previousHealth: worse.health, verdict: .tooEarly, worse: [], better: [])

        static let first = ReleaseHealth(
            release: AppRelease(
                component: "notes-ios", environment: "beta", release: "0.4.0+25",
                firstSeen: now.addingTimeInterval(-2 * 86_400), lastSeen: now),
            health: AppHealth(sessions: 380, people: 22, cold: launch(500, 900), prewarmed: 4),
            verdict: .first, worse: [], better: [])

        static let features = FeatureUseTable(features: [
            FeatureUse(
                feature: "cards.flip", people: 410, events: 3_022, screens: 980,
                memory: MemoryUse(samples: 200, peakP95Bytes: 312_000_000, footprintP95Bytes: 190_000_000)),
            FeatureUse(people: 812, events: 0, screens: 940),
            FeatureUse(feature: "notes.share", people: 96, events: 140, screens: 0),
        ])
    }

    #Preview("Usage charts") {
        List {
            Section {
                ForEach(UsageSeries.of(AnalyticsPreviewData.usage)) { series in
                    UsageChartRow(
                        series: series,
                        days: UsageSeries.days(of: .month, endingWith: AnalyticsPreviewData.now))
                }
            }
        }
    }

    #Preview("Usage charts, five days counted") {
        List {
            Section {
                ForEach(UsageSeries.of(AnalyticsPreviewData.partialUsage)) { series in
                    UsageChartRow(
                        series: series,
                        days: UsageSeries.days(of: .month, endingWith: AnalyticsPreviewData.now))
                }
            }
        }
    }

    #Preview("Retention and releases") {
        List {
            Section {
                ForEach(RetentionRow.of(AnalyticsPreviewData.retention)) { row in
                    RetentionCohortRow(row: row)
                }
            }
            Section {
                ForEach(
                    [AnalyticsPreviewData.worse, AnalyticsPreviewData.partial, AnalyticsPreviewData.first], id: \.self
                ) {
                    health in
                    ReleaseHealthRow(
                        release: health.release.release, component: health.release.component,
                        environment: health.release.environment, previous: health.release.previous,
                        sessions: health.health.sessions, verdict: health.verdict, worse: health.worse,
                        better: health.better)
                }
                ReleaseHealthRow(
                    release: "0.2.0+10", component: "notes-ios", environment: "production", previous: "0.1.0+4",
                    sessions: 8_100, verdict: .better, worse: [], better: [.hangs])
                ReleaseHealthRow(
                    release: "0.4.1+26", component: "notes-ios", environment: "beta", previous: "0.4.0+25",
                    sessions: 0, verdict: .unmeasured, worse: [], better: [])
            }
        }
    }

    #Preview("Features") {
        List {
            ForEach(AnalyticsPreviewData.features.features, id: \.self) { use in
                FeatureRow(
                    feature: use.feature, people: use.people, events: use.events, screens: use.screens,
                    peakMemoryP95Bytes: use.memory?.peakP95Bytes)
            }
        }
    }
#endif
