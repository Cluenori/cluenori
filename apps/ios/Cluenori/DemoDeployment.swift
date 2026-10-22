#if DEBUG
    import CluenoriClient
    import CluenoriScreens
    import Foundation
    import UIKit

    /// A deployment made up on the phone, for looking at the app's screens with realistic data, such as
    /// for screenshots in the Simulator: launched with `-CluenoriDemo YES`, the app pairs with it in
    /// place of the Keychain's pairing, keeps nothing, and opens the link `-CluenoriDemoOpen` names;
    /// with `-CluenoriDemoStep <environment>` too, a component's link opens the promote sheet of its
    /// next step there; `-CluenoriDemoScroll <points>` scrolls the screen's list down that far, to show
    /// its lower part; `-CluenoriDemoFailure YES` makes the API's last promotion to prod one that
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
            guard UserDefaults.standard.bool(forKey: "CluenoriDemo"),
                let link = UserDefaults.standard.string(forKey: "CluenoriDemoOpen").flatMap(URL.init(string:)),
                let route = Route(link)
            else { return }
            pairing.navigation.open(route)
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

    /// The made-up deployment's answers: the notes project, with an API deployed dev then prod, a
    /// worker that ships with it, and an iOS app through TestFlight to the App Store; times are
    /// relative to now.
    private nonisolated enum DemoAnswers {
        static let transport: CluenoriAPI.Transport = { request in
            let path = request.url?.path(percentEncoded: false) ?? ""
            let method = request.httpMethod ?? "GET"
            let (status, body) = answer(method, path)
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
                return ok(ProjectList(projects: [notes(now)]))
            case ("GET", "/api/today"):
                return ok(TodayList(items: [], projects: [notes(now)], unanswered: [], at: now))
            case ("GET", project):
                return ok(detail(now))
            case ("GET", "\(project)/delivery"):
                return ok(delivery(now))
            case ("GET", "\(project)/versions"):
                return ok(ComponentVersions(versions: versions(now)))
            case ("GET", "\(project)/incidents"):
                return ok(IncidentList(open: [], resolved: []))
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

        private static func delivery(_ now: Date) -> Delivery {
            let placed = summaries(now)
            func current(_ component: String, _ environment: String) -> CurrentRelease? {
                placed.first { $0.summary.component == component && $0.summary.environment == environment }.map {
                    CurrentRelease(summary: $0.summary, since: $0.since)
                }
            }
            let review = Promotion(
                id: "019a0fa0-4f00-7f60-9a71-6c7d8e9fa0b1", component: "notes-ios", release: "1.2.0+12",
                environment: "production", repository: "notesapp/notes-ios", workflow: "ios.yml", runner: .auto,
                appStore: iosProduction.appStore,
                submission: AppStoreSubmission(releaseType: .afterApproval, phased: true), startedBy: "m1",
                reason: "Drafts sync for everyone", startedAt: now.addingTimeInterval(-5 * hour), state: .inReview,
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
                        id: "9e2d4c6b8a0f1357", kind: .log, title: "Push token rejected by APNs", culprit: "push.ts",
                        occurrences: 9, firstSeen: now.addingTimeInterval(-2 * day),
                        lastSeen: now.addingTimeInterval(-hour), lastComponent: "notes-worker", lastEnvironment: "prod",
                        lastRelease: "2026.10.20-a1b2c3d"),
                ],
                occurrences: 47)
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

        private static func ok(_ value: some Encodable) -> (Int, Data) {
            (200, encoded(value))
        }

        private static func encoded(_ value: some Encodable) -> Data {
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
