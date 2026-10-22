import CluenoriClient
import Foundation
import Observation

/// One of a project's components as its versions show: the version its next builds are numbered
/// in, and the last build number given.
public struct VersionLine: Equatable, Sendable, Identifiable {
    /// The component's key.
    public let component: String
    public let name: String
    /// `MAJOR.MINOR.PATCH`, such as `1.4.0`; nil until a member sets it, and until then its CI
    /// can't number builds.
    public let version: String?
    /// 0 before the first build.
    public let lastBuild: Int?
    /// Whether the component has a deploy target with a workflow, which can build and promote its
    /// newest commit.
    public let canPromoteLatest: Bool

    public init(component: String, name: String, version: String?, lastBuild: Int?, canPromoteLatest: Bool = false) {
        self.component = component
        self.name = name
        self.version = version
        self.lastBuild = lastBuild
        self.canPromoteLatest = canPromoteLatest
    }

    public var id: String {
        component
    }

    /// The release the component's next new commit becomes: `1.4.0+58`; nil without a version.
    public var nextRelease: String? {
        version.map { "\($0)+\((lastBuild ?? 0) + 1)" }
    }
}

/// Which part of a version a bump raises: `1.4.2` becomes `1.4.3`, `1.5.0`, or `2.0.0`.
public enum VersionBump: CaseIterable, Sendable {
    case patch
    case minor
    case major
}

/// Why a component's version wasn't set.
public enum VersionProblem: Equatable, Sendable {
    /// Not `MAJOR.MINOR.PATCH`, each part from 0 to 999999 without leading zeros.
    case notAVersion
    /// A first build number is a whole number from 1 to 999999999.
    case notABuildNumber
    /// The deployment refused it, for its reason: lower than the current version, or a first build
    /// at or below the last given.
    case refused(reason: String)
    /// The deployment didn't answer, as when the phone is offline. Nothing is kept to send later.
    case unreachable
    /// The deployment no longer knows the project.
    case missing
    /// The deployment answered in a way this app doesn't understand.
    case unreadable
}

/// A project's components' versions, which Cluenori numbers every build in: each with its next
/// release, bumped or set by a member, and promoting a component's newest commit, which numbers it.
/// A version never goes lower, so a bump can't be undone; build numbers continue across versions.
@Observable
public final class VersionsModel {
    /// Where setting one component's version stands.
    public enum Change: Equatable, Sendable {
        case sending
        case failed(VersionProblem)
    }

    public let project: String
    public let list: Answer<ComponentVersions>
    /// Each component's change being sent, or why the last one failed, by component.
    public private(set) var changes: [String: Change] = [:]
    /// Promoting a component's newest commit, while its sheet is open; nil otherwise.
    public private(set) var promoteLatest: PromoteModel? = nil

    @ObservationIgnored private let projectDetail: Answer<ProjectDetail>
    @ObservationIgnored private let api: CluenoriAPI
    @ObservationIgnored private let keyRejected: () -> Void
    @ObservationIgnored private let started: (Promotion) -> Void

    /// `projectDetail` is the project's, which lists its components; `started` hears of each
    /// promotion of a commit that starts.
    init(
        project: String, projectDetail: Answer<ProjectDetail>, api: CluenoriAPI, context: AnswerContext,
        started: @escaping (Promotion) -> Void
    ) {
        self.project = project
        self.projectDetail = projectDetail
        self.api = api
        self.started = started
        keyRejected = context.keyRejected
        list = Answer(
            context,
            .init(key: "projects/\(project)/versions") { () async throws(APIError) in
                try await api.versions(project: project)
            })
    }

    /// Each of the project's components, in its order, with its version when set; then any whose
    /// version is set that the project's components, not yet asked, don't list. Empty until the
    /// versions arrive.
    public var lines: [VersionLine] {
        guard let versions = list.value?.versions else { return [] }
        let components = projectDetail.value?.components ?? []
        let listed = components.map { component in
            let line = versions.first { $0.component == component.key }
            return VersionLine(
                component: component.key, name: component.name, version: line?.version, lastBuild: line?.lastBuild,
                canPromoteLatest: !Self.workflowTargets(component).isEmpty)
        }
        let unlisted = versions.filter { line in !components.contains { $0.key == line.component } }.map {
            VersionLine(component: $0.component, name: $0.component, version: $0.version, lastBuild: $0.lastBuild)
        }
        return listed + unlisted
    }

    /// Asks for the versions again.
    public func load() async {
        await list.load()
    }

    /// The version `bump` makes of `version`: `1.4.2` becomes `1.4.3`, `1.5.0`, or `2.0.0`; nil
    /// for one that isn't `MAJOR.MINOR.PATCH`, or a part past 999999.
    public static func next(after version: String, _ bump: VersionBump) -> String? {
        guard let (major, minor, patch) = parts(version) else { return nil }
        let next =
            switch bump {
            case .patch: "\(major).\(minor).\(patch + 1)"
            case .minor: "\(major).\(minor + 1).0"
            case .major: "\(major + 1).0.0"
            }
        return parts(next) == nil ? nil : next
    }

    /// Raises `component`'s version by `bump`, its build numbers continuing. True once set.
    public func bump(_ component: String, _ bump: VersionBump) async -> Bool {
        guard let version = lines.first(where: { $0.component == component })?.version,
            let next = Self.next(after: version, bump)
        else {
            changes[component] = .failed(.notAVersion)
            return false
        }
        return await send(component, VersionTo(version: next))
    }

    /// Sets `component`'s version, the same or higher than now, and, when `firstBuild` isn't empty,
    /// where its build numbers continue from, above the last given. True once set.
    public func set(_ component: String, version: String, firstBuild: String) async -> Bool {
        let version = version.trimmingCharacters(in: .whitespaces)
        guard Self.parts(version) != nil else {
            changes[component] = .failed(.notAVersion)
            return false
        }
        let build = firstBuild.trimmingCharacters(in: .whitespaces)
        var first: Int? = nil
        if !build.isEmpty {
            guard let number = Int(build), (1...999_999_999).contains(number) else {
                changes[component] = .failed(.notABuildNumber)
                return false
            }
            first = number
        }
        return await send(component, VersionTo(version: version, firstBuild: first))
    }

    /// Opens the sheet that promotes `component`'s newest commit, or another, by one of its deploy
    /// targets with a workflow, the first at first. Nothing for a component without one.
    public func startPromotingLatest(_ component: String) {
        guard let found = projectDetail.value?.components.first(where: { $0.key == component }) else { return }
        let targets = Self.workflowTargets(found)
        guard let first = targets.first else { return }
        promoteLatest = PromoteModel(
            subject: .latestCommit(project: project, component: component),
            targets: targets,
            target: first,
            repository: found.repository,
            api: api,
            keyRejected: keyRejected
        ) { [weak self] promotion in
            self?.promoteLatest = nil
            self?.started(promotion)
        }
    }

    /// Closes the sheet, unless it's sending.
    public func cancelPromotingLatest() {
        guard promoteLatest?.state != .sending else { return }
        promoteLatest = nil
    }

    /// Puts away why `component`'s last change failed, once shown.
    public func dismissProblem(of component: String) {
        if case .failed = changes[component] {
            changes[component] = nil
        }
    }

    private func send(_ component: String, _ body: VersionTo) async -> Bool {
        guard changes[component] != .sending else { return false }
        changes[component] = .sending
        do {
            let line = try await api.setVersion(project: project, component: component, body)
            var versions = list.value?.versions ?? []
            if let index = versions.firstIndex(where: { $0.component == line.component }) {
                versions[index] = line
            } else {
                versions.append(line)
            }
            list.show(ComponentVersions(versions: versions))
            changes[component] = nil
            return true
        } catch {
            switch error {
            case .unauthorized:
                keyRejected()
                changes[component] = nil
            case .versionRefused(let refused): changes[component] = .failed(.refused(reason: refused.reason))
            case .unreachable: changes[component] = .failed(.unreachable)
            case .projectNotFound: changes[component] = .failed(.missing)
            default: changes[component] = .failed(.unreadable)
            }
            return false
        }
    }

    // A component's deploy targets that have a workflow, which builds a commit.
    private static func workflowTargets(_ component: Component) -> [DeployTarget] {
        (component.deployTargets ?? []).filter { $0.workflow != nil }
    }

    // A version's parts, when it is `MAJOR.MINOR.PATCH` as the deployment takes it: ASCII digits,
    // without leading zeros, each at most 999999.
    private static func parts(_ version: String) -> (Int, Int, Int)? {
        guard let match = version.wholeMatch(of: /(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})/),
            let major = Int(match.1), let minor = Int(match.2), let patch = Int(match.3)
        else {
            return nil
        }
        return (major, minor, patch)
    }
}
