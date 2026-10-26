import CluenoriClient
import Foundation
import Observation

/// How far back analytics look: the last 7, 30, or 90 UTC days, today's so far included. Apps are
/// counted by the UTC day, so it is a period of its own, apart from the hours the other screens use.
public enum AnalyticsPeriod: Int, CaseIterable, Hashable, Sendable {
    case week = 7
    case month = 30
    case quarter = 90

    public var days: Int {
        rawValue
    }

    /// The period ending `now`: from the start of the first of its UTC days, to now.
    func bounds(now: Date) -> (from: Date, to: Date) {
        let today = UTCDay.start(of: now)
        return (today.addingTimeInterval(-Double(days - 1) * UTCDay.length), now)
    }
}

/// A calendar day as the API names it, `2026-10-22`, at its start in UTC; and UTC days' arithmetic,
/// the same on every phone whatever its time zone.
public enum UTCDay {
    static let length: TimeInterval = 86_400

    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar
    }()

    /// The start of the UTC day `text` names; nil for text that isn't `YYYY-MM-DD`.
    public static func date(_ text: String) -> Date? {
        let parts = text.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count == 3, parts[0].count == 4, parts[1].count == 2, parts[2].count == 2,
            let year = Int(parts[0]), let month = Int(parts[1]), let day = Int(parts[2])
        else { return nil }
        let components = DateComponents(year: year, month: month, day: day)
        guard components.isValidDate(in: calendar) else { return nil }
        return calendar.date(from: components)
    }

    /// The start of the UTC day `date` is in.
    public static func start(of date: Date) -> Date {
        calendar.startOfDay(for: date)
    }
}

/// One day's count of something, at its UTC day's start.
public struct DayCount: Equatable, Sendable {
    public let day: Date
    public let value: Int

    public init(day: Date, value: Int) {
        self.day = day
        self.value = value
    }
}

/// One of usage's counts by day, as a chart shows it: the people active that day (DAU), in the 7
/// days ending it (WAU), in the 30 (MAU), or its sessions.
public struct UsageSeries: Equatable, Sendable, Identifiable {
    public enum Kind: CaseIterable, Sendable {
        case dailyPeople
        case weeklyPeople
        case monthlyPeople
        case sessions
    }

    public let kind: Kind
    /// The days whose count is known, oldest first. A day without one, before the apps first sent or
    /// with a week or month reaching before it, isn't here: unknown, never 0.
    public let points: [DayCount]
    /// The latest day counted, today's so far; nil when no day was.
    public let latestDay: Date?
    /// Its count; nil when the latest day's is unknown, as a WAU before 7 days were counted.
    public let latest: Int?

    public var id: Kind {
        kind
    }

    /// DAU, WAU, MAU and sessions by day, in that order, from `usage`.
    public static func of(_ usage: AppUsage) -> [UsageSeries] {
        let days = usage.days.compactMap { day in UTCDay.date(day.day).map { (date: $0, day: day) } }
        let latest = days.last
        return Kind.allCases.map { kind in
            func count(_ day: UsageDay) -> Int? {
                switch kind {
                case .dailyPeople: day.people
                case .weeklyPeople: day.weekPeople
                case .monthlyPeople: day.monthPeople
                case .sessions: day.sessions
                }
            }
            return UsageSeries(
                kind: kind,
                points: days.compactMap { day in count(day.day).map { DayCount(day: day.date, value: $0) } },
                latestDay: latest?.date,
                latest: latest.flatMap { count($0.day) }
            )
        }
    }

    /// The UTC days a chart of `period` spans, ending with the day `last` is in: from the start of
    /// its first day to the end of its last.
    public static func days(of period: AnalyticsPeriod, endingWith last: Date) -> ClosedRange<Date> {
        let end = UTCDay.start(of: last).addingTimeInterval(UTCDay.length)
        return end.addingTimeInterval(-Double(period.days) * UTCDay.length)...end
    }
}

/// The people first seen in one UTC week, and the share of them active each week since.
public struct RetentionRow: Equatable, Sendable, Identifiable {
    /// The Monday the week starts, at its start in UTC.
    public let week: Date
    public let people: Int
    /// Of them, the share active in each week from their first, which is all of them: 1, 0.44, ...
    public let shares: [Double]
    /// Whether the last share is of the week now is in, so far.
    public let lastIsSoFar: Bool

    public var id: Date {
        week
    }

    /// The cohorts of `retention`, the oldest first; a cohort of no one isn't listed.
    public static func of(_ retention: AppRetention) -> [RetentionRow] {
        let current = UTCDay.date(retention.currentWeek)
        return retention.cohorts.compactMap { cohort in
            guard let week = UTCDay.date(cohort.week), cohort.people > 0 else { return nil }
            let shares = cohort.active.map { Double($0) / Double(cohort.people) }
            // The last count is of the week now is in when the cohort's weeks reach it.
            let weeksSince = current.map { Int(($0.timeIntervalSince(week) / (7 * UTCDay.length)).rounded()) }
            return RetentionRow(
                week: week, people: cohort.people, shares: shares,
                lastIsSoFar: weeksSince == cohort.active.count - 1)
        }
    }
}

/// How a project's apps are used and how healthy each release is, in one environment over the
/// analytics period, of every component or one: usage by UTC day, weekly retention, each release's
/// app health beside the release before it, and each feature's use; each shown at once from the
/// phone and asked again together. A release is judged over all that is kept of it, whatever the
/// period; the period chooses which releases are listed.
@Observable
public final class AnalyticsModel {
    public let analytics: AnalyticsRef
    public private(set) var period: AnalyticsPeriod
    public let usage: Answer<AppUsage>
    public let retention: Answer<AppRetention>
    public let appHealth: Answer<AppHealthList>
    public let featureUse: Answer<FeatureUseTable>

    @ObservationIgnored private let api: CluenoriAPI

    init(analytics: AnalyticsRef, period: AnalyticsPeriod, api: CluenoriAPI, context: AnswerContext) {
        self.analytics = analytics
        self.period = period
        self.api = api
        usage = Answer(context, Self.usageQuestion(api, analytics, period))
        retention = Answer(context, Self.retentionQuestion(api, analytics, period))
        appHealth = Answer(context, Self.appHealthQuestion(api, analytics, period))
        featureUse = Answer(context, Self.featureUseQuestion(api, analytics, period))
    }

    /// Asks every question at once.
    public func refresh() async {
        async let usage: Void = usage.load()
        async let retention: Void = retention.load()
        async let appHealth: Void = appHealth.load()
        async let featureUse: Void = featureUse.load()
        _ = await (usage, retention, appHealth, featureUse)
    }

    /// Looks over `period` instead, showing what the phone kept for it, then asking again.
    public func choose(_ period: AnalyticsPeriod) async {
        guard period != self.period else {
            await refresh()
            return
        }
        self.period = period
        usage.change(to: Self.usageQuestion(api, analytics, period))
        retention.change(to: Self.retentionQuestion(api, analytics, period))
        appHealth.change(to: Self.appHealthQuestion(api, analytics, period))
        featureUse.change(to: Self.featureUseQuestion(api, analytics, period))
        await refresh()
    }

    /// Whether no app sent anything over the period, as far as the answers say: no day of usage
    /// counted and no release's health. False until usage answers.
    public var sentNothing: Bool {
        guard let usage = usage.value else { return false }
        return usage.covered == nil && usage.days.isEmpty && (appHealth.value?.releases.isEmpty ?? true)
    }

    /// DAU, WAU, MAU and sessions by day, in that order; empty until usage answers.
    public var usageSeries: [UsageSeries] {
        usage.value.map(UsageSeries.of) ?? []
    }

    /// The UTC days a usage chart spans: the whole period, ending with the latest day counted, or
    /// today, so days not counted show as gaps, not as a shorter period.
    public var usageDays: ClosedRange<Date> {
        UsageSeries.days(of: period, endingWith: usageSeries.first?.latestDay ?? usage.receivedAt ?? .now)
    }

    /// The weekly cohorts, the oldest first; empty until retention answers.
    public var retentionRows: [RetentionRow] {
        retention.value.map(RetentionRow.of) ?? []
    }

    /// The app health of `release`, as listed over the period; nil while it isn't, or until the
    /// answer arrives.
    public func health(of release: ReleaseRef) -> ReleaseHealth? {
        appHealth.value?.releases.first { health in
            health.release.component == release.component && health.release.release == release.version
                && (release.environment == nil || health.release.environment == release.environment)
        }
    }

    /// The components the answers name, in the order they first appear: those whose apps sent
    /// anything over the period.
    public var componentsSeen: [String] {
        let named =
            (usage.value?.releases.map(\.component) ?? []) + (appHealth.value?.releases.map(\.release.component) ?? [])
        var seen: [String] = []
        for component in named where !seen.contains(component) {
            seen.append(component)
        }
        return seen
    }

    // Where a question's answers are kept: one place for each component and environment, every
    // one's apart, and each period.
    private static func key(_ analytics: AnalyticsRef, _ what: String, _ period: AnalyticsPeriod) -> String {
        "projects/\(analytics.project)/analytics/\(analytics.component ?? "*")/\(analytics.environment ?? "*")/\(what)/\(period.days)d"
    }

    private static func usageQuestion(_ api: CluenoriAPI, _ analytics: AnalyticsRef, _ period: AnalyticsPeriod)
        -> Answer<AppUsage>.Question
    {
        .init(key: key(analytics, "usage", period)) { () async throws(APIError) in
            let (from, to) = period.bounds(now: .now)
            return try await api.usage(
                project: analytics.project, from: from, to: to, component: analytics.component,
                environment: analytics.environment)
        }
    }

    private static func retentionQuestion(_ api: CluenoriAPI, _ analytics: AnalyticsRef, _ period: AnalyticsPeriod)
        -> Answer<AppRetention>.Question
    {
        .init(key: key(analytics, "retention", period)) { () async throws(APIError) in
            let (from, to) = period.bounds(now: .now)
            return try await api.retention(
                project: analytics.project, from: from, to: to, component: analytics.component,
                environment: analytics.environment)
        }
    }

    private static func appHealthQuestion(_ api: CluenoriAPI, _ analytics: AnalyticsRef, _ period: AnalyticsPeriod)
        -> Answer<AppHealthList>.Question
    {
        .init(key: key(analytics, "app-health", period)) { () async throws(APIError) in
            let (from, to) = period.bounds(now: .now)
            return try await api.appHealth(
                project: analytics.project, from: from, to: to, component: analytics.component,
                environment: analytics.environment)
        }
    }

    private static func featureUseQuestion(_ api: CluenoriAPI, _ analytics: AnalyticsRef, _ period: AnalyticsPeriod)
        -> Answer<FeatureUseTable>.Question
    {
        .init(key: key(analytics, "feature-use", period)) { () async throws(APIError) in
            let (from, to) = period.bounds(now: .now)
            return try await api.featureUse(
                project: analytics.project, from: from, to: to, component: analytics.component,
                environment: analytics.environment)
        }
    }
}

/// One measure of a release's app health beside the same of the release before it, as its screen
/// lists them.
public struct HealthLine: Equatable, Sendable, Identifiable {
    public enum Kind: Equatable, Sendable {
        case launches
        case firstFrameP50
        case firstFrameP95
        case readyP50
        case readyP95
        case peakP95
        case footprintP95
        case crashesPerThousand
        case hangsPerThousand
        case crashes
        case hangs
        case reports
        case sessions
        case people
        case prewarmed
    }

    public enum Value: Equatable, Sendable {
        case milliseconds(Double)
        case bytes(Double)
        case count(Int)
        case perThousand(Double)
    }

    /// How a measure the verdict compares moved.
    public enum Move: Equatable, Sendable {
        case worse
        case better
    }

    public let kind: Kind
    public let value: Value
    /// The same measure of the release before; nil when it has none, or there is none.
    public let previous: Value?
    /// For the measure the verdict compares, how it moved; nil for the rest, and when it didn't.
    public let move: Move?

    public init(kind: Kind, value: Value, previous: Value?, move: Move?) {
        self.kind = kind
        self.value = value
        self.previous = previous
        self.move = move
    }

    public var id: Kind {
        kind
    }
}

/// A part of a release's app health, as its screen shows it: cold or warm launches, memory,
/// MetricKit's reports, or how much it was used; with only the measures the release sent.
public struct HealthGroup: Equatable, Sendable, Identifiable {
    public enum Kind: Equatable, Sendable {
        case coldLaunch
        case warmLaunch
        case memory
        case metricKit
        case use
    }

    public let kind: Kind
    public let lines: [HealthLine]

    public var id: Kind {
        kind
    }
}

extension ReleaseHealth {
    /// Its measures beside the release before it's, by part; a part the release sent none of isn't
    /// listed, and neither is a measure: unknown, never 0.
    public var groups: [HealthGroup] {
        let before = previousHealth
        func move(_ measure: HealthMeasure) -> HealthLine.Move? {
            if worse.contains(measure) { return .worse }
            if better.contains(measure) { return .better }
            return nil
        }
        func launches(_ times: LaunchTimes?, _ previous: LaunchTimes?, _ measure: HealthMeasure) -> [HealthLine] {
            guard let times else { return [] }
            var lines = [
                HealthLine(
                    kind: .firstFrameP50, value: .milliseconds(times.firstFrameP50Ms),
                    previous: previous.map { .milliseconds($0.firstFrameP50Ms) }, move: nil),
                HealthLine(
                    kind: .firstFrameP95, value: .milliseconds(times.firstFrameP95Ms),
                    previous: previous.map { .milliseconds($0.firstFrameP95Ms) }, move: move(measure)),
            ]
            if let ready = times.ready {
                lines.append(
                    HealthLine(
                        kind: .readyP50, value: .milliseconds(ready.p50Ms),
                        previous: previous?.ready.map { .milliseconds($0.p50Ms) }, move: nil))
                lines.append(
                    HealthLine(
                        kind: .readyP95, value: .milliseconds(ready.p95Ms),
                        previous: previous?.ready.map { .milliseconds($0.p95Ms) }, move: nil))
            }
            lines.append(
                HealthLine(
                    kind: .launches, value: .count(times.launches), previous: previous.map { .count($0.launches) },
                    move: nil))
            return lines
        }
        var memory: [HealthLine] = []
        if let use = health.memory {
            memory = [
                HealthLine(
                    kind: .peakP95, value: .bytes(use.peakP95Bytes),
                    previous: before?.memory.map { .bytes($0.peakP95Bytes) }, move: move(.memory)),
                HealthLine(
                    kind: .footprintP95, value: .bytes(use.footprintP95Bytes),
                    previous: before?.memory.map { .bytes($0.footprintP95Bytes) }, move: nil),
            ]
        }
        var metricKit: [HealthLine] = []
        if let crashes = crashesPerThousand {
            metricKit.append(
                HealthLine(
                    kind: .crashesPerThousand, value: .perThousand(crashes),
                    previous: previousCrashesPerThousand.map { .perThousand($0) }, move: move(.crashes)))
        }
        if let hangs = hangsPerThousand {
            metricKit.append(
                HealthLine(
                    kind: .hangsPerThousand, value: .perThousand(hangs),
                    previous: previousHangsPerThousand.map { .perThousand($0) }, move: move(.hangs)))
        }
        if let diagnostics = health.diagnostics {
            let earlier = before?.diagnostics
            metricKit += [
                HealthLine(
                    kind: .crashes, value: .count(diagnostics.crashes), previous: earlier.map { .count($0.crashes) },
                    move: nil),
                HealthLine(
                    kind: .hangs, value: .count(diagnostics.hangs), previous: earlier.map { .count($0.hangs) },
                    move: nil),
                HealthLine(
                    kind: .reports, value: .count(diagnostics.reports), previous: earlier.map { .count($0.reports) },
                    move: nil),
            ]
        }
        let use = [
            HealthLine(
                kind: .sessions, value: .count(health.sessions), previous: before.map { .count($0.sessions) },
                move: nil),
            HealthLine(
                kind: .people, value: .count(health.people), previous: before.map { .count($0.people) }, move: nil),
            HealthLine(
                kind: .prewarmed, value: .count(health.prewarmed), previous: before.map { .count($0.prewarmed) },
                move: nil),
        ]
        let groups = [
            HealthGroup(kind: .coldLaunch, lines: launches(health.cold, before?.cold, .coldLaunch)),
            HealthGroup(kind: .warmLaunch, lines: launches(health.warm, before?.warm, .warmLaunch)),
            HealthGroup(kind: .memory, lines: memory),
            HealthGroup(kind: .metricKit, lines: metricKit),
            HealthGroup(kind: .use, lines: use),
        ]
        return groups.filter { !$0.lines.isEmpty }
    }

    /// The release, as its app health screen opens it: in its environment.
    public func ref(in project: String) -> ReleaseRef {
        ReleaseRef(
            project: project, component: release.component, environment: release.environment,
            version: release.release)
    }
}

/// One person of a project, by Cluenori's ID for them, or found by the app's own user ID for them:
/// their user IDs, installations, active days, the features they used, and timeline. Fails with
/// `missing` for an ID or user ID the apps never sent.
@Observable
public final class PersonModel {
    public let project: String
    public let who: PersonRef.Who
    public let person: Answer<AppPerson>

    init(project: String, who: PersonRef.Who, api: CluenoriAPI, context: AnswerContext) {
        self.project = project
        self.who = who
        switch who {
        case .person(let id):
            person = Answer(
                context,
                .init(key: "projects/\(project)/people/\(id)") { () async throws(APIError) in
                    try await api.person(project: project, person: id)
                })
        case .user(let user):
            person = Answer(
                context,
                .init(key: "projects/\(project)/people/user/\(user)") { () async throws(APIError) in
                    try await api.personByUser(project: project, user: user)
                })
        }
    }

    public func load() async {
        await person.load()
    }

    /// The features they used, each opening its story: only those the app named, the last used first.
    public var features: [PersonFeature] {
        (person.value?.features ?? []).filter { $0.feature != nil }
    }

    /// What an agent needs to look into them further, through the API and the CLI.
    public var agentBrief: String? {
        guard let found = person.value else { return nil }
        let users = found.users.isEmpty ? "no user ID" : "user IDs \(found.users.joined(separator: ", "))"
        let features = features.compactMap(\.feature)
        return [
            "Look into person \(found.person) of Cluenori project \(project), with \(users).",
            "First seen \(found.firstSeen.formatted(.iso8601)), last seen \(found.lastSeen.formatted(.iso8601)), on \(found.installations.count) installations.",
            features.isEmpty
                ? "The app marked none of what they did with a feature."
                : "Features they used, the last first: \(features.joined(separator: ", ")); read one with ./cluenori feature \(project) <feature>.",
            "Read them with the API: GET /api/projects/\(project)/people/\(found.person), or ./cluenori person \(project) \(found.person): their installations, days, features and their latest 1,000 signals.",
        ].joined(separator: "\n")
    }

    /// The user ID `text` names, as the deployment takes one: 1 to 128 printable ASCII characters
    /// without spaces, the spaces around it let go; nil for text that isn't one.
    public static func userID(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...128).contains(trimmed.utf8.count),
            trimmed.utf8.allSatisfy({ (0x21...0x7e).contains($0) })
        else { return nil }
        return trimmed
    }
}

/// Daily, weekly and monthly people on the latest whole UTC day of a period's usage, each against
/// the same day a week before: the answer an analytics screen starts with. A count that isn't known,
/// a day not counted or 7 or 30 days reaching before the apps first sent, is nil, never 0.
public struct PeopleCounts: Equatable, Sendable {
    public struct Count: Equatable, Sendable {
        public let value: Int?
        public let weekBefore: Int?

        /// How it moved against a week before, as a share: 0.06 for 6% more; nil when either is
        /// unknown, or a week before had no one.
        public var change: Double? {
            guard let value, let weekBefore, weekBefore > 0 else { return nil }
            return Double(value - weekBefore) / Double(weekBefore)
        }
    }

    /// The latest whole UTC day, at its start: yesterday's, as today's so far would read as a fall.
    public let day: Date
    public let daily: Count
    public let weekly: Count
    public let monthly: Count

    /// The counts of `usage` on the whole UTC day before the one `now` is in.
    public static func of(_ usage: AppUsage, now: Date) -> PeopleCounts {
        let day = UTCDay.start(of: now).addingTimeInterval(-UTCDay.length)
        let weekBefore = day.addingTimeInterval(-7 * UTCDay.length)
        let byDay = Dictionary(
            usage.days.compactMap { entry in UTCDay.date(entry.day).map { ($0, entry) } },
            uniquingKeysWith: { a, _ in a })
        func count(_ value: (UsageDay) -> Int?) -> Count {
            Count(value: byDay[day].flatMap(value), weekBefore: byDay[weekBefore].flatMap(value))
        }
        return PeopleCounts(
            day: day, daily: count { $0.people }, weekly: count { $0.weekPeople }, monthly: count { $0.monthPeople })
    }
}

extension AnalyticsModel {
    /// The people counters, on the latest whole UTC day when usage answered; nil until it does.
    public var peopleCounts: PeopleCounts? {
        usage.value.map { PeopleCounts.of($0, now: usage.receivedAt ?? .now) }
    }
}

/// A feature of a project, as its screen opens it: by its key, in one environment or every one.
nonisolated public struct FeatureRef: Hashable, Sendable {
    public let project: String
    /// Its key, as the apps mark it and services name it: `notes.share`.
    public let key: String
    /// Nil for every environment.
    public let environment: String?

    public init(project: String, key: String, environment: String? = nil) {
        self.project = project
        self.key = key
        self.environment = environment
    }
}

/// A person of a project, as their screen opens them.
nonisolated public struct PersonRef: Hashable, Sendable {
    /// Which person: by Cluenori's ID for them, their screen's lasting address, or by the app's
    /// own user ID for them.
    public enum Who: Hashable, Sendable {
        case person(String)
        case user(String)
    }

    public let project: String
    public let who: Who

    public init(project: String, who: Who) {
        self.project = project
        self.who = who
    }
}

/// One UTC day of a feature's story: its people and events from the apps, and, when its services
/// named it, its operations, the failed ones, and its warnings and errors. Nil where unknown: a
/// service's part before the 90 days its logs are kept.
public struct FeatureDay: Equatable, Sendable, Identifiable {
    public let day: Date
    public let people: Int
    public let events: Int
    public let operations: Int
    public let failed: Int
    public let warnings: Int?
    public let errors: Int?

    public var id: Date {
        day
    }
}

/// One feature's story, over everything kept of it, with no period: who uses it each day, and what
/// its services ran, warned and failed for it. Shown at once from the phone, and asked again.
@Observable
public final class FeatureModel {
    public let feature: FeatureRef
    public let story: Answer<FeatureStory>

    init(feature: FeatureRef, api: CluenoriAPI, context: AnswerContext) {
        self.feature = feature
        story = Answer(
            context,
            .init(key: "projects/\(feature.project)/features/\(feature.key)/\(feature.environment ?? "*")") {
                () async throws(APIError) in
                try await api.feature(project: feature.project, feature: feature.key, environment: feature.environment)
            })
    }

    public func load() async {
        await story.load()
    }

    /// Whether any service named it in `cluenori.feature`: ran an operation, or sent a warning or
    /// error for it. Without, the screen says only the apps' part.
    public var servicesNamedIt: Bool {
        guard let story = story.value else { return false }
        return !story.operations.isEmpty || !story.logs.days.isEmpty
    }

    /// Its last `count` UTC days, the day it was answered last and so far; empty until it answers.
    public func days(last count: Int = 30) -> [FeatureDay] {
        guard let story = story.value else { return [] }
        return Self.days(of: story, last: count)
    }

    /// The last `count` UTC days of `story`, the oldest first, ending with the day it was answered.
    public static func days(of story: FeatureStory, last count: Int) -> [FeatureDay] {
        let today = UTCDay.start(of: story.asOf)
        let use = Dictionary(story.use.days.map { ($0.day, $0) }, uniquingKeysWith: { a, _ in a })
        let logs = Dictionary(story.logs.days.map { ($0.day, $0) }, uniquingKeysWith: { a, _ in a })
        var operations: [String: (count: Int, failed: Int)] = [:]
        for each in story.operations {
            let sum = operations[each.day] ?? (0, 0)
            operations[each.day] = (sum.count + each.count, sum.failed + each.errors)
        }
        let logsFrom = story.logs.covered.map { UTCDay.start(of: $0.from) }
        return (0..<count).reversed().map { back in
            let day = today.addingTimeInterval(-Double(back) * UTCDay.length)
            let key = String(day.formatted(.iso8601.year().month().day()))
            let logged = logs[key]
            let kept = logsFrom.map { day >= $0 } ?? false
            return FeatureDay(
                day: day, people: use[key]?.people ?? 0, events: use[key]?.events ?? 0,
                operations: operations[key]?.count ?? 0, failed: operations[key]?.failed ?? 0,
                warnings: kept ? logged?.warnings ?? 0 : nil, errors: kept ? logged?.errors ?? 0 : nil)
        }
    }

    /// Each operation that ran for it, every day kept, the most first: its component, name, count,
    /// and how many failed.
    public var operations: [(component: String, operation: String, count: Int, failed: Int)] {
        var totals: [String: (component: String, operation: String, count: Int, failed: Int)] = [:]
        for each in story.value?.operations ?? [] {
            let key = "\(each.component)\u{0}\(each.operation)"
            let sum = totals[key] ?? (each.component, each.operation, 0, 0)
            totals[key] = (sum.component, sum.operation, sum.count + each.count, sum.failed + each.errors)
        }
        return totals.values.sorted { $0.count != $1.count ? $0.count > $1.count : $0.operation < $1.operation }
    }

    /// What an agent needs to look into it further, through the API and the CLI.
    public var agentBrief: String? {
        guard let story = story.value else { return nil }
        let project = feature.project
        let environment = feature.environment.map { ", environment \($0)" } ?? ""
        let query = feature.environment.map { "?environment=\($0)" } ?? ""
        let flag = feature.environment.map { " --environment \($0)" } ?? ""
        let used = story.use.days
        var lines = [
            "Look into feature \(story.feature) in Cluenori project \(project)\(environment), as of \(story.asOf.formatted(.iso8601)).",
            used.first.map { first in
                "Apps: \(story.use.people) people used it, from \(first.day) to \(used.last?.day ?? first.day)."
            } ?? "No app marked it in the 15 months kept.",
        ]
        if servicesNamedIt {
            let week = days(last: 7)
            lines.append(
                "Services, last 7 days: \(week.map(\.operations).reduce(0, +)) operations, \(week.map(\.failed).reduce(0, +)) failed; \(week.compactMap(\.errors).reduce(0, +)) errors, \(week.compactMap(\.warnings).reduce(0, +)) warnings."
            )
        } else {
            lines.append("No service named it in cluenori.feature.")
        }
        lines.append(
            "Read its whole story with the API: GET /api/projects/\(project)/features/\(story.feature)\(query), or ./cluenori feature \(project) \(story.feature)\(flag)."
        )
        if !story.logs.errors.isEmpty {
            lines.append(
                "Its errors, the most frequent first: \(story.logs.errors.map(\.id).joined(separator: ", ")); read one with ./cluenori error \(project) <error> --last 90d."
            )
        }
        if let person = story.use.latestPeople.first {
            lines.append(
                "Who used it last: read one with ./cluenori person \(project) <person>, such as \(person.person).")
        }
        return lines.joined(separator: "\n")
    }
}
