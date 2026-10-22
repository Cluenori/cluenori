import CluenoriClient
import Foundation
import Observation

/// The releases of a project in one environment that ran, were deployed, or were uploaded over a
/// period, the latest first, at most 30: each with its verdict against the release before it of the
/// same component and environment, and its commit, store build, and deploy when known; and the
/// sources that couldn't be read lately, so a missing commit or build isn't taken for none. Narrowed
/// to an environment, a release that names none, as a build only App Store Connect knows, isn't
/// listed: the deployment matches environments exactly.
@Observable
public final class ReleasesModel {
    public let project: String
    /// The environment it shows; nil for every environment, from a deployment that doesn't tell them
    /// apart.
    public let environment: String?
    public let period: PeriodKey
    public let list: Answer<ReleaseList>

    init(project: String, environment: String?, period: PeriodKey, api: CluenoriAPI, context: AnswerContext) {
        self.project = project
        self.environment = environment
        self.period = period
        list = Answer(context, Self.question(api, .project(project, environment: environment), period))
    }

    /// The question of the releases over `period`, which the project's overview asks too, so each
    /// shows what the other kept.
    static func question(_ api: CluenoriAPI, _ telemetry: Telemetry, _ period: PeriodKey)
        -> Answer<ReleaseList>.Question
    {
        .init(key: "\(telemetry.key)/releases/\(period.rawValue)") { () async throws(APIError) in
            let (from, to) = period.endingNow
            return try await api.releases(
                project: telemetry.project, from: from, to: to, environment: telemetry.environment)
        }
    }
}

/// One release compared with the one before it: the operations that got slower or fail more, the
/// errors first seen in it, the incidents that opened while it ran, and what got better; its commit,
/// what changed since the release before, and its store build, when known, and the sources that
/// couldn't be read lately for its component; its promotions, followed while any hasn't ended,
/// promoting it by a deploy target, and releasing one App Store review approved; and its notes for
/// its users. It is the whole release, whatever the period. Fails with `missing` for a release the
/// project doesn't know: none of its operations ran, no deploy or build of it was reported, or it
/// was too long ago.
@Observable
public final class ReleaseModel {
    /// Where releasing a promotion App Store review approved stands, until its answer, which shows
    /// the promotion `releasing`.
    public enum ReleaseNow: Equatable, Sendable {
        case sending
        case failed(PromotionProblem)
    }

    public let release: ReleaseRef
    public let detail: Answer<ReleaseDetail>
    /// Its notes for its users, as its notes screen edits them, and as the promote sheet opens them.
    public let notes: NotesModel
    /// Promoting the release to an environment, while its sheet is open; nil otherwise.
    public private(set) var promote: PromoteModel? = nil
    /// Releasing approved promotions from this phone, by promotion ID.
    public private(set) var releasingNow: [String: ReleaseNow] = [:]

    // The promotions as this phone's last action on each answered them, and when: started, or
    // released. Each shows in place of the detail's until the release is asked again, and while the
    // detail doesn't list it.
    private var answered: [String: (promotion: Promotion, at: Date)] = [:]
    @ObservationIgnored private let api: CluenoriAPI
    @ObservationIgnored private let member: Answer<Member>
    @ObservationIgnored private let keyRejected: () -> Void

    /// `member` is the member the phone acts for, shared by every release.
    init(release: ReleaseRef, api: CluenoriAPI, context: AnswerContext, member: Answer<Member>) {
        self.release = release
        self.api = api
        self.member = member
        keyRejected = context.keyRejected
        detail = Answer(
            context,
            .init(
                key:
                    "projects/\(release.project)/release/\(release.component)/\(release.environment ?? "")/\(release.version)"
            ) { () async throws(APIError) in
                try await api.release(
                    project: release.project,
                    component: release.component,
                    release: release.version,
                    environment: release.environment
                )
            })
        notes = NotesModel(release: release, detail: detail, api: api, keyRejected: context.keyRejected)
    }

    // How long a detail's span is good for: a release still running moves its last minute on.
    private static let spanKeptFor: TimeInterval = 60

    /// The release's span, as screens narrowed to it look: from its detail, asked again unless it
    /// arrived in the last minute. Fails as asking for its detail does.
    func span() async throws(APIError) -> (from: Date, to: Date) {
        let summary: ReleaseSummary
        if let kept = detail.value, let receivedAt = detail.receivedAt,
            Date.now.timeIntervalSince(receivedAt) < Self.spanKeptFor
        {
            summary = kept.summary
        } else {
            summary = try await detail.answer().summary
        }
        // Not handled: a release with no time at all, which the deployment doesn't list.
        guard let span = summary.span else {
            throw .unreadable(status: 200, reason: "A release without a time it ran, was deployed, or was uploaded")
        }
        return span.bounds(now: .now)
    }

    /// Asks for the detail again; and, while the app doesn't know which member the phone acts for
    /// and a promotion says who started it, asks that too, once the deployment answers.
    public func refresh() async {
        await detail.load()
        if member.value == nil, promotions.contains(where: { $0.startedBy != nil }) {
            await member.load()
        }
    }

    /// Its promotions, to every environment, the latest first: the detail's, each as this phone's
    /// action on it answered until the release is asked again, and those this phone started that the
    /// detail doesn't list yet. Empty until the detail arrives.
    public var promotions: [Promotion] {
        let listed = detail.value?.promotions ?? []
        let asOf = detail.receivedAt ?? .distantPast
        let shown = listed.map { promotion in
            guard let answer = answered[promotion.id], asOf <= answer.at else { return promotion }
            return answer.promotion
        }
        let ids = Set(listed.map(\.id))
        let unlisted = answered.values.map(\.promotion).filter { !ids.contains($0.id) }
        guard !unlisted.isEmpty else { return shown }
        return (unlisted + shown).sorted { ($0.startedAt, $0.id) > ($1.startedAt, $1.id) }
    }

    /// Where it can be promoted, its component's deploy targets: an environment, and its workflow,
    /// App Store Connect app, or both; none until the detail arrives.
    public var deployTargets: [DeployTarget] {
        detail.value?.deployTargets ?? []
    }

    /// Whether a promotion it shows hasn't ended, so `followPromotions` asks again.
    public var hasUnendedPromotions: Bool {
        promotions.contains { !$0.hasEnded }
    }

    /// Whether the member this phone acts for started `promotion`; false for another member's, an
    /// agent's or a process's, and while the app doesn't know which member it acts for.
    public func isYours(_ promotion: Promotion) -> Bool {
        guard let startedBy = promotion.startedBy, let you = member.value?.id else { return false }
        return startedBy == you
    }

    /// Asks for the detail again every `interval` while a promotion it shows hasn't ended, so each
    /// shows where its run is; the deployment looks at GitHub each minute. Returns once every one
    /// has ended, or when the task running it is cancelled, as when its screen leaves. Offline, it
    /// keeps what it showed, as `load` does, and asks again.
    public func followPromotions(every interval: Duration = .seconds(15)) async {
        while hasUnendedPromotions {
            do {
                try await Task.sleep(for: interval)
            } catch {
                return
            }
            await detail.load()
        }
    }

    /// Opens the sheet that promotes the release by `target`, to its environment.
    public func startPromoting(_ target: DeployTarget) {
        promote = PromoteModel(
            release: release,
            target: target,
            repository: detail.value?.repository,
            api: api,
            keyRejected: keyRejected
        ) { [weak self] promotion in
            self?.answered[promotion.id] = (promotion, .now)
            self?.promote = nil
        }
    }

    /// Closes the sheet, unless it's sending: a promotion sent may start, and the sheet says
    /// whether it did.
    public func cancelPromoting() {
        guard promote?.state != .sending else { return }
        promote = nil
    }

    /// Releases `promotion`, approved in App Store review and waiting for a member: App Store
    /// Connect makes it live. Its answer shows at once, `releasing`, as every client sees it, until
    /// the deployment sees it live and it succeeds. Nothing for a promotion that isn't approved, or
    /// is being released already, as the release shows it now. When it isn't waiting any more, the
    /// release is asked again.
    public func releaseNow(_ promotion: Promotion) async {
        guard promotions.first(where: { $0.id == promotion.id })?.state == .approved,
            releasingNow[promotion.id] != .sending
        else { return }
        releasingNow[promotion.id] = .sending
        do {
            let releasing = try await api.releaseApproved(project: release.project, promotion: promotion.id)
            answered[releasing.id] = (releasing, .now)
            releasingNow[promotion.id] = nil
        } catch .unauthorized {
            keyRejected()
            releasingNow[promotion.id] = nil
        } catch {
            let problem = PromotionProblem.of(error)
            releasingNow[promotion.id] = .failed(problem)
            if problem == .notWaitingForRelease {
                await detail.load()
            }
        }
    }
}

/// When a release ran, as screens narrowed to it look: from its first minute to its last; without
/// telemetry, from its deploy, else its upload, until now.
public struct ReleaseSpan: Hashable, Sendable {
    public let from: Date
    /// Nil: until now.
    public let to: Date?

    public init(from: Date, to: Date?) {
        self.from = from
        self.to = to
    }

    /// The from and to a question asks, `to` at least a minute after `from`, so a deploy the phone's
    /// clock puts ahead of it is still a period the deployment takes.
    func bounds(now: Date) -> (from: Date, to: Date) {
        (from, max(to ?? now, from.addingTimeInterval(60)))
    }
}

extension ReleaseSummary {
    /// When it ran, as screens narrowed to it look: its telemetry's first minute to its last, or
    /// from its deploy, else its upload, until now; nil for a release with none of them.
    public var span: ReleaseSpan? {
        if let firstSeen, let lastSeen {
            return ReleaseSpan(from: min(firstSeen, lastSeen), to: max(firstSeen, lastSeen))
        }
        return (deployedAt ?? store?.uploadedAt).map { ReleaseSpan(from: $0, to: nil) }
    }

    /// The release, as its screen opens it and as a project's operations, errors, and logs narrow
    /// to it: where it ran, when it says.
    public func ref(in project: String) -> ReleaseRef {
        ReleaseRef(project: project, component: component, environment: environment, version: release)
    }
}

extension ReleaseCommit {
    /// What names the commit to people: its tag, else its short SHA.
    public var name: String {
        tag ?? shortSha
    }

    /// Its SHA's first 7 characters, as GitHub shows it.
    public var shortSha: String {
        CluenoriScreens.shortSha(sha)
    }
}

extension ChangedCommit {
    /// Its SHA's first 7 characters, as GitHub shows it.
    public var shortSha: String {
        CluenoriScreens.shortSha(sha)
    }
}

private func shortSha(_ sha: String) -> String {
    String(sha.prefix(7))
}

extension URL {
    /// A page on the web that an answer links to, such as a commit's on GitHub: only `https`, so a
    /// link can't open another app or run script; nil for anything else.
    public init?(webPage text: String) {
        guard let url = URL(string: text), url.scheme?.lowercased() == "https", url.host()?.isEmpty == false else {
            return nil
        }
        self = url
    }
}
