import CluenoriClient
import Foundation
import Observation

/// Why a component's version policy wasn't set or cleared.
public enum VersionPolicyProblem: Equatable, Sendable {
    /// Neither a minimum nor a recommended version: a policy names at least one.
    case noVersion
    /// A version that isn't one to four numbers, such as `0.4.0`.
    case notAVersion
    /// A store page that isn't an `https` URL.
    case notAStorePage
    /// The deployment refused it, for its reason: a recommended version below the minimum, a
    /// component the project lacks, or no store page given or found.
    case refused(reason: String)
    /// The deployment didn't answer, as when the phone is offline. Nothing is kept to send later.
    case unreachable
    /// The deployment no longer knows the project.
    case missing
    /// The deployment answered in a way this app doesn't understand.
    case unreadable
}

/// A project's components' version policies: for each component with one, the oldest version its
/// users may keep and the version to offer, where to update, and the project's words; in its
/// production environments, a release below the minimum must update, one below the recommended is
/// offered it. Setting one replaces it, keeping its words; clearing one stops asking any release to
/// update. Each is sent once, never kept to send later; apps read the change within five minutes.
@Observable
public final class VersionPolicyModel {
    /// Where setting or clearing a component's policy stands.
    public enum Change: Equatable, Sendable {
        case sending
        case failed(VersionPolicyProblem)
    }

    public let project: String
    public let policies: Answer<VersionPolicies>
    /// Each component's change being sent, or why the last one failed, by component.
    public private(set) var changes: [String: Change] = [:]

    @ObservationIgnored private let api: CluenoriAPI
    @ObservationIgnored private let keyRejected: () -> Void

    init(project: String, api: CluenoriAPI, context: AnswerContext) {
        self.project = project
        self.api = api
        keyRejected = context.keyRejected
        policies = Answer(
            context,
            .init(key: "projects/\(project)/version-policies") { () async throws(APIError) in
                try await api.versionPolicies(project: project)
            })
    }

    public func load() async {
        await policies.load()
    }

    /// `component`'s policy; nil when it has none, or until the policies arrive.
    public func policy(of component: String) -> ComponentVersionPolicy? {
        policies.value?.policies.first { $0.component == component }
    }

    /// Sets `component`'s policy: its minimum and recommended versions, either left empty for none,
    /// its store page, empty for the one App Store Connect has, and the oldest OS its update runs
    /// on, empty for unknown. Its words stay as they are. True once set, and shown at once.
    public func set(
        _ component: String, minimum: String, recommended: String, storePage: String, minimumOS: String
    ) async -> Bool {
        guard changes[component] != .sending else { return false }
        let fields = [minimum, recommended, storePage, minimumOS].map {
            $0.trimmingCharacters(in: .whitespaces)
        }
        let (minimum, recommended, storePage, minimumOS) = (fields[0], fields[1], fields[2], fields[3])
        guard !minimum.isEmpty || !recommended.isEmpty else {
            changes[component] = .failed(.noVersion)
            return false
        }
        guard [minimum, recommended, minimumOS].allSatisfy({ $0.isEmpty || Self.isStoreVersion($0) }) else {
            changes[component] = .failed(.notAVersion)
            return false
        }
        guard storePage.isEmpty || URL(webPage: storePage) != nil, !storePage.contains(" ") else {
            changes[component] = .failed(.notAStorePage)
            return false
        }
        changes[component] = .sending
        let body = VersionPolicyTo(
            minimum: minimum.isEmpty ? nil : minimum,
            recommended: recommended.isEmpty ? nil : recommended,
            storeUrl: storePage.isEmpty ? nil : storePage,
            minimumOsVersion: minimumOS.isEmpty ? nil : minimumOS,
            // A replace: the words are sent again, so they stay.
            words: policy(of: component)?.words ?? []
        )
        do {
            let policy = try await api.setVersionPolicy(project: project, component: component, body)
            let others = (policies.value?.policies ?? []).filter { $0.component != component }
            policies.show(VersionPolicies(policies: others + [policy]))
            changes[component] = nil
            return true
        } catch {
            fail(component, error)
            return false
        }
    }

    /// Clears `component`'s policy: no release of it is asked to update any more. True once
    /// cleared, and shown at once.
    public func clear(_ component: String) async -> Bool {
        guard changes[component] != .sending else { return false }
        changes[component] = .sending
        do {
            try await api.clearVersionPolicy(project: project, component: component)
            let others = (policies.value?.policies ?? []).filter { $0.component != component }
            policies.show(VersionPolicies(policies: others))
            changes[component] = nil
            return true
        } catch {
            fail(component, error)
            return false
        }
    }

    /// Puts away why `component`'s last change failed, once shown.
    public func dismissProblem(of component: String) {
        if case .failed = changes[component] {
            changes[component] = nil
        }
    }

    private func fail(_ component: String, _ error: APIError) {
        switch error {
        case .unauthorized:
            keyRejected()
            changes[component] = nil
        case .versionPolicyRefused(let refused): changes[component] = .failed(.refused(reason: refused.reason))
        case .unreachable: changes[component] = .failed(.unreachable)
        case .projectNotFound: changes[component] = .failed(.missing)
        default: changes[component] = .failed(.unreadable)
        }
    }

    // A version as a store shows it, as the deployment takes one: one to four numbers, at most 32
    // characters.
    private static func isStoreVersion(_ text: String) -> Bool {
        text.count <= 32 && text.wholeMatch(of: /[0-9]+(\.[0-9]+){0,3}/) != nil
    }
}

/// Why an SDK key wasn't issued or revoked.
public enum SdkKeyProblem: Equatable, Sendable {
    /// The deployment didn't answer, as when the phone is offline. Nothing is kept to send later.
    case unreachable
    /// The deployment no longer knows the project, the component, or the key.
    case missing
    /// The deployment answered in a way this app doesn't understand.
    case unreadable
}

/// One component's SDK keys, which its app's builds carry so its SDK can send the component's
/// signals and read its manifest: the active ones first, newest first, then the revoked ones. A new
/// key is issued while the others stay active, so a new build can carry it while older builds keep
/// working; a revoked key is refused from then on. Each is sent once, never kept to send later.
@Observable
public final class SdkKeysModel {
    /// Where issuing a key, or revoking one, stands.
    public enum Change: Equatable, Sendable {
        case sending
        case failed(SdkKeyProblem)
    }

    public let project: String
    public let component: String
    public let list: Answer<SdkKeyList>
    /// Issuing a key, while it is sent, or why the last one failed; nil otherwise.
    public private(set) var issuing: Change? = nil
    /// Revoking each key, by key.
    public private(set) var revoking: [String: Change] = [:]
    /// The key this phone issued last, while the screen shows it: what it gives feedback on.
    public private(set) var lastIssued: String? = nil

    @ObservationIgnored private let api: CluenoriAPI
    @ObservationIgnored private let keyRejected: () -> Void

    init(project: String, component: String, api: CluenoriAPI, context: AnswerContext) {
        self.project = project
        self.component = component
        self.api = api
        keyRejected = context.keyRejected
        list = Answer(
            context,
            .init(key: "projects/\(project)/components/\(component)/sdk-keys") { () async throws(APIError) in
                try await api.sdkKeys(project: project, component: component)
            })
    }

    public func load() async {
        await list.load()
    }

    /// The keys, the active ones first, then the revoked, each newest first; empty until they arrive.
    public var keys: [IssuedSdkKey] {
        let keys = (list.value?.keys ?? []).sorted { $0.issuedAt > $1.issuedAt }
        return keys.filter { $0.revokedAt == nil } + keys.filter { $0.revokedAt != nil }
    }

    /// Issues a new key, shown at once; the others stay active. True once issued.
    public func issue() async -> Bool {
        guard issuing != .sending else { return false }
        issuing = .sending
        do {
            let key = try await api.issueSdkKey(project: project, component: component)
            list.show(SdkKeyList(keys: [key] + (list.value?.keys ?? []).filter { $0.key != key.key }))
            issuing = nil
            lastIssued = key.key
            return true
        } catch {
            issuing = failure(error)
            return false
        }
    }

    /// Revokes `key`: builds that carry it are refused from then on. Shown at once. True once
    /// revoked, as it was already.
    public func revoke(_ key: String) async -> Bool {
        guard revoking[key] != .sending else { return false }
        revoking[key] = .sending
        do {
            let revoked = try await api.revokeSdkKey(project: project, component: component, key: key)
            list.show(SdkKeyList(keys: (list.value?.keys ?? []).map { $0.key == revoked.key ? revoked : $0 }))
            revoking[key] = nil
            return true
        } catch {
            revoking[key] = failure(error)
            return false
        }
    }

    /// Puts away why the last issue, or a key's revoke, failed, once shown.
    public func dismissProblems() {
        if case .failed = issuing {
            issuing = nil
        }
        revoking = revoking.filter { $0.value == .sending }
    }

    private func failure(_ error: APIError) -> Change? {
        switch error {
        case .unauthorized:
            keyRejected()
            return nil
        case .unreachable: return .failed(.unreachable)
        case .projectNotFound, .componentNotFound, .sdkKeyNotFound: return .failed(.missing)
        default: return .failed(.unreadable)
        }
    }
}
