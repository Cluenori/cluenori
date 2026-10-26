import CluenoriClient
import Foundation
import Observation

/// What can go to an environment next, named in full: what goes, from where, and where to, as its
/// button says it.
public enum DeliveryStep: Hashable, Sendable {
    /// Promote `release`, the one in `from` now, to `to`.
    case promote(release: String, from: String, to: String)
    /// Build the default branch's newest commit and deploy it to `to`, the first environment; a
    /// commit not built before becomes `release`, the component's next, nil until its version is set.
    case buildLatest(to: String, release: String?)
    /// A step of a kind this app doesn't know, from a newer API, to `to`.
    case unknown(to: String)

    /// Where it goes.
    public var environment: String {
        switch self {
        case .promote(_, _, let to), .buildLatest(let to, _), .unknown(let to): to
        }
    }
}

/// One of a component's environments, as its delivery shows it: whether the project calls it
/// production, how releases get there, the release there now and since when, a promotion to it that
/// hasn't ended or the last one that failed, and the one next step.
public struct DeliveryStage: Hashable, Sendable, Identifiable {
    public let environment: String
    public let isProduction: Bool
    /// Its deploy target; nil for an environment the component ran in without one, where nothing
    /// can be done.
    public let target: DeployTarget?
    /// Nil until a release reaches it.
    public let current: CurrentRelease?
    /// A promotion to it that hasn't ended; while there is one, there is no next step.
    public let promotion: Promotion?
    /// The latest promotion to it, when it ended failed, cancelled, rejected, or lost, and nothing
    /// reached the environment since it started; nil while another is under way. Its next step is
    /// offered again.
    public let failed: Promotion?
    public let next: DeliveryStep?

    public init(
        environment: String,
        isProduction: Bool,
        target: DeployTarget? = nil,
        current: CurrentRelease? = nil,
        promotion: Promotion? = nil,
        failed: Promotion? = nil,
        next: DeliveryStep? = nil
    ) {
        self.environment = environment
        self.isProduction = isProduction
        self.target = target
        self.current = current
        self.promotion = promotion
        self.failed = failed
        self.next = next
    }

    public var id: String {
        environment
    }
}

/// A component that ships with another, as that one shows it: its key and its name.
public struct ShippedPart: Hashable, Sendable, Identifiable {
    public let component: String
    public let name: String

    public var id: String {
        component
    }
}

/// A component as its delivery shows it: its name, the component it ships with or those that ship
/// with it, its version, and its environments in the order its releases go through them.
public struct ComponentStages: Hashable, Sendable, Identifiable {
    public let component: String
    public let name: String
    /// The component whose deploys deploy this one too, by key; it has nothing to do of its own.
    public let shipsWith: String?
    /// The components that ship with this one, in the project's order.
    public let parts: [ShippedPart]
    /// Nil until a member sets it, and until then its builds can't be numbered.
    public let version: ComponentVersion?
    public let stages: [DeliveryStage]

    public var id: String {
        component
    }

    /// The release its next new commit becomes: `1.4.0+58`; nil without a version.
    public var nextRelease: String? {
        version.map { "\($0.version)+\($0.lastBuild + 1)" }
    }

    /// Whether any of its environments has a deploy target, so its releases can be promoted.
    public var hasDeployTargets: Bool {
        stages.contains { $0.target != nil }
    }

    /// The promotions under way to its environments, in their order.
    public var promotions: [Promotion] {
        stages.compactMap(\.promotion)
    }
}

/// A project's delivery at a glance, across the components that ship on their own: how many
/// promotions are under way, how many ended without their release getting there, how many releases
/// are ready for their next environment, and the release that reached production last.
public struct DeliveryOverview: Equatable, Sendable {
    public struct Latest: Equatable, Sendable {
        /// The component's name.
        public let component: String
        public let release: String
        public let since: Date
    }

    /// Nil when no release is in a production environment.
    public let latestInProduction: Latest?
}

/// Where one release of a component is now, from its component's delivery: the environments it is
/// in and since when, those it hasn't reached yet, its promotions under way, the one step that moves
/// it on, and deploying it anywhere else.
public struct ReleasePlaces: Hashable, Sendable {
    /// An environment the release is in now.
    public struct Here: Hashable, Sendable {
        public let environment: String
        public let since: Date
        public let isProduction: Bool
    }

    /// Deploying the release to an environment it isn't in, outside the usual order: what it would
    /// replace, and whether that rolls the environment back.
    public struct OtherDeploy: Hashable, Sendable, Identifiable {
        public let environment: String
        public let isProduction: Bool
        /// The release there now, which it replaces; nil when none is there.
        public let replacing: CurrentRelease?
        /// Whether it is older than the release there, so deploying it rolls the environment back;
        /// false when nothing is there, or when which is older can't be told.
        public let isRollback: Bool

        public var id: String {
            environment
        }
    }

    /// In the order of its component's environments.
    public let here: [Here]
    /// The environments after the last it is in that it hasn't reached and isn't older than the
    /// release there, in order: where it can still go.
    public let notYet: [String]
    /// Its promotions under way, in the order of their environments.
    public let promoting: [Promotion]
    /// The step that promotes it to the next environment, when its delivery says it is next there.
    public let next: DeliveryStep?
    /// Each other environment with a deploy target where it isn't, isn't being promoted, and isn't
    /// `next`'s, in order.
    public let otherDeploys: [OtherDeploy]
}

/// How a project's components' releases reach their environments: for each component, its
/// environments in its deploy targets' order, each with the release there now and since when, a
/// promotion under way, and the one next step; and promoting by that step, as its sheet does. Shown
/// at once from the phone and asked again; a promotion started from this phone shows at once, and,
/// while one hasn't ended, `followPromotions` asks again.
@Observable
public final class DeliveryModel {
    public let project: String
    public let answer: Answer<Delivery>
    /// Promoting by a component's next step, while its sheet is open; nil otherwise.
    public private(set) var promote: PromoteModel? = nil
    /// The last promotion started from this phone by `promote`, or by one of the project's
    /// releases: what a screen gives feedback on.
    public private(set) var lastStarted: Promotion? = nil

    // The promotions this phone started, by component and environment, and when: each shows in
    // place of the delivery's until the delivery is asked again.
    private var started: [String: (promotion: Promotion, at: Date)] = [:]
    @ObservationIgnored private let detail: Answer<ProjectDetail>
    @ObservationIgnored private let api: CluenoriAPI
    @ObservationIgnored private let keyRejected: () -> Void
    @ObservationIgnored private let startedElsewhere: (Promotion) -> Void

    /// `detail` is the project's, with its components' names, links and production environments;
    /// `startedElsewhere` hears of each promotion this model starts, for the release's screen.
    init(
        project: String,
        detail: Answer<ProjectDetail>,
        api: CluenoriAPI,
        context: AnswerContext,
        startedElsewhere: @escaping (Promotion) -> Void
    ) {
        self.project = project
        self.detail = detail
        self.api = api
        self.startedElsewhere = startedElsewhere
        keyRejected = context.keyRejected
        answer = Answer(
            context,
            .init(key: "projects/\(project)/delivery") { () async throws(APIError) in
                try await api.delivery(project: project)
            })
    }

    /// Each component in the project's order, each that ships with another right after it. Empty
    /// until the delivery arrives.
    public var components: [ComponentStages] {
        guard let delivery = answer.value else { return [] }
        let all = delivery.components.map(stages)
        let keys = Set(all.map(\.component))
        // A part whose component the delivery doesn't list stands on its own.
        let roots = all.filter { $0.shipsWith.map { !keys.contains($0) } ?? true }
        return roots.flatMap { root in [root] + all.filter { $0.shipsWith == root.component } }
    }

    /// One component's delivery; nil until the delivery arrives, or for one it doesn't list.
    public func component(_ key: String) -> ComponentStages? {
        answer.value?.components.first { $0.component == key }.map(stages)
    }

    /// What people call `component`: its name, from the project; its key until the project says.
    public func name(of component: String) -> String {
        detail.value?.components.first { $0.key == component }?.name ?? component
    }

    /// What Releases' line says when no release needs a member; nil until the delivery arrives.
    public var overview: DeliveryOverview? {
        guard answer.value != nil else { return nil }
        let own = components.filter { $0.shipsWith == nil }
        let stages = own.flatMap { component in component.stages.map { (component: component, stage: $0) } }
        let latest =
            stages
            .filter { $0.stage.isProduction }
            .compactMap { pair in pair.stage.current.map { (component: pair.component.name, current: $0) } }
            .max { $0.current.since < $1.current.since }
        return DeliveryOverview(
            latestInProduction: latest.map {
                DeliveryOverview.Latest(
                    component: $0.component, release: $0.current.summary.release, since: $0.current.since)
            }
        )
    }

    /// Whether a promotion this delivery shows hasn't ended, so `followPromotions` asks again.
    public var hasUnendedPromotions: Bool {
        components.contains { !$0.promotions.isEmpty }
    }

    /// Asks for the delivery again.
    public func load() async {
        await answer.load()
    }

    /// Asks for the delivery again every `interval` while a promotion it shows hasn't ended, so
    /// each shows where it is, and one that ends, where it left its environment: the release it
    /// brought, or it as the one that failed. Returns once every one has ended, or when the task
    /// running it is cancelled, as when its screen leaves.
    public func followPromotions(every interval: Duration = .seconds(15)) async {
        while hasUnendedPromotions {
            do {
                try await Task.sleep(for: interval)
            } catch {
                return
            }
            await load()
        }
    }

    /// Opens the sheet that takes `step` for `component`: promoting a release by the deploy target
    /// of the environment it goes to, or building the newest commit for the first. Nothing for a
    /// step the delivery doesn't offer now, or one this app doesn't know.
    public func start(_ step: DeliveryStep, of component: String) {
        guard let stages = self.component(component),
            let stage = stages.stages.first(where: { $0.environment == step.environment && $0.next == step }),
            let target = stage.target
        else { return }
        let subject: PromoteModel.Subject
        switch step {
        case .promote(let release, let from, _):
            subject = .release(ReleaseRef(project: project, component: component, environment: from, version: release))
        case .buildLatest:
            subject = .latestCommit(project: project, component: component)
        case .unknown:
            return
        }
        promote = PromoteModel(
            subject: subject,
            targets: [target],
            target: target,
            repository: detail.value?.components.first { $0.key == component }?.repository,
            replacing: stage.current.map { PromoteModel.Replacing(release: $0.summary.release, since: $0.since) },
            api: api,
            keyRejected: keyRejected
        ) { [weak self] promotion in
            self?.promote = nil
            self?.show(started: promotion)
            self?.startedElsewhere(promotion)
        }
    }

    /// Closes the sheet, unless it's sending.
    public func cancelPromoting() {
        guard promote?.state != .sending else { return }
        promote = nil
    }

    /// Shows `promotion` at once, started from this phone, until the delivery is asked again.
    func show(started promotion: Promotion) {
        let key = Self.key(promotion.component, promotion.environment)
        started[key] = (promotion, .now)
        lastStarted = promotion
    }

    /// Where `release` of `component` is now, with `summary`, its own, saying how old it is; nil until
    /// the delivery arrives, or for a component it doesn't list.
    public func places(of release: String, component: String, summary: ReleaseSummary?) -> ReleasePlaces? {
        guard let stages = self.component(component)?.stages else { return nil }
        let isHere = { (stage: DeliveryStage) in stage.current?.summary.release == release }
        let here = stages.filter(isHere).compactMap { stage in
            stage.current.map {
                ReleasePlaces.Here(environment: stage.environment, since: $0.since, isProduction: stage.isProduction)
            }
        }
        let promoting = stages.compactMap(\.promotion).filter { $0.release == release }
        let next = stages.lazy.compactMap { stage -> DeliveryStep? in
            guard case .promote(release, _, _) = stage.next else { return nil }
            return stage.next
        }.first
        // Whether `release` is older than the one in `stage`, when that can be told.
        let isOlder = { (stage: DeliveryStage) -> Bool in
            guard let current = stage.current?.summary else { return false }
            return Self.isOlder(release, summary, than: current) ?? false
        }
        let lastHere = stages.lastIndex(where: isHere) ?? -1
        let notYet = stages.enumerated().filter { index, stage in
            index > lastHere && !isHere(stage) && !isOlder(stage)
        }.map(\.element.environment)
        let otherDeploys = stages.filter { stage in
            stage.target != nil && !isHere(stage) && stage.environment != next?.environment
                && !promoting.contains { $0.environment == stage.environment }
        }.map { stage in
            ReleasePlaces.OtherDeploy(
                environment: stage.environment, isProduction: stage.isProduction, replacing: stage.current,
                isRollback: isOlder(stage))
        }
        return ReleasePlaces(
            here: here, notYet: notYet, promoting: promoting, next: next, otherDeploys: otherDeploys)
    }

    /// Whether release `version`, with its summary when known, is older than `other`: by their
    /// numbers when Cluenori numbered both, `1.4.0+57` before `1.4.0+58`, since versions only go up
    /// and build numbers never go back; else by their commits' times when both are known; nil when
    /// neither tells.
    static func isOlder(_ version: String, _ summary: ReleaseSummary?, than other: ReleaseSummary) -> Bool? {
        if let mine = number(version), let theirs = number(other.release) {
            return mine.lexicographicallyPrecedes(theirs)
        }
        if let mine = summary?.commit?.committedAt, let theirs = other.commit?.committedAt, mine != theirs {
            return mine < theirs
        }
        return nil
    }

    // A release Cluenori numbered, `MAJOR.MINOR.PATCH+BUILD`, as its parts; nil for another name.
    private static func number(_ release: String) -> [Int]? {
        guard let match = release.wholeMatch(of: /([0-9]+)\.([0-9]+)\.([0-9]+)\+([0-9]+)/) else { return nil }
        let parts = [match.1, match.2, match.3, match.4].compactMap { Int($0) }
        return parts.count == 4 ? parts : nil
    }

    private static func key(_ component: String, _ environment: String) -> String {
        "\(component)\u{0}\(environment)"
    }

    // A component's delivery as its screens show it: each environment with the promotion this phone
    // started there, until the delivery is asked again, in place of the delivery's.
    private func stages(_ delivery: ComponentDelivery) -> ComponentStages {
        let components = detail.value?.components ?? []
        let production = detail.value?.settings?.productionEnvironments ?? []
        let asOf = answer.receivedAt ?? .distantPast
        let version = delivery.version
        let nextRelease = version.map { "\($0.version)+\($0.lastBuild + 1)" }
        let stages = delivery.environments.map { environment in
            let key = Self.key(delivery.component, environment.environment)
            let mine = started[key].flatMap { asOf <= $0.at ? $0.promotion : nil }
            let promotion = mine ?? environment.promotion
            return DeliveryStage(
                environment: environment.environment,
                isProduction: production.contains(environment.environment),
                target: environment.target,
                current: environment.current,
                promotion: promotion,
                failed: promotion == nil ? environment.failedPromotion : nil,
                next: promotion == nil
                    ? environment.next.map { step(of: $0, to: environment.environment, nextRelease) } : nil
            )
        }
        let parts = (answer.value?.components ?? []).filter { $0.shipsWith == delivery.component }.map { part in
            ShippedPart(
                component: part.component,
                name: components.first { $0.key == part.component }?.name ?? part.component)
        }
        return ComponentStages(
            component: delivery.component,
            name: components.first { $0.key == delivery.component }?.name ?? delivery.component,
            shipsWith: delivery.shipsWith,
            parts: parts,
            version: version,
            stages: stages
        )
    }

    private func step(of next: NextStep, to environment: String, _ nextRelease: String?) -> DeliveryStep {
        switch next {
        case .promote(let promote): .promote(release: promote.release, from: promote.from, to: environment)
        case .buildLatest: .buildLatest(to: environment, release: nextRelease)
        case .unknown: .unknown(to: environment)
        }
    }
}
