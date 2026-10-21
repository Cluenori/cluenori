import Foundation

/// An operation of a project, as its screen opens it.
public struct OperationRef: Hashable, Sendable {
    public let project: String
    public let component: String
    /// Absent when the component didn't say.
    public let environment: String?
    public let name: String

    public init(project: String, component: String, environment: String?, name: String) {
        self.project = project
        self.component = component
        self.environment = environment
        self.name = name
    }
}

/// A release of a project's component, as its screen opens it.
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

/// A screen of the paired deployment, which navigation opens by value.
public enum Route: Hashable, Sendable {
    case project(String)
    case operations(project: String)
    case operation(OperationRef)
    case errors(project: String)
    case error(project: String, id: String)
    case logs(project: String)
    case releases(project: String)
    case release(ReleaseRef)

    /// The project the screen is of.
    public var project: String {
        switch self {
        case .project(let key), .operations(let key), .errors(let key), .logs(let key), .releases(let key): key
        case .operation(let operation): operation.project
        case .error(let project, _): project
        case .release(let release): release.project
        }
    }

    /// The screens leading to this one from its project's, this one last: what a link opens.
    public var chain: [Route] {
        switch self {
        case .project: [self]
        case .operations, .errors, .logs, .releases: [.project(project), self]
        case .operation: [.project(project), .operations(project: project), self]
        case .error: [.project(project), .errors(project: project), self]
        case .release: [.project(project), .releases(project: project), self]
        }
    }

    /// The screen a link names, `cluenori://projects/notes/errors/4f1c9a2e7b3d5068`; nil for any
    /// other link: `cluenori://projects/<key>`, and under it `/operations`, `/errors`,
    /// `/errors/<id>`, `/logs`, `/releases`, or `/releases/<component>/<release>`, with
    /// `?environment=<key>` for a component that says where it runs.
    public init?(_ url: URL) {
        guard url.scheme == "cluenori", url.host() == "projects" else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        switch parts.count {
        case 1:
            self = .project(parts[0])
        case 2 where parts[1] == "operations":
            self = .operations(project: parts[0])
        case 2 where parts[1] == "errors":
            self = .errors(project: parts[0])
        case 2 where parts[1] == "logs":
            self = .logs(project: parts[0])
        case 2 where parts[1] == "releases":
            self = .releases(project: parts[0])
        case 3 where parts[1] == "errors":
            self = .error(project: parts[0], id: parts[2])
        case 4 where parts[1] == "releases":
            let environment = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?
                .first { $0.name == "environment" }?.value
            self = .release(
                ReleaseRef(
                    project: parts[0],
                    component: parts[2],
                    environment: environment?.isEmpty == false ? environment : nil,
                    version: parts[3]
                )
            )
        default:
            return nil
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

    /// Shows `route`'s screen, on the projects tab, over the screens that lead to it.
    public func open(_ route: Route) {
        tab = .projects
        projectsPath = route.chain
    }
}
