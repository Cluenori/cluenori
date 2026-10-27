import Foundation

/// An operation of a project, as its screen opens it: in one environment, over every release or one.
public struct OperationRef: Hashable, Sendable {
    public let project: String
    public let component: String
    /// Where it ran; absent when the component didn't say.
    public let environment: String?
    public let name: String
    /// Only this release of the component's, by its version; nil for every release.
    public let release: String?

    public init(project: String, component: String, environment: String?, name: String, release: String? = nil) {
        self.project = project
        self.component = component
        self.environment = environment
        self.name = name
        self.release = release
    }

    /// Whose operations it is among: its release's, or its project's in its environment.
    public var telemetry: Telemetry {
        guard let release else { return .project(project, environment: environment) }
        return .release(ReleaseRef(project: project, component: component, environment: environment, version: release))
    }

    /// The same operation over every release.
    public var everyRelease: OperationRef {
        OperationRef(project: project, component: component, environment: environment, name: name)
    }
}

/// One request of a project, as its screen opens it: by its trace's ID, with when it started when a
/// link knows it, which says which archive files to read first.
public struct TraceRef: Hashable, Sendable {
    public let project: String
    public let id: String
    public let around: Date?

    public init(project: String, id: String, around: Date? = nil) {
        self.project = project
        self.id = id
        self.around = around
    }
}

/// A release of a project's component, as its screen opens it, and as the project's operations,
/// errors, and logs can be narrowed to it.
public struct ReleaseRef: Hashable, Sendable {
    public let project: String
    public let component: String
    /// Absent when the component didn't say.
    public let environment: String?
    /// The release's version, as the component's services report it in `service.version`:
    /// `2026.10.21-e91f09c`.
    public let version: String

    public init(project: String, component: String, environment: String?, version: String) {
        self.project = project
        self.component = component
        self.environment = environment
        self.version = version
    }
}

/// Whose operations, errors, or logs a screen shows: a project's in one environment, or one release's
/// of it, in the release's own.
public enum Telemetry: Hashable, Sendable {
    /// A project's, in `environment`. Without one, a route shows the environment chosen for the
    /// project (`DeploymentModels.resolved`), and a screen's model asks about every environment, as
    /// for a deployment that doesn't tell them apart.
    case project(String, environment: String? = nil)
    case release(ReleaseRef)

    public var project: String {
        switch self {
        case .project(let key, _): key
        case .release(let release): release.project
        }
    }

    /// The release it is narrowed to; nil for the project's.
    public var release: ReleaseRef? {
        switch self {
        case .project: nil
        case .release(let release): release
        }
    }

    /// The environment its questions name: the project's chosen one, or the release's; nil for none.
    public var environment: String? {
        switch self {
        case .project(_, let environment): environment
        case .release(let release): release.environment
        }
    }

    /// Where its answers are kept: the project's own place for every environment, one for each of
    /// its environments, and one for each release.
    var key: String {
        switch self {
        case .project(let key, nil):
            "projects/\(key)"
        case .project(let key, let environment?):
            "projects/\(key)/environments/\(environment)"
        case .release(let release):
            "projects/\(release.project)/release/\(release.component)/\(release.environment ?? "")/\(release.version)"
        }
    }
}

/// Whose app analytics a screen shows: a project's apps, every component's or one's, in one
/// environment, or, without one, in the one chosen for the project.
nonisolated public struct AnalyticsRef: Hashable, Sendable {
    public let project: String
    /// Only this component's; nil for every component's.
    public let component: String?
    /// Nil: the environment chosen for the project (`DeploymentModels.resolved`), else every one.
    public let environment: String?

    public init(project: String, component: String? = nil, environment: String? = nil) {
        self.project = project
        self.component = component
        self.environment = environment
    }

    /// The same, in `environment`.
    func showing(_ environment: String) -> AnalyticsRef {
        AnalyticsRef(project: project, component: component, environment: environment)
    }

    /// The same, of `component`; of every component for nil.
    public func of(_ component: String?) -> AnalyticsRef {
        AnalyticsRef(project: project, component: component, environment: environment)
    }
}

/// A screen of the paired deployment, which navigation opens by value, over Now: the deployment's
/// feeds, or a project's screen. A project's screen leads to its doors: its app analytics, its tech,
/// and its delivery. A screen of a project's telemetry names its environment, or, without one, shows
/// the one chosen for the project.
public enum Route: Hashable, Sendable {
    /// The deployment's feeds: live lists of chosen events across projects.
    case feeds
    /// One feed, live, by its ID.
    case feed(id: String)
    /// A project's summary: its people and load in production, what needs you there, and its doors.
    case project(String)
    /// A project's tech: its latest operations, errors, logs and incidents, each leading to all of
    /// them, in one environment over the period.
    case tech(project: String, environment: String? = nil)
    /// A project's incidents, open and resolved, in every environment.
    case incidents(project: String)
    /// One of a project's incidents: its whole life, whatever any period.
    case incident(project: String, id: String)
    /// A project's monitors: whether everything is up, and each one's last 30 days.
    case uptime(project: String)
    /// One of a project's monitors and its history of checks.
    case monitor(project: String, id: String)
    /// A project's delivery: what release is in each of its components' environments, and what's
    /// next.
    case delivery(project: String)
    case operations(of: Telemetry)
    case operation(OperationRef)
    /// One request and its trace, by its ID, whenever it happened.
    case trace(TraceRef)
    case errors(of: Telemetry)
    case error(of: Telemetry, id: String)
    case logs(of: Telemetry)
    /// One log message and its lines, over the list's period or release.
    case logMessage(of: Telemetry, id: Int)
    /// One warning or error, by its ID, with no period.
    case logLine(project: String, id: Int)
    case releases(project: String, environment: String? = nil)
    /// One component's delivery: its environments in the order its releases go through them, what's
    /// in each, and the next step; its version, and what ships with it.
    case component(project: String, component: String)
    /// Every release of one component, in every environment, over the period.
    case componentReleases(project: String, component: String)
    case release(ReleaseRef)
    /// A release's notes for its users, edited.
    case notes(ReleaseRef)
    /// How the project's release notes read, which drafts follow.
    case notesStyle(project: String)
    /// How a project's apps are used and how healthy each release is, over the analytics period.
    case analytics(AnalyticsRef)
    /// Every feature's use, over the analytics period.
    case features(AnalyticsRef)
    /// One release's app health beside the release before it, in the release's environment.
    case appHealth(ReleaseRef)
    /// One feature's story, with no period, in one environment or every one.
    case feature(FeatureRef)
    /// One person, by the app's own user ID for them.
    case person(project: String, user: String)
    /// One person, by Cluenori's ID for them: their screen's lasting address.
    case personByID(project: String, person: String)
    /// One component's version policy: which releases must update, and which are offered it.
    case versionPolicy(project: String, component: String)
    /// One component's SDK keys, which its app's builds carry.
    case sdkKeys(project: String, component: String)
    /// One component's ingest keys, which its services send telemetry with; an owner's.
    case ingestKeys(project: String, component: String)

    /// The project the screen is of; nil for the deployment's own, the feeds.
    public var project: String? {
        switch self {
        case .feeds, .feed: nil
        case .project(let key), .tech(let key, _), .incidents(let key), .incident(let key, _), .uptime(let key),
            .monitor(let key, _), .delivery(let key),
            .releases(let key, _), .notesStyle(let key), .component(let key, _), .componentReleases(let key, _),
            .person(let key, _), .personByID(let key, _), .versionPolicy(let key, _), .sdkKeys(let key, _),
            .ingestKeys(let key, _),
            .logLine(let key, _):
            key
        case .feature(let feature): feature.project
        case .analytics(let analytics), .features(let analytics): analytics.project
        case .appHealth(let release): release.project
        case .operations(let telemetry), .errors(let telemetry), .error(let telemetry, _), .logs(let telemetry),
            .logMessage(let telemetry, _):
            telemetry.project
        case .operation(let operation): operation.project
        case .trace(let trace): trace.project
        case .release(let release), .notes(let release): release.project
        }
    }

    /// The same screen of the whole project, in its chosen environment, for one narrowed to a
    /// release; nil for any other.
    public var withoutRelease: Route? {
        switch self {
        case .operations(.release(let release)): .operations(of: .project(release.project))
        case .errors(.release(let release)): .errors(of: .project(release.project))
        case .error(.release(let release), let id): .error(of: .project(release.project), id: id)
        case .logs(.release(let release)): .logs(of: .project(release.project))
        case .logMessage(.release(let release), let id): .logMessage(of: .project(release.project), id: id)
        case .operation(let operation) where operation.release != nil: .operation(operation.everyRelease)
        default: nil
        }
    }

    /// The same screen in `environment`, when it is one of `project`'s that shows an environment of
    /// the project's choosing: not a release's, which shows the release's own, nor an operation
    /// whose component doesn't say where it runs.
    func showing(_ environment: String, in project: String) -> Route {
        guard self.project == project else { return self }
        switch self {
        case .tech(let key, _): return .tech(project: key, environment: environment)
        case .releases(let key, _): return .releases(project: key, environment: environment)
        case .operations(.project(let key, _)): return .operations(of: .project(key, environment: environment))
        case .errors(.project(let key, _)): return .errors(of: .project(key, environment: environment))
        case .error(.project(let key, _), let id): return .error(of: .project(key, environment: environment), id: id)
        case .logs(.project(let key, _)): return .logs(of: .project(key, environment: environment))
        case .logMessage(.project(let key, _), let id):
            return .logMessage(of: .project(key, environment: environment), id: id)
        case .operation(let operation) where operation.release == nil && operation.environment != nil:
            return .operation(
                OperationRef(
                    project: operation.project, component: operation.component, environment: environment,
                    name: operation.name))
        case .analytics(let analytics): return .analytics(analytics.showing(environment))
        case .features(let analytics): return .features(analytics.showing(environment))
        case .feature(let feature):
            return .feature(FeatureRef(project: feature.project, key: feature.key, environment: environment))
        default: return self
        }
    }

    /// The same screen in `environment` when it is a project's screen that names none; any other as
    /// it is.
    func choosing(_ environment: String) -> Route {
        guard let project else { return self }
        return switch self {
        case .tech(_, nil), .releases(_, nil), .operations(.project(_, nil)), .errors(.project(_, nil)),
            .error(.project(_, nil), _), .logs(.project(_, nil)), .logMessage(.project(_, nil), _):
            showing(environment, in: project)
        case .analytics(let analytics) where analytics.environment == nil: showing(environment, in: project)
        case .features(let analytics) where analytics.environment == nil: showing(environment, in: project)
        case .feature(let feature) where feature.environment == nil: showing(environment, in: project)
        default: self
        }
    }

    /// The screens leading to this one from its project's, this one last: what a link opens. Its
    /// telemetry comes from its tech, its releases from its delivery, its apps' screens from its
    /// analytics; a screen narrowed to a release comes from the release's.
    public var chain: [Route] {
        switch self {
        case .feeds, .project: [self]
        case .feed: [.feeds, self]
        case .tech(let key, _), .delivery(let key): [.project(key), self]
        case .incidents(let key): [.project(key), .tech(project: key), self]
        case .incident(let key, _): [.project(key), .tech(project: key), .incidents(project: key), self]
        // Uptime opens from the incidents, a monitor from Uptime.
        case .uptime(let key): [.project(key), .tech(project: key), .incidents(project: key), self]
        case .monitor(let key, _):
            [.project(key), .tech(project: key), .incidents(project: key), .uptime(project: key), self]
        case .releases(let key, _): [.project(key), .delivery(project: key), self]
        case .component(let key, _): [.project(key), .delivery(project: key), self]
        case .componentReleases(let key, let component):
            [.project(key), .delivery(project: key), .component(project: key, component: component), self]
        case .release(let release): Self.releaseChain(release)
        case .notes(let release): Self.releaseChain(release) + [self]
        case .notesStyle(let key): [.project(key), .delivery(project: key), self]
        case .operations(let telemetry), .errors(let telemetry), .logs(let telemetry):
            Self.chain(of: telemetry) + [self]
        case .operation(let operation):
            Self.chain(of: operation.telemetry) + [.operations(of: operation.telemetry), self]
        case .error(let telemetry, _): Self.chain(of: telemetry) + [.errors(of: telemetry), self]
        // A request comes from its project's operations, in the environment chosen for it.
        case .trace(let trace):
            Self.chain(of: .project(trace.project)) + [.operations(of: .project(trace.project)), self]
        case .logMessage(let telemetry, _): Self.chain(of: telemetry) + [.logs(of: telemetry), self]
        // A line has no period or environment: it comes from the project's logs.
        case .logLine(let key, _): Self.chain(of: .project(key)) + [.logs(of: .project(key)), self]
        case .analytics(let analytics): [.project(analytics.project), self]
        case .features(let analytics): [.project(analytics.project), .analytics(analytics), self]
        // A release's app health comes from its component's analytics, in its environment.
        case .appHealth(let release):
            [
                .project(release.project),
                .analytics(
                    AnalyticsRef(
                        project: release.project, component: release.component, environment: release.environment)),
                self,
            ]
        case .feature(let feature):
            [
                .project(feature.project), .analytics(AnalyticsRef(project: feature.project)),
                .features(AnalyticsRef(project: feature.project)), self,
            ]
        case .person(let key, _), .personByID(let key, _):
            [.project(key), .analytics(AnalyticsRef(project: key)), self]
        case .versionPolicy(let key, let component), .sdkKeys(let key, let component):
            [.project(key), .analytics(AnalyticsRef(project: key, component: component)), self]
        case .ingestKeys(let key, let component):
            [.project(key), .delivery(project: key), .component(project: key, component: component), self]
        }
    }

    // A release comes from its component's screen, where its environments are.
    private static func releaseChain(_ release: ReleaseRef) -> [Route] {
        [
            .project(release.project), .delivery(project: release.project),
            .component(project: release.project, component: release.component), .release(release),
        ]
    }

    // The screens a list of `telemetry` comes from.
    private static func chain(of telemetry: Telemetry) -> [Route] {
        switch telemetry {
        case .project(let key, let environment): [.project(key), .tech(project: key, environment: environment)]
        case .release(let release): releaseChain(release)
        }
    }

    /// The screen a link names, `cluenori://projects/notes/errors/4f1c9a2e7b3d5068`; nil for any
    /// other link: `cluenori://feeds` and `cluenori://feeds/<ID>`; `cluenori://projects/<key>`, and
    /// under it `/tech`, `/incidents`, `/incidents/<id>`, `/uptime`, `/uptime/<monitor ID>`,
    /// `/delivery`, `/operations`, and one, `/operations/<name>?component=<key>`,
    /// its name as path segments, `/traces/<trace ID>`, which takes
    /// `?around=<ISO 8601>`, `/errors`, `/errors/<id>`, `/logs`,
    /// `/logs/messages/<id>`, `/logs/lines/<id>` (the project's alone),
    /// `/releases`, `/notes-style`, `/components/<component>` and its `/releases`, `/version-policy`
    /// and `/sdk-keys`, and `/releases/<component>/<release>`, under which `/operations`, `/errors`,
    /// `/errors/<id>`, `/logs` and `/logs/messages/<id>` are the release's alone, and `/notes` its notes; `/analytics` and
    /// its `/features`, which take `?component=<key>` too, and
    /// `/analytics/app-health/<component>/<release>`, `/analytics/features/<feature>` and
    /// `/analytics/people/<person ID>`; and `/people?user=<user ID>`. Each takes
    /// `?environment=<key>`: the environment a project's tech and telemetry show, or, for a
    /// release's, the one its component says it runs in; the project's own screen, in production,
    /// takes none.
    public init?(_ url: URL) {
        guard url.scheme == "cluenori" else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        if url.host() == "feeds" {
            switch parts.count {
            case 0: self = .feeds
            case 1: self = .feed(id: parts[0])
            default: return nil
            }
            return
        }
        guard url.host() == "projects" else { return nil }
        guard let project = parts.first else { return nil }
        let named = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
            .first { $0.name == "environment" }?.value
        let environment = named?.isEmpty == false ? named : nil
        let query = { (name: String) -> String? in
            let value = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
                .first { $0.name == name }?.value
            return value?.isEmpty == false ? value : nil
        }
        if parts.count >= 3, parts[1] == "components" {
            switch parts.count {
            case 3: self = .component(project: project, component: parts[2])
            case 4 where parts[3] == "releases": self = .componentReleases(project: project, component: parts[2])
            case 4 where parts[3] == "version-policy": self = .versionPolicy(project: project, component: parts[2])
            case 4 where parts[3] == "sdk-keys": self = .sdkKeys(project: project, component: parts[2])
            case 4 where parts[3] == "ingest-keys": self = .ingestKeys(project: project, component: parts[2])
            default: return nil
            }
            return
        }
        if parts.count >= 2, parts[1] == "analytics" {
            let analytics = AnalyticsRef(project: project, component: query("component"), environment: environment)
            switch parts.count {
            case 2: self = .analytics(analytics)
            case 3 where parts[2] == "features": self = .features(analytics)
            case 4 where parts[2] == "features":
                self = .feature(FeatureRef(project: project, key: parts[3], environment: environment))
            case 4 where parts[2] == "people": self = .personByID(project: project, person: parts[3])
            case 5 where parts[2] == "app-health":
                self = .appHealth(
                    ReleaseRef(project: project, component: parts[3], environment: environment, version: parts[4]))
            default: return nil
            }
            return
        }
        if parts.count >= 3, parts[1] == "operations" {
            // The name is the rest of the path as it is, its empty and trailing segments kept:
            // `POST /api/profile/` is another operation than `POST /api/profile`.
            let path = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? ""
            guard let component = query("component"),
                let encoded = path.split(separator: "/", maxSplits: 3, omittingEmptySubsequences: false).last,
                let name = String(encoded).removingPercentEncoding
            else { return nil }
            self = .operation(
                OperationRef(project: project, component: component, environment: environment, name: name))
            return
        }
        if parts.count == 3, parts[1] == "traces" {
            let around = query("around").flatMap { try? Date($0, strategy: .iso8601) }
            self = .trace(TraceRef(project: project, id: parts[2], around: around))
            return
        }
        if parts.count == 2, parts[1] == "people" {
            guard let user = query("user") else { return nil }
            self = .person(project: project, user: user)
            return
        }
        if parts.count >= 4, parts[1] == "releases" {
            let release = ReleaseRef(project: project, component: parts[2], environment: environment, version: parts[3])
            guard let route = Self.route(Array(parts.dropFirst(4)), of: .release(release)) else { return nil }
            self = route
            return
        }
        guard let route = Self.route(Array(parts.dropFirst()), of: .project(project, environment: environment)) else {
            return nil
        }
        self = route
    }

    // The screen `rest` names under a project's link or a release's: the project or release itself
    // for nothing; nil when it names none.
    private static func route(_ rest: [String], of telemetry: Telemetry) -> Route? {
        switch (rest.first, rest.count, telemetry) {
        case (nil, _, .project(let key, _)): .project(key)
        case (nil, _, .release(let release)): .release(release)
        case ("tech", 1, .project(let key, let environment)): .tech(project: key, environment: environment)
        case ("incidents", 1, .project(let key, _)): .incidents(project: key)
        case ("incidents", 2, .project(let key, _)): .incident(project: key, id: rest[1])
        case ("uptime", 1, .project(let key, _)): .uptime(project: key)
        case ("uptime", 2, .project(let key, _)): .monitor(project: key, id: rest[1])
        case ("delivery", 1, .project(let key, _)): .delivery(project: key)
        case ("operations", 1, _): .operations(of: telemetry)
        case ("errors", 1, _): .errors(of: telemetry)
        case ("errors", 2, _): .error(of: telemetry, id: rest[1])
        case ("logs", 1, _): .logs(of: telemetry)
        case ("logs", 3, _) where rest[1] == "messages": Self.number(rest[2]).map { .logMessage(of: telemetry, id: $0) }
        case ("logs", 3, .project(let key, _)) where rest[1] == "lines":
            Self.number(rest[2]).map { .logLine(project: key, id: $0) }
        case ("releases", 1, .project(let key, let environment)): .releases(project: key, environment: environment)
        case ("notes-style", 1, .project(let key, _)): .notesStyle(project: key)
        case ("notes", 1, .release(let release)): .notes(release)
        default: nil
        }
    }

    // A message's or a line's ID: a whole number from 1, as the deployment numbers them.
    private static func number(_ text: String) -> Int? {
        guard let value = Int(text), value >= 1 else { return nil }
        return value
    }
}

/// Where the app is: the screens opened over Now, the last on top. Views bind to it; links set it.
@Observable
public final class Navigation {
    /// The screens over Now, the root, the last on top.
    public var path: [Route] = []
    /// How far back every screen looks: one choice, kept across screens and projects, as on the web.
    public var period = PeriodKey.day
    /// How far back analytics screens look, in UTC days: its own choice, as on the web, since apps
    /// are counted by the day.
    public var analyticsPeriod = AnalyticsPeriod.month

    public init() {}

    /// Shows `route`'s screen over the one on top.
    public func push(_ route: Route) {
        path.append(route)
    }

    /// Shows `route`'s screen over the screens that lead to it from Now.
    public func open(_ route: Route) {
        path = route.chain
    }

    /// Shows `choice`'s project in `environment`, remembered for it: the screens open of the project
    /// that name another environment show this one instead, those of a release keep the release's.
    public func show(_ environment: String, of choice: EnvironmentChoice) {
        choice.choose(environment)
        path = path.map { $0.showing(environment, in: choice.project) }
    }

    /// Shows the analytics screen `route` of `component` instead, every component's for nil, in its
    /// place on top; nothing for another screen, or one not on top. `route` is the screen as it
    /// shows, in its environment: the one on top may name none, and show the one chosen for its
    /// project.
    public func showAnalytics(of component: String?, inPlaceOf route: Route) {
        let next: Route
        let shownIn: String?
        switch route {
        case .analytics(let analytics):
            (next, shownIn) = (.analytics(analytics.of(component)), analytics.environment)
        case .features(let analytics):
            (next, shownIn) = (.features(analytics.of(component)), analytics.environment)
        default: return
        }
        if let top = path.last, top != route, let shownIn, top.choosing(shownIn) == route {
            replaceTop(top, with: next)
            return
        }
        replaceTop(route, with: next)
    }

    /// Shows the screen of `route`, narrowed to a release, without its release, in its place on top;
    /// nothing when it isn't narrowed, or isn't on top.
    public func showWithoutRelease(_ route: Route) {
        guard let wider = route.withoutRelease else { return }
        replaceTop(route, with: wider)
    }

    // Shows `next` in place of `route` on top; nothing when it isn't on top.
    private func replaceTop(_ route: Route, with next: Route) {
        if path.last == route {
            path[path.count - 1] = next
        }
    }
}
