#if DEBUG
    import CluenoriClient
    import CluenoriScreens
    import Foundation
    import UIKit

    /// A deployment made up on the phone, for looking at the app's screens with realistic data, such as
    /// for screenshots in the Simulator: launched with `-CluenoriDemo YES`, the app pairs with it in
    /// place of the Keychain's pairing, keeps nothing, and opens the link `-CluenoriDemoOpen` names;
    /// with `-CluenoriDemoStep <environment>` too, a component's link opens the promote sheet of its
    /// next step there; `-CluenoriDemoScroll <points>` scrolls the screen, Now or the link's, down
    /// that far, to show its lower part; `-CluenoriDemoFailure YES` makes the API's last promotion to prod one that
    /// failed. Debug builds alone have it: Release builds, which TestFlight gets, don't.
    ///
    /// ```
    /// xcrun simctl launch booted <bundle ID> -CluenoriDemo YES \
    ///   -CluenoriDemoOpen cluenori://projects/notes/components/notes-api -CluenoriDemoStep prod
    /// ```
    enum DemoDeployment {
        /// The pairing with the made-up deployment, when the app was launched for it; nil otherwise.
        static func pairing() -> PairingModel? {
            guard UserDefaults.standard.bool(forKey: "CluenoriDemo") else { return nil }
            return PairingModel(store: DemoStore(), details: .thisPhone, transport: DemoAnswers.transport)
        }

        /// Opens the screen `-CluenoriDemoOpen` names, and the promote sheet `-CluenoriDemoStep` asks for.
        static func open(in pairing: PairingModel) async {
            guard UserDefaults.standard.bool(forKey: "CluenoriDemo") else { return }
            let route = UserDefaults.standard.string(forKey: "CluenoriDemoOpen").flatMap(URL.init(string:))
                .flatMap(Route.init)
            if let route {
                pairing.navigation.open(route)
            }
            let scroll = UserDefaults.standard.double(forKey: "CluenoriDemoScroll")
            if scroll > 0 {
                try? await Task.sleep(for: .seconds(3))
                scrollList(by: scroll)
            }
            guard let environment = UserDefaults.standard.string(forKey: "CluenoriDemoStep"),
                case .component(let project, let component) = route, let models = pairing.models
            else { return }
            let delivery = models.delivery(project)
            await models.environments(project).refresh()
            await delivery.load()
            if let next = delivery.component(component)?.stages.first(where: { $0.environment == environment })?.next {
                delivery.start(next, of: component)
            }
        }
    }

    extension DemoDeployment {
        /// Scrolls the tallest list on screen down by `points`, no further than its end.
        fileprivate static func scrollList(by points: Double) {
            let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
            let lists = windows.flatMap { scrollViews(in: $0) }.filter { $0.window != nil && !$0.isHidden }
            guard let list = lists.max(by: { $0.contentSize.height < $1.contentSize.height }) else { return }
            let end = list.contentSize.height - list.bounds.height + list.adjustedContentInset.bottom
            let top = -list.adjustedContentInset.top
            list.setContentOffset(CGPoint(x: 0, y: min(top + points, max(end, top))), animated: false)
        }

        private static func scrollViews(in view: UIView) -> [UIScrollView] {
            let own = (view as? UIScrollView).map { [$0] } ?? []
            return own + view.subviews.flatMap(scrollViews)
        }
    }

    /// The made-up deployment's pairing, in memory.
    private final class DemoStore: PairingStore {
        private var saved: PairedDeployment? = PairedDeployment(
            deployment: URL(string: "https://cluenori.example")!, phone: "demo-phone", key: "demo-key")

        func load() throws -> PairedDeployment? { saved }
        func save(_ deployment: PairedDeployment) throws { saved = deployment }
        func remove() throws { saved = nil }
    }

    /// The made-up deployment's answers about the notes project's apps: notes-ios in production, its
    /// releases 1.0.0+5, 1.1.0+7 (better: fewer hangs) and 1.1.0+9 (worse: cold launch slower, more
    /// crashes), and in beta 1.2.0+12, too early to tell; weekly retention decaying; a few features;
    /// one person, `user-1842`; a version policy and two SDK keys, the older revoked. The project's
    /// other components, and its other environments, sent nothing: they show the empty state.
    private nonisolated enum DemoAnalytics {
        private static let minute: TimeInterval = 60
        private static let hour: TimeInterval = 3_600
        private static let day: TimeInterval = 86_400
        private static let project = "/api/projects/notes"

        static func answer(_ method: String, _ path: String, query: [String: String], body: Data?) -> (Int, Data)? {
            let now = Date.now
            let apps = query["component"].map { $0 == "notes-ios" } ?? true
            let environments = query["environment"].map { [$0] } ?? ["production", "beta"]
            let from =
                query["from"].flatMap { text in
                    (try? Date(text, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)))
                        ?? (try? Date(text, strategy: .iso8601))
                } ?? now.addingTimeInterval(-30 * day)
            switch (method, path) {
            case ("GET", "\(project)/usage"):
                return DemoAnswers.ok(usage(from: from, now: now, sent: apps && environments.contains("production")))
            case ("GET", "\(project)/retention"):
                return DemoAnswers.ok(
                    retention(from: from, now: now, sent: apps && environments.contains("production")))
            case ("GET", "\(project)/app-health"):
                let releases = apps ? health(now).filter { environments.contains($0.release.environment) } : []
                return DemoAnswers.ok(AppHealthList(releases: releases))
            case ("GET", "\(project)/feature-use"):
                return DemoAnswers.ok(
                    FeatureUseTable(features: apps && environments.contains("production") ? features : []))
            case ("GET", "\(project)/people"):
                guard query["user"] == "user-1842" else {
                    return (404, Data(#"{"_tag":"PersonNotFound"}"#.utf8))
                }
                return DemoAnswers.ok(person(now))
            case ("GET", "\(project)/version-policies"):
                return DemoAnswers.ok(VersionPolicies(policies: [policy(now)]))
            case ("PUT", "\(project)/version-policies/notes-ios"):
                let sent = body.flatMap { try? JSONDecoder().decode(VersionPolicyTo.self, from: $0) }
                return DemoAnswers.ok(
                    ComponentVersionPolicy(
                        component: "notes-ios", minimum: sent?.minimum, recommended: sent?.recommended,
                        storeUrl: sent?.storeUrl ?? storeUrl, minimumOsVersion: sent?.minimumOsVersion,
                        words: sent?.words ?? [], setAt: now))
            case ("DELETE", "\(project)/version-policies/notes-ios"):
                return (204, Data())
            case ("GET", "\(project)/components/notes-ios/sdk-keys"):
                return DemoAnswers.ok(SdkKeyList(keys: keys(now)))
            case ("POST", "\(project)/components/notes-ios/sdk-keys"):
                return (
                    201,
                    DemoAnswers.encoded(
                        IssuedSdkKey(
                            key: "cluenori-sdk.notes.notes-ios.ivcJQrxslnJD-RswUMjzeQ", component: "notes-ios",
                            issuedAt: now))
                )
            default:
                break
            }
            // Revoking a key: /api/projects/notes/components/notes-ios/sdk-keys/<key>/revoke
            let parts = path.split(separator: "/").map(String.init)
            if method == "POST", parts.count == 8, parts[5] == "sdk-keys", parts[7] == "revoke",
                let key = keys(now).first(where: { $0.key == parts[6] })
            {
                return DemoAnswers.ok(
                    IssuedSdkKey(key: key.key, component: key.component, issuedAt: key.issuedAt, revokedAt: now))
            }
            // Other components' keys: none yet.
            if method == "GET", parts.count == 6, parts[3] == "components", parts[5] == "sdk-keys" {
                return DemoAnswers.ok(SdkKeyList(keys: []))
            }
            return nil
        }

        /// The notes app's people on the latest whole UTC day and a week before, as Now's pulse counts
        /// them: from production.
        static func pulsePeople(_ now: Date) -> PulsePeople? {
            let days = usage(from: now.addingTimeInterval(-9 * day), now: now, sent: true).days
            let latest = dayText(dayStart(now).addingTimeInterval(-day))
            let weekBefore = dayText(dayStart(now).addingTimeInterval(-8 * day))
            guard let counted = days.first(where: { $0.day == latest }) else { return nil }
            return PulsePeople(latest: counted, weekBefore: days.first { $0.day == weekBefore })
        }

        // MARK: Usage

        // The first day the app sent anything: 58 days ago.
        private static func firstDay(_ now: Date) -> Date {
            dayStart(now.addingTimeInterval(-58 * day))
        }

        private static func dayStart(_ date: Date) -> Date {
            Date(timeIntervalSince1970: (date.timeIntervalSince1970 / day).rounded(.down) * day)
        }

        private static func dayText(_ date: Date) -> String {
            date.formatted(Date.ISO8601FormatStyle(timeZone: .gmt).year().month().day())
        }

        // People on day `index` since the first: growing, quieter at weekends.
        private static func people(_ index: Int, weekday: Int) -> Int {
            let base = 420 + index * 7
            return weekday >= 5 ? base * 3 / 4 : base + (index * 37 % 41)
        }

        private static func usage(from: Date, now: Date, sent: Bool) -> AppUsage {
            guard sent else { return AppUsage(days: [], people: 0, installations: 0, sessions: 0, releases: []) }
            let first = max(dayStart(from), firstDay(now))
            let count = Int((dayStart(now).timeIntervalSince(first) / day).rounded()) + 1
            let days = (0..<count).map { offset in
                let date = first.addingTimeInterval(Double(offset) * day)
                let index = Int((date.timeIntervalSince(firstDay(now)) / day).rounded())
                let weekday = (Int(date.timeIntervalSince1970 / day) + 3) % 7
                // Today, so far: about two thirds of a day.
                let dau = people(index, weekday: weekday) * (offset == count - 1 ? 2 : 3) / 3
                return UsageDay(
                    day: dayText(date), people: dau, installations: dau + dau / 12,
                    weekPeople: index >= 6 ? 1_900 + index * 21 : nil,
                    monthPeople: index >= 29 ? 4_100 + index * 30 : nil,
                    sessions: dau * 3 + index % 17, foregroundMs: Double(dau) * 410_000)
            }
            let sessions = days.reduce(0) { $0 + $1.sessions }
            let people = 3_400 + count * 40
            return AppUsage(
                covered: Period(from: first, to: now), days: days, people: people, installations: people + 380,
                sessions: sessions, sessionsPerPerson: Double(sessions) / Double(people),
                sessionsPerPersonDay: 2.4,
                releases: [
                    ReleaseUsage(
                        component: "notes-ios", environment: "production", release: "1.1.0+9", people: people * 7 / 10,
                        installations: people * 3 / 4, sessions: sessions * 6 / 10),
                    ReleaseUsage(
                        component: "notes-ios", environment: "production", release: "1.1.0+7", people: people / 4,
                        installations: people / 4 + 60, sessions: sessions * 3 / 10),
                    ReleaseUsage(
                        component: "notes-ios", environment: "production", release: "1.0.0+5", people: people / 20,
                        installations: people / 20 + 9, sessions: sessions / 10),
                ])
        }

        private static func retention(from: Date, now: Date, sent: Bool) -> AppRetention {
            // Mondays, in UTC: 1970-01-05 was one.
            func monday(_ date: Date) -> Date {
                let days = (dayStart(date).timeIntervalSince1970 / day).rounded()
                return Date(timeIntervalSince1970: (days - (days - 4).truncatingRemainder(dividingBy: 7)) * day)
            }
            let current = monday(now)
            guard sent else { return AppRetention(cohorts: [], currentWeek: dayText(current)) }
            var cohorts: [RetentionCohort] = []
            var week = monday(max(from, firstDay(now)))
            while week <= current {
                let weeks = Int((current.timeIntervalSince(week) / (7 * day)).rounded())
                let people = 180 + weeks * 14
                let active = (0...weeks).map { since -> Int in
                    guard since > 0 else { return people }
                    let share = 0.46 * pow(0.82, Double(since - 1))
                    // The week now is in, so far: about half of it.
                    return Int(Double(people) * share * (since == weeks ? 0.5 : 1))
                }
                cohorts.append(RetentionCohort(week: dayText(week), people: people, active: active))
                week = week.addingTimeInterval(7 * day)
            }
            return AppRetention(cohorts: cohorts, currentWeek: dayText(current))
        }

        // MARK: App health

        private static func launch(_ launches: Int, _ p50: Double, _ p95: Double, ready: Double? = nil) -> LaunchTimes {
            LaunchTimes(
                launches: launches, firstFrameP50Ms: p50, firstFrameP95Ms: p95,
                ready: ready.map { ReadyTimes(launches: launches * 9 / 10, p50Ms: p50 + $0, p95Ms: p95 + $0 * 1.6) })
        }

        private static func health(_ now: Date) -> [ReleaseHealth] {
            func ago(_ seconds: TimeInterval) -> Date { now.addingTimeInterval(-seconds) }
            let old = AppHealth(
                sessions: 6_120, people: 410, cold: launch(820, 410, 690, ready: 260), warm: launch(2_400, 150, 290),
                prewarmed: 140,
                memory: MemoryUse(samples: 700, peakP95Bytes: 182_000_000, footprintP95Bytes: 131_000_000),
                diagnostics: AppDiagnostics(
                    reports: 160, crashes: 21, hangs: 64, cpuExceptions: 1, diskWriteExceptions: 0))
            let previous = AppHealth(
                sessions: 22_480, people: 1_310, cold: launch(2_910, 395, 640, ready: 250),
                warm: launch(9_800, 140, 270),
                prewarmed: 610,
                memory: MemoryUse(samples: 2_600, peakP95Bytes: 176_000_000, footprintP95Bytes: 128_000_000),
                diagnostics: AppDiagnostics(
                    reports: 520, crashes: 81, hangs: 49, cpuExceptions: 2, diskWriteExceptions: 1))
            let latest = AppHealth(
                sessions: 48_210, people: 3_020, cold: launch(6_340, 720, 1_410, ready: 300),
                warm: launch(21_900, 145, 280),
                prewarmed: 1_380,
                memory: MemoryUse(samples: 5_900, peakP95Bytes: 191_000_000, footprintP95Bytes: 133_000_000),
                diagnostics: AppDiagnostics(
                    reports: 1_140, crashes: 1_012, hangs: 101, cpuExceptions: 3, diskWriteExceptions: 0))
            let beta = AppHealth(
                sessions: 140, people: 18, cold: launch(31, 690, 1_180), warm: launch(96, 150, 300), prewarmed: 6)
            return [
                ReleaseHealth(
                    release: AppRelease(
                        component: "notes-ios", environment: "beta", release: "1.2.0+12", firstSeen: ago(3 * day),
                        lastSeen: ago(10 * minute), previous: "1.1.0+9"),
                    health: beta, previousHealth: latest, verdict: .tooEarly, worse: [], better: []),
                ReleaseHealth(
                    release: AppRelease(
                        component: "notes-ios", environment: "production", release: "1.1.0+9", firstSeen: ago(12 * day),
                        lastSeen: ago(minute), previous: "1.1.0+7"),
                    health: latest, previousHealth: previous, crashesPerThousand: 21, hangsPerThousand: 2.1,
                    previousCrashesPerThousand: 3.6, previousHangsPerThousand: 2.2, verdict: .worse,
                    worse: [.coldLaunch, .crashes], better: []),
                ReleaseHealth(
                    release: AppRelease(
                        component: "notes-ios", environment: "production", release: "1.1.0+7", firstSeen: ago(26 * day),
                        lastSeen: ago(hour), previous: "1.0.0+5"),
                    health: previous, previousHealth: old, crashesPerThousand: 3.6, hangsPerThousand: 2.2,
                    previousCrashesPerThousand: 3.4, previousHangsPerThousand: 10.5, verdict: .better, worse: [],
                    better: [.hangs]),
                ReleaseHealth(
                    release: AppRelease(
                        component: "notes-ios", environment: "production", release: "1.0.0+5", firstSeen: ago(58 * day),
                        lastSeen: ago(5 * hour)),
                    health: old, crashesPerThousand: 3.4, hangsPerThousand: 10.5, verdict: .first, worse: [], better: []
                ),
            ]
        }

        // MARK: Features

        private static let features = [
            FeatureUse(
                feature: "editor", people: 2_940, events: 18_400, screens: 22_100,
                memory: MemoryUse(samples: 4_100, peakP95Bytes: 188_000_000, footprintP95Bytes: 131_000_000)),
            FeatureUse(people: 2_610, events: 1_200, screens: 9_800),
            FeatureUse(
                feature: "search", people: 1_870, events: 7_300, screens: 5_400,
                memory: MemoryUse(samples: 1_900, peakP95Bytes: 214_000_000, footprintP95Bytes: 150_000_000)),
            FeatureUse(feature: "sharing", people: 640, events: 910, screens: 720),
            FeatureUse(feature: "widgets", people: 410, events: 2_050, screens: 0),
            FeatureUse(feature: "drafts.sync", people: 122, events: 380, screens: 90),
        ]

        // MARK: One person

        private static func person(_ now: Date) -> AppPerson {
            func ago(_ seconds: TimeInterval) -> Date { now.addingTimeInterval(-seconds) }
            func entry(_ release: String, _ signal: TimelineSignal) -> TimelineEntry {
                TimelineEntry(
                    component: "notes-ios", environment: "production", release: release, installation: "inst-5e1a",
                    signal: signal)
            }
            let phone = AppDevice(
                model: "iPhone17,2", platform: .iOS, osVersion: "27.1", locale: "en_GB", timeZone: "Europe/London")
            let sdk = AppSdk(name: "cluenori-swift", version: "0.1.0")
            return AppPerson(
                person: "prs-7f2c19", users: ["user-1842"], firstSeen: ago(41 * day), lastSeen: ago(14 * minute),
                installations: [
                    AppInstallation(
                        installation: "inst-5e1a", component: "notes-ios", environment: "production",
                        release: "1.1.0+9",
                        device: phone, sdk: sdk, country: "GB", firstSeen: ago(41 * day), lastSeen: ago(14 * minute)),
                    AppInstallation(
                        installation: "inst-90bc", component: "notes-ios", environment: "beta", release: "1.2.0+12",
                        device: AppDevice(
                            model: "iPad16,3", platform: .iPadOS, osVersion: "27.1", locale: "en_GB",
                            timeZone: "Europe/London"),
                        sdk: sdk, firstSeen: ago(3 * day), lastSeen: ago(day)),
                ],
                days: (0..<26).map { index in
                    let date = dayStart(now).addingTimeInterval(-Double(index * 3 / 2) * day)
                    return PersonDay(
                        day: dayText(date), sessions: 1 + index * 7 % 4, foregroundMs: Double(240_000 + index * 31_000))
                },
                timeline: [
                    entry(
                        "1.1.0+9",
                        .sessionEnded(
                            SessionEnded(id: "sg-9", at: ago(14 * minute), session: "ses-3", foregroundMs: 312_000))),
                    entry(
                        "1.1.0+9",
                        .event(
                            EventTracked(
                                id: "sg-8", at: ago(16 * minute), session: "ses-3", user: "user-1842",
                                feature: "sharing",
                                name: "note.shared",
                                properties: ["destination": .string("messages"), "words": .number(240)]))),
                    entry(
                        "1.1.0+9",
                        .screen(
                            ScreenShown(
                                id: "sg-7", at: ago(17 * minute), session: "ses-3", feature: "sharing",
                                screen: "ShareSheet"))),
                    entry(
                        "1.1.0+9",
                        .screen(
                            ScreenShown(
                                id: "sg-6", at: ago(19 * minute), session: "ses-3", feature: "editor",
                                screen: "NoteEditor"))),
                    entry(
                        "1.1.0+9",
                        .appLaunched(
                            AppLaunched(
                                id: "sg-5", at: ago(20 * minute), session: "ses-3", start: .cold, prewarmed: false,
                                firstFrameMs: 1_460, readyMs: 1_790))),
                    entry(
                        "1.1.0+9", .sessionStarted(SessionStarted(id: "sg-4", at: ago(20 * minute), session: "ses-3"))),
                    entry(
                        "1.1.0+9",
                        .metrickit(
                            MetricKitSummary(id: "sg-3", at: ago(5 * hour), report: .diagnostics, crashes: 1, hangs: 0))
                    ),
                    entry(
                        "1.1.0+9",
                        .sessionEnded(
                            SessionEnded(id: "sg-2", at: ago(9 * hour), session: "ses-2", foregroundMs: 48_000))),
                    entry(
                        "1.1.0+9",
                        .appLaunched(
                            AppLaunched(
                                id: "sg-1", at: ago(9 * hour + minute), session: "ses-2", start: .warm, prewarmed: true,
                                firstFrameMs: 160))),
                ])
        }

        // MARK: Setup

        private static let storeUrl = "https://apps.apple.com/app/id0000000000"

        private static func policy(_ now: Date) -> ComponentVersionPolicy {
            ComponentVersionPolicy(
                component: "notes-ios", minimum: "1.0.0", recommended: "1.1.0", storeUrl: storeUrl,
                minimumOsVersion: "26.0",
                words: [
                    UpdateWords(
                        locale: "en-US", decision: .require,
                        text: UpdateText(
                            title: "Update Notes",
                            message: "This version can't sync your notes any more. Update to keep them safe.")),
                    UpdateWords(
                        locale: "en-US", decision: .recommend,
                        text: UpdateText(
                            title: "A better Notes", message: "Search is faster and drafts sync across devices.")),
                ],
                setAt: now.addingTimeInterval(-4 * day))
        }

        private static func keys(_ now: Date) -> [IssuedSdkKey] {
            [
                IssuedSdkKey(
                    key: "cluenori-sdk.notes.notes-ios.ZrZMh504IBL2AIGWdn_1Wg", component: "notes-ios",
                    issuedAt: now.addingTimeInterval(-20 * day)),
                IssuedSdkKey(
                    key: "cluenori-sdk.notes.notes-ios.mVzRg7BweK4u1_pnN5vVGw", component: "notes-ios",
                    issuedAt: now.addingTimeInterval(-58 * day), revokedAt: now.addingTimeInterval(-19 * day)),
            ]
        }
    }

    /// The made-up deployment's feed, Registrations: notes names a registration `user.registered`,
    /// atlas `signup_completed`; three today, two yesterday.
    private nonisolated enum DemoFeeds {
        private static let id = "0199f7a2-8000-7000-8000-000000000001"
        private static let minute: TimeInterval = 60

        static func answer(_ method: String, _ path: String) -> (Int, Data)? {
            let now = Date.now
            switch (method, path) {
            case ("GET", "/api/feeds"):
                return DemoAnswers.ok(FeedList(feeds: [summary(now)]))
            case ("GET", "/api/feeds/\(id)"):
                return DemoAnswers.ok(FeedEntries(summary: summary(now), entries: entries(now)))
            default:
                return nil
            }
        }

        private static func summary(_ now: Date) -> FeedSummary {
            FeedSummary(
                feed: Feed(
                    id: id, name: "Registrations", level: .timeSensitive,
                    sources: [
                        FeedSource(project: "notes", event: "user.registered"),
                        FeedSource(project: "atlas", event: "signup_completed"),
                    ]),
                lastDay: 3, lastWeek: 5,
                byProject: [
                    FeedProjectCount(project: "notes", lastWeek: 3), FeedProjectCount(project: "atlas", lastWeek: 2),
                ],
                latest: now.addingTimeInterval(-4 * minute))
        }

        private static func entries(_ now: Date) -> [FeedEntry] {
            let made: [(Int, String, TimeInterval, String?, String)] = [
                (5, "notes", 4, "user-1842", "DE"),
                (4, "atlas", 38, nil, "JP"),
                (3, "notes", 95, "user-1907", "PL"),
                (2, "atlas", 26 * 60, "a-311", "US"),
                (1, "notes", 29 * 60, "user-1650", "GB"),
            ]
            return made.map { id, project, minutesAgo, user, country in
                FeedEntry(
                    id: id, project: project, event: project == "notes" ? "user.registered" : "signup_completed",
                    at: now.addingTimeInterval(-minutesAgo * minute),
                    component: "\(project)-ios", environment: "production",
                    release: project == "notes" ? "1.1.0+9" : "3.2.0+41", country: country, user: user)
            }
        }
    }

    /// The made-up deployment's answers: the notes project, with an API deployed dev then prod, a
    /// worker that ships with it, and an iOS app through TestFlight to the App Store, its monitor down,
    /// a new error, and a build App Store review approved; and, on Now alone, atlas, with a slower
    /// operation, and kiln, an API with nothing to do. Times are relative to now.
    private nonisolated enum DemoAnswers {
        static let transport: CluenoriAPI.Transport = { request in
            let path = request.url?.path(percentEncoded: false) ?? ""
            let method = request.httpMethod ?? "GET"
            let items = request.url.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems } ?? []
            let query = Dictionary(items.map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { _, last in last })
            let (status, body) =
                DemoAnalytics.answer(method, path, query: query, body: request.httpBody)
                ?? DemoFeeds.answer(method, path) ?? answer(method, path)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (body, response)
        }

        private static func answer(_ method: String, _ path: String) -> (Int, Data) {
            let now = Date.now
            let project = "/api/projects/notes"
            switch (method, path) {
            case ("GET", "/api/me"):
                return ok(Member(id: "m1", role: .owner, addedAt: now.addingTimeInterval(-30 * day), passkeys: 1))
            case ("GET", "/api/projects"):
                return ok(ProjectList(projects: projects(now)))
            case ("GET", "/api/today"):
                return ok(today(now))
            case ("GET", project):
                return ok(detail(now))
            case ("GET", "\(project)/delivery"):
                return ok(delivery(now))
            case ("GET", "\(project)/versions"):
                return ok(ComponentVersions(versions: versions(now)))
            case ("GET", "\(project)/incidents"):
                return ok(IncidentList(open: [down(now)], resolved: [recovered(now)], checkedAt: now))
            case ("POST", "\(project)/incidents/\(downId)/acknowledge"):
                return ok(down(now, acknowledgedAt: now))
            case ("GET", "\(project)/load"):
                return ok(load(now))
            case ("GET", "\(project)/operations"):
                return ok(operations)
            case ("GET", "\(project)/errors"):
                return ok(errors(now))
            case ("GET", "\(project)/logs"):
                return ok(logs(now))
            case ("GET", "\(project)/releases"):
                return ok(ReleaseList(releases: summaries(now).map(\.summary), problems: []))
            case ("GET", "\(project)/notes-style"):
                return ok(NotesStyle(style: "Short, friendly sentences. Lead with what people can do now."))
            default:
                break
            }
            let parts = path.split(separator: "/").map(String.init)
            // /api/projects/notes/errors/<id>
            if method == "GET", parts.count == 5, parts[3] == "errors",
                let group = errors(now).groups.first(where: { $0.id == parts[4] })
            {
                return ok(ErrorDetail(group: group, latest: logs(now).lines.filter { $0.level == .error }))
            }
            // /api/projects/notes/releases/<component>/<release>
            if method == "GET", parts.count == 6, parts[3] == "releases",
                let found = summaries(now).first(where: {
                    $0.summary.component == parts[4] && $0.summary.release == parts[5]
                })
            {
                return ok(releaseDetail(found.summary, now))
            }
            // Promoting a release, or a component's newest commit: it starts.
            if method == "POST", parts.count >= 6, parts.last == "promotions" {
                let component = parts[4]
                let release = parts.count == 7 ? parts[5] : "1.0.0+2"
                return (
                    201,
                    encoded(
                        Promotion(
                            id: UUID().uuidString.lowercased(), component: component, release: release,
                            environment: "prod", repository: "notesapp/notes", workflow: "deploy.yml", runner: .auto,
                            startedBy: "m1", startedAt: now, state: .starting))
                )
            }
            return (404, Data(#"{"_tag":"RouteNotFound"}"#.utf8))
        }

        // MARK: The project

        private static let minute: TimeInterval = 60
        private static let hour: TimeInterval = 3_600
        private static let day: TimeInterval = 86_400

        private static func notes(_ now: Date) -> Project {
            Project(key: "notes", name: "Notes", createdAt: now.addingTimeInterval(-60 * day))
        }

        private static func projects(_ now: Date) -> [Project] {
            [
                notes(now),
                Project(key: "atlas", name: "Atlas", createdAt: now.addingTimeInterval(-90 * day)),
                Project(key: "kiln", name: "Kiln", createdAt: now.addingTimeInterval(-20 * day)),
            ]
        }

        // MARK: Now

        private static let downId = "019a0fe0-7200-7b00-8c00-000000000001"

        // The notes API's health check, down for 4 minutes.
        private static func down(_ now: Date, acknowledgedAt: Date? = nil) -> Incident {
            Incident(
                id: downId, component: "notes-api", environment: "prod", subject: "https://notes.example/health",
                title: "https://notes.example/health is down: HTTP 503",
                evidence: .down(
                    DownEvidence(
                        monitor: "019a0fe0-7200-7b00-8c00-000000000002", url: "https://notes.example/health",
                        failures: 3, problem: "HTTP 503")),
                openedAt: now.addingTimeInterval(-4 * minute), acknowledgedAt: acknowledgedAt)
        }

        // Yesterday's: the feed failing for 20 minutes, since recovered.
        private static func recovered(_ now: Date) -> Incident {
            Incident(
                id: "019a0fe0-7200-7b00-8c00-000000000003", component: "notes-api", environment: "prod",
                subject: "GET /api/feed", title: "GET /api/feed: 9% failed, usually 0.2%",
                evidence: .failing(
                    FailingEvidence(operation: "GET /api/feed", failed: 54, count: 600, usualRate: 0.002)),
                openedAt: now.addingTimeInterval(-26 * hour),
                resolvedAt: now.addingTimeInterval(-26 * hour + 20 * minute),
                acknowledgedAt: now.addingTimeInterval(-26 * hour + 3 * minute))
        }

        private static func today(_ now: Date) -> TodayList {
            let errors = errors(now)
            return TodayList(
                items: [
                    .incident(IncidentItem(project: "notes", incident: down(now))),
                    .error(ErrorItem(project: "notes", error: errors.groups[1], isNew: true, ongoing: true)),
                    .slower(
                        SlowerItem(
                            project: "atlas", component: "atlas-api", environment: "prod", operation: "GET /api/search",
                            p95Ms: 640, usualP95Ms: 210)),
                    .promotion(
                        PromotionItem(
                            project: "notes", component: "notes-ios", environment: "production", release: "1.2.0+12",
                            promotion: reviewId, state: .approved, startedAt: now.addingTimeInterval(-5 * hour))),
                ],
                projects: projects(now),
                unanswered: [],
                pulses: [
                    ProjectPulse(
                        project: "notes", load: pulseLoad(now, busiest: 9_400, failingLately: true),
                        people: DemoAnalytics.pulsePeople(now)),
                    ProjectPulse(
                        project: "atlas", load: pulseLoad(now, busiest: 3_100, failingLately: false),
                        people: PulsePeople(
                            latest: UsageDay(
                                day: dayText(now, daysAgo: 1), people: 412, installations: 440, monthPeople: 3_150,
                                sessions: 1_210, foregroundMs: 160_000_000),
                            weekBefore: UsageDay(
                                day: dayText(now, daysAgo: 8), people: 421, installations: 452, monthPeople: 3_080,
                                sessions: 1_260, foregroundMs: 170_000_000))),
                    // An API without apps: its people are unknown.
                    ProjectPulse(project: "kiln", load: pulseLoad(now, busiest: 820, failingLately: false)),
                ],
                at: now)
        }

        // The current hour so far and the 23 before it: busiest in the afternoon, quiet at night;
        // failing more over the last three hours when `failingLately`.
        private static func pulseLoad(_ now: Date, busiest: Double, failingLately: Bool) -> [PulseHour] {
            let current = (now.timeIntervalSince1970 / hour).rounded(.down) * hour
            return (0..<24).map { index in
                let at = current - Double(23 - index) * hour
                let hourOfDay = at.truncatingRemainder(dividingBy: day) / hour
                let busy = 0.55 + 0.45 * sin((hourOfDay - 9) / 24 * 2 * .pi)
                let whole = Int(busiest * busy) + index * 37 % 23
                let count = index == 23 ? whole * Int(now.timeIntervalSince1970 - current) / Int(hour) : whole
                let errors = failingLately && index >= 21 ? count / 14 : count / 500
                return PulseHour(start: Date(timeIntervalSince1970: at), count: count, errors: errors)
            }
        }

        private static func dayText(_ now: Date, daysAgo: Int) -> String {
            let start = (now.timeIntervalSince1970 / day).rounded(.down) * day - Double(daysAgo) * day
            return Date(timeIntervalSince1970: start).formatted(
                Date.ISO8601FormatStyle(timeZone: .gmt).year().month().day())
        }

        private static let apiDev = DeployTarget(environment: "dev", workflow: "deploy.yml")
        private static let apiProd = DeployTarget(environment: "prod", workflow: "deploy.yml")
        private static let iosInternal = DeployTarget(
            environment: "internal", workflow: "ios.yml",
            appStore: AppStoreTarget(bundleId: "com.example.notes", distribution: .testFlight))
        private static let iosBeta = DeployTarget(
            environment: "beta", appStore: AppStoreTarget(bundleId: "com.example.notes", distribution: .testFlight))
        private static let iosProduction = DeployTarget(
            environment: "production", workflow: "ios.yml",
            appStore: AppStoreTarget(bundleId: "com.example.notes", distribution: .appStore))

        private static func detail(_ now: Date) -> ProjectDetail {
            let created = now.addingTimeInterval(-60 * day)
            return ProjectDetail(
                project: notes(now),
                components: [
                    Component(
                        key: "notes-api", name: "notes-api", createdAt: created, repository: "notesapp/notes",
                        deployTargets: [apiDev, apiProd]),
                    Component(
                        key: "notes-worker", name: "notes-worker", createdAt: created, repository: "notesapp/notes",
                        shipsWith: "notes-api"),
                    Component(
                        key: "notes-ios", name: "notes-ios", createdAt: created, repository: "notesapp/notes-ios",
                        deployTargets: [iosInternal, iosBeta, iosProduction]),
                ],
                settings: ProjectSettings(productionEnvironments: ["prod", "production"]),
                environments: ["prod", "production", "beta", "dev", "internal"]
            )
        }

        private static func versions(_ now: Date) -> [ComponentVersion] {
            [
                ComponentVersion(
                    component: "notes-api", version: "1.0.0", lastBuild: 1, setAt: now.addingTimeInterval(-3 * day)),
                ComponentVersion(
                    component: "notes-ios", version: "1.2.0", lastBuild: 14, setAt: now.addingTimeInterval(-9 * day)),
            ]
        }

        // MARK: Releases, and where they are

        private struct Placed {
            let summary: ReleaseSummary
            let since: Date
        }

        private static func commit(_ repository: String, _ sha: String, _ message: String, _ at: Date) -> ReleaseCommit
        {
            ReleaseCommit(
                sha: sha, message: message, author: "alex", committedAt: at,
                url: "https://github.com/\(repository)/commit/\(sha)")
        }

        // Each release the delivery shows, in the environment it's in.
        private static func summaries(_ now: Date) -> [Placed] {
            func ago(_ seconds: TimeInterval) -> Date { now.addingTimeInterval(-seconds) }
            let apiDev = ReleaseSummary(
                component: "notes-api", environment: "dev", release: "1.0.0+1", firstSeen: ago(2 * hour + 4 * minute),
                lastSeen: ago(minute), count: 8_420, errors: 12, previous: "2026.10.20-a1b2c3d", verdict: .same,
                slower: 0, failingMore: 0, newErrors: 0,
                commit: commit(
                    "notesapp/notes", "f5e1c2a94b7d3e8f0a1b2c3d4e5f60718293a4b5",
                    "Cache the feed for offline reading\n\nKeeps the newest 200 notes on the phone.", ago(3 * hour)),
                deployedAt: ago(2 * hour + 5 * minute))
            let apiProd = ReleaseSummary(
                component: "notes-api", environment: "prod", release: "2026.10.20-a1b2c3d", firstSeen: ago(2 * day),
                lastSeen: ago(minute), count: 182_400, errors: 410, previous: "2026.10.17-9c8d7e6", verdict: .better,
                slower: 0, failingMore: 0, newErrors: 0,
                commit: commit(
                    "notesapp/notes", "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
                    "Speed up search with a trigram index",
                    ago(2 * day + 3 * hour)),
                deployedAt: ago(2 * day))
            let workerDev = ReleaseSummary(
                component: "notes-worker", environment: "dev", release: "1.0.0+1", firstSeen: ago(2 * hour),
                lastSeen: ago(minute), count: 1_204, errors: 0, previous: "2026.10.20-a1b2c3d", verdict: .same,
                slower: 0, failingMore: 0, newErrors: 0, commit: apiDev.commit, deployedAt: ago(2 * hour + 5 * minute))
            let workerProd = ReleaseSummary(
                component: "notes-worker", environment: "prod", release: "2026.10.20-a1b2c3d", firstSeen: ago(2 * day),
                lastSeen: ago(minute), count: 30_118, errors: 4, previous: "2026.10.17-9c8d7e6", verdict: .same,
                slower: 0, failingMore: 0, newErrors: 0, commit: apiProd.commit, deployedAt: ago(2 * day))
            let iosInternal = ReleaseSummary(
                component: "notes-ios", environment: "internal", release: "1.2.0+14", previous: "1.2.0+12",
                verdict: .unmeasured, slower: 0, failingMore: 0, newErrors: 0,
                commit: commit(
                    "notesapp/notes-ios", "c0ffee1234567890abcdef1234567890abcdef12", "Add widgets for pinned notes",
                    ago(hour)),
                store: StoreBuild(
                    version: "1.2.0", buildNumber: "14", uploadedAt: ago(38 * minute), stage: .testing,
                    internalTesting: "IN_BETA_TESTING"))
            let iosBeta = ReleaseSummary(
                component: "notes-ios", environment: "beta", release: "1.2.0+12", firstSeen: ago(3 * day),
                lastSeen: ago(10 * minute), count: 2_310, errors: 3, previous: "1.1.0+9", verdict: .same, slower: 0,
                failingMore: 0, newErrors: 0,
                commit: commit(
                    "notesapp/notes-ios", "b16b00b5deadbeef0123456789abcdef01234567", "Sync drafts across devices",
                    ago(3 * day + 2 * hour)),
                store: StoreBuild(
                    version: "1.2.0", buildNumber: "12", uploadedAt: ago(3 * day), stage: .testing,
                    externalTesting: "IN_BETA_TESTING"))
            let iosProduction = ReleaseSummary(
                component: "notes-ios", environment: "production", release: "1.1.0+9", firstSeen: ago(12 * day),
                lastSeen: ago(minute), count: 48_200, errors: 31, previous: "1.1.0+7", verdict: .better, slower: 0,
                failingMore: 0, newErrors: 0,
                commit: commit(
                    "notesapp/notes-ios", "9a8b7c6d5e4f30211223344556677889900aabbc", "Fix sharing from Safari",
                    ago(13 * day)),
                store: StoreBuild(
                    version: "1.1.0", buildNumber: "9", uploadedAt: ago(13 * day), stage: .live,
                    appStoreState: "READY_FOR_SALE"))
            return [
                Placed(summary: apiDev, since: ago(2 * hour + 5 * minute)),
                Placed(summary: apiProd, since: ago(2 * day)),
                Placed(summary: workerDev, since: ago(2 * hour + 5 * minute)),
                Placed(summary: workerProd, since: ago(2 * day)),
                Placed(summary: iosInternal, since: ago(38 * minute)),
                Placed(summary: iosBeta, since: ago(3 * day)),
                Placed(summary: iosProduction, since: ago(12 * day)),
            ]
        }

        private static let reviewId = "019a0fa0-4f00-7f60-9a71-6c7d8e9fa0b1"

        private static func delivery(_ now: Date) -> Delivery {
            let placed = summaries(now)
            func current(_ component: String, _ environment: String) -> CurrentRelease? {
                placed.first { $0.summary.component == component && $0.summary.environment == environment }.map {
                    CurrentRelease(summary: $0.summary, since: $0.since)
                }
            }
            // Approved in App Store review: Now says it waits for you.
            let review = Promotion(
                id: reviewId, component: "notes-ios", release: "1.2.0+12",
                environment: "production", repository: "notesapp/notes-ios", workflow: "ios.yml", runner: .auto,
                appStore: iosProduction.appStore,
                submission: AppStoreSubmission(releaseType: .manual, phased: true), startedBy: "m1",
                reason: "Drafts sync for everyone", startedAt: now.addingTimeInterval(-5 * hour), state: .approved,
                run: PromotionRun(id: 118_730, url: "https://github.com/notesapp/notes-ios/actions/runs/118730"))
            let versions = versions(now)
            return Delivery(components: [
                ComponentDelivery(
                    component: "notes-api", version: versions[0],
                    environments: [
                        EnvironmentDelivery(
                            environment: "dev", target: apiDev, current: current("notes-api", "dev"),
                            next: .buildLatest(BuildLatestNext())),
                        EnvironmentDelivery(
                            environment: "prod", target: apiProd, current: current("notes-api", "prod"),
                            failedPromotion: UserDefaults.standard.bool(forKey: "CluenoriDemoFailure")
                                ? failedToProd(now) : nil,
                            next: .promote(PromoteNext(release: "1.0.0+1", from: "dev"))),
                    ]),
                ComponentDelivery(
                    component: "notes-worker", shipsWith: "notes-api",
                    environments: [
                        EnvironmentDelivery(environment: "dev", current: current("notes-worker", "dev")),
                        EnvironmentDelivery(environment: "prod", current: current("notes-worker", "prod")),
                    ]),
                ComponentDelivery(
                    component: "notes-ios", version: versions[1],
                    environments: [
                        EnvironmentDelivery(
                            environment: "internal", target: iosInternal, current: current("notes-ios", "internal"),
                            next: .buildLatest(BuildLatestNext())),
                        EnvironmentDelivery(
                            environment: "beta", target: iosBeta, current: current("notes-ios", "beta"),
                            next: .promote(PromoteNext(release: "1.2.0+14", from: "internal"))),
                        EnvironmentDelivery(
                            environment: "production", target: iosProduction,
                            current: current("notes-ios", "production"), promotion: review),
                    ]),
            ])
        }

        // The promotion of the API's 1.0.0+1 to prod, whose run failed half an hour ago.
        private static func failedToProd(_ now: Date) -> Promotion {
            Promotion(
                id: "019a0fc0-6100-7a00-8b00-000000000001", component: "notes-api", release: "1.0.0+1",
                environment: "prod", repository: "notesapp/notes", workflow: "deploy.yml", runner: .auto,
                startedBy: "m1", startedAt: now.addingTimeInterval(-41 * minute), state: .failed,
                run: PromotionRun(id: 118_744, url: "https://github.com/notesapp/notes/actions/runs/118744"),
                endedAt: now.addingTimeInterval(-33 * minute))
        }

        private static func releaseDetail(_ summary: ReleaseSummary, _ now: Date) -> ReleaseDetail {
            let repository = summary.component == "notes-ios" ? "notesapp/notes-ios" : "notesapp/notes"
            let targets: [DeployTarget] =
                switch summary.component {
                case "notes-api": [apiDev, apiProd]
                case "notes-ios": [iosInternal, iosBeta, iosProduction]
                default: []
                }
            let changes = ReleaseChanges(
                totalCommits: 7,
                commits: [],
                pullRequests: [
                    MergedPullRequest(
                        number: 131, title: "Cache the feed for offline reading", author: "alex",
                        url: "https://github.com/\(repository)/pull/131", labels: ["feature"]),
                    MergedPullRequest(
                        number: 129, title: "Fix a crash when a note is empty", author: "sam",
                        url: "https://github.com/\(repository)/pull/129", labels: ["bug"]),
                ],
                filesChanged: 14, additions: 412, deletions: 96,
                url: "https://github.com/\(repository)/compare/\(summary.previous ?? "main")...\(summary.release)")
            let deployed = Promotion(
                id: "019a0f90-3e00-7e50-8a61-5b6c7d8e9fa0", component: summary.component, release: summary.release,
                environment: summary.environment ?? "dev", repository: repository, workflow: "deploy.yml",
                runner: .local, startedBy: "m1", startedAt: now.addingTimeInterval(-2 * hour - 9 * minute),
                state: .succeeded,
                run: PromotionRun(id: 118_702, url: "https://github.com/\(repository)/actions/runs/118702"),
                endedAt: now.addingTimeInterval(-2 * hour - 5 * minute))
            return ReleaseDetail(
                summary: summary, slower: [], failingMore: [], faster: [], failingLess: [],
                newOperations: summary.component == "notes-api" ? ["GET /api/feed/offline"] : [], newErrors: [],
                incidents: [], changes: changes, problems: [], promotions: [deployed], deployTargets: targets,
                notes: [ReleaseNote(locale: "en-US", text: "Read your feed offline.")], repository: repository)
        }

        // MARK: Telemetry

        private static func load(_ now: Date) -> LoadSeries {
            let step: TimeInterval = 5 * minute
            let start = (now.timeIntervalSince1970 / step).rounded(.down) * step - 287 * step
            let points = (0..<288).map { index in
                let at = start + Double(index) * step
                // A day's rhythm: busiest in the afternoon, quiet at night.
                let hourOfDay = (at.truncatingRemainder(dividingBy: day)) / hour
                let busy = 0.55 + 0.45 * sin((hourOfDay - 9) / 24 * 2 * .pi)
                let count = Int(420 * busy) + (index * 37 % 23)
                return LoadPoint(
                    start: Date(timeIntervalSince1970: at), count: count, errors: index % 41 == 0 ? 6 : count / 300,
                    p50Ms: 48, p80Ms: 96, p95Ms: 180 + Double(index * 13 % 40), p99Ms: 420)
            }
            return LoadSeries(step: .`5m`, points: points)
        }

        private static let operations = OperationTable(
            rows: [
                OperationRow(
                    component: "notes-api", environment: "prod", operation: "GET /api/feed", count: 62_100, errors: 120,
                    averageMs: 64, p50Ms: 41, p80Ms: 88, p95Ms: 212, p99Ms: 480),
                OperationRow(
                    component: "notes-api", environment: "prod", operation: "POST /api/notes", count: 18_420,
                    errors: 31,
                    averageMs: 92, p50Ms: 70, p80Ms: 130, p95Ms: 290, p99Ms: 610),
            ],
            count: 80_520, errors: 151)

        private static func errors(_ now: Date) -> ErrorTable {
            ErrorTable(
                groups: [
                    ErrorGroup(
                        id: "4f1c9a2e7b3d5068", kind: .exception, title: "TimeoutError: search took longer than 5 s",
                        culprit: "search.ts in runSearch", occurrences: 38, firstSeen: now.addingTimeInterval(-5 * day),
                        lastSeen: now.addingTimeInterval(-12 * minute), lastComponent: "notes-api",
                        lastEnvironment: "prod",
                        lastRelease: "2026.10.20-a1b2c3d"),
                    ErrorGroup(
                        id: "7c3b1a9e5d2f4680", kind: .exception, title: "TypeError: note.body is undefined",
                        culprit: "drafts.ts in mergeDraft", occurrences: 37,
                        firstSeen: now.addingTimeInterval(-41 * minute),
                        lastSeen: now.addingTimeInterval(-2 * minute), lastComponent: "notes-api",
                        lastEnvironment: "prod",
                        lastRelease: "2026.10.20-a1b2c3d"),
                    ErrorGroup(
                        id: "9e2d4c6b8a0f1357", kind: .log, title: "Push token rejected by APNs", culprit: "push.ts",
                        occurrences: 9, firstSeen: now.addingTimeInterval(-2 * day),
                        lastSeen: now.addingTimeInterval(-hour), lastComponent: "notes-worker", lastEnvironment: "prod",
                        lastRelease: "2026.10.20-a1b2c3d"),
                ],
                occurrences: 84)
        }

        private static func logs(_ now: Date) -> LogPage {
            LogPage(lines: [
                LogLine(
                    id: 3, component: "notes-api", time: now.addingTimeInterval(-12 * minute), level: .error,
                    category: "Search", message: "Search took longer than 5 s", attributes: [:]),
                LogLine(
                    id: 2, component: "notes-worker", time: now.addingTimeInterval(-hour), level: .warn,
                    category: "Push",
                    message: "APNs rejected a token; removed it", attributes: [:]),
            ])
        }

        // MARK: Encoding, as the deployment does

        static func ok(_ value: some Encodable) -> (Int, Data) {
            (200, encoded(value))
        }

        static func encoded(_ value: some Encodable) -> Data {
            let encoder = JSONEncoder()
            let instant = Date.ISO8601FormatStyle(includingFractionalSeconds: true)
            encoder.dateEncodingStrategy = .custom { date, encoder in
                var container = encoder.singleValueContainer()
                try container.encode(date.formatted(instant))
            }
            // Not handled: a fixture that doesn't encode, which a look at the screen shows at once.
            return (try? encoder.encode(value)) ?? Data()
        }
    }
#endif
