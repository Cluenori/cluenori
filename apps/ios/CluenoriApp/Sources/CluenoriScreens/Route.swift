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

/// A screen of the paired deployment, which navigation opens by value. A screen of a project's
/// telemetry names its environment, or, without one, shows the one chosen for the project.
public enum Route: Hashable, Sendable {
    case project(String, environment: String? = nil)
    case operations(of: Telemetry)
    case operation(OperationRef)
    case errors(of: Telemetry)
    case error(of: Telemetry, id: String)
    case logs(of: Telemetry)
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

    /// The project the screen is of.
    public var project: String {
        switch self {
        case .project(let key, _), .releases(let key, _), .notesStyle(let key), .component(let key, _),
            .componentReleases(let key, _):
            key
        case .operations(let telemetry), .errors(let telemetry), .error(let telemetry, _), .logs(let telemetry):
            telemetry.project
        case .operation(let operation): operation.project
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
        case .project(let key, _): return .project(key, environment: environment)
        case .releases(let key, _): return .releases(project: key, environment: environment)
        case .operations(.project(let key, _)): return .operations(of: .project(key, environment: environment))
        case .errors(.project(let key, _)): return .errors(of: .project(key, environment: environment))
        case .error(.project(let key, _), let id): return .error(of: .project(key, environment: environment), id: id)
        case .logs(.project(let key, _)): return .logs(of: .project(key, environment: environment))
        case .operation(let operation) where operation.release == nil && operation.environment != nil:
            return .operation(
                OperationRef(
                    project: operation.project, component: operation.component, environment: environment,
                    name: operation.name))
        default: return self
        }
    }

    /// The same screen in `environment` when it is a project's screen that names none; any other as
    /// it is.
    func choosing(_ environment: String) -> Route {
        switch self {
        case .project(_, nil), .releases(_, nil), .operations(.project(_, nil)), .errors(.project(_, nil)),
            .error(.project(_, nil), _), .logs(.project(_, nil)):
            showing(environment, in: project)
        default: self
        }
    }

    /// The screens leading to this one from its project's, this one last: what a link opens. A
    /// screen narrowed to a release comes from the release's.
    public var chain: [Route] {
        switch self {
        case .project: [self]
        case .releases(let key, let environment): [.project(key, environment: environment), self]
        case .component(let key, _): [.project(key), self]
        case .componentReleases(let key, let component):
            [.project(key), .component(project: key, component: component), self]
        case .release(let release): Self.releaseChain(release)
        case .notes(let release): Self.releaseChain(release) + [self]
        case .notesStyle(let key): [.project(key), self]
        case .operations(let telemetry), .errors(let telemetry), .logs(let telemetry):
            Self.chain(of: telemetry) + [self]
        case .operation(let operation):
            Self.chain(of: operation.telemetry) + [.operations(of: operation.telemetry), self]
        case .error(let telemetry, _): Self.chain(of: telemetry) + [.errors(of: telemetry), self]
        }
    }

    // A release comes from its component's screen, where its environments are.
    private static func releaseChain(_ release: ReleaseRef) -> [Route] {
        [
            .project(release.project), .component(project: release.project, component: release.component),
            .release(release),
        ]
    }

    // The screens a list of `telemetry` comes from.
    private static func chain(of telemetry: Telemetry) -> [Route] {
        switch telemetry {
        case .project(let key, let environment): [.project(key, environment: environment)]
        case .release(let release): releaseChain(release)
        }
    }

    /// The screen a link names, `cluenori://projects/notes/errors/4f1c9a2e7b3d5068`; nil for any
    /// other link: `cluenori://projects/<key>`, and under it `/operations`, `/errors`,
    /// `/errors/<id>`, `/logs`, `/releases`, `/notes-style`, `/components/<component>` and its
    /// `/releases`, and `/releases/<component>/<release>`,
    /// under which `/operations`, `/errors`, `/errors/<id>`, and `/logs` are the release's alone, and
    /// `/notes` its notes. Each takes
    /// `?environment=<key>`: the environment a project's screen shows, or, for a release's, the one
    /// its component says it runs in.
    public init?(_ url: URL) {
        guard url.scheme == "cluenori", url.host() == "projects" else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        guard let project = parts.first else { return nil }
        let named = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
            .first { $0.name == "environment" }?.value
        let environment = named?.isEmpty == false ? named : nil
        if parts.count >= 3, parts[1] == "components" {
            switch parts.count {
            case 3: self = .component(project: project, component: parts[2])
            case 4 where parts[3] == "releases": self = .componentReleases(project: project, component: parts[2])
            default: return nil
            }
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
        case (nil, _, .project(let key, let environment)): .project(key, environment: environment)
        case (nil, _, .release(let release)): .release(release)
        case ("operations", 1, _): .operations(of: telemetry)
        case ("errors", 1, _): .errors(of: telemetry)
        case ("errors", 2, _): .error(of: telemetry, id: rest[1])
        case ("logs", 1, _): .logs(of: telemetry)
        case ("releases", 1, .project(let key, let environment)): .releases(project: key, environment: environment)
        case ("notes-style", 1, .project(let key, _)): .notesStyle(project: key)
        case ("notes", 1, .release(let release)): .notes(release)
        default: nil
        }
    }
}

/// Where the app is: which tab shows, and the screens opened in each, the last on top. Views bind
/// to it; links set it.
@Observable
public final class Navigation {
    public enum Tab: Hashable, Sendable {
        case today
        case projects
    }

    public var tab = Tab.today
    public var todayPath: [Route] = []
    public var projectsPath: [Route] = []
    /// How far back every screen looks: one choice, kept across screens and projects, as on the web.
    public var period = PeriodKey.day

    public init() {}

    /// Shows `route`'s screen over the one on top of the tab that shows.
    public func push(_ route: Route) {
        switch tab {
        case .today: todayPath.append(route)
        case .projects: projectsPath.append(route)
        }
    }

    /// Shows `route`'s screen, on the projects tab, over the screens that lead to it.
    public func open(_ route: Route) {
        tab = .projects
        projectsPath = route.chain
    }

    /// Shows `choice`'s project in `environment`, remembered for it: the screens open of the project
    /// that name another environment show this one instead, those of a release keep the release's.
    public func show(_ environment: String, of choice: EnvironmentChoice) {
        choice.choose(environment)
        todayPath = todayPath.map { $0.showing(environment, in: choice.project) }
        projectsPath = projectsPath.map { $0.showing(environment, in: choice.project) }
    }

    /// Shows the screen of `route`, narrowed to a release, without its release, in its place on top
    /// of the tab it shows on; nothing when it isn't narrowed, or isn't on top.
    public func showWithoutRelease(_ route: Route) {
        guard let wider = route.withoutRelease else { return }
        if todayPath.last == route {
            todayPath[todayPath.count - 1] = wider
        } else if projectsPath.last == route {
            projectsPath[projectsPath.count - 1] = wider
        }
    }
}
