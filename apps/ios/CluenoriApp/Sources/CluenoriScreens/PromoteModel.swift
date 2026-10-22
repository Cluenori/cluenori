import CluenoriClient
import Foundation
import Observation

/// Why promoting a release, or releasing an approved one, didn't happen.
public enum PromotionProblem: Equatable, Sendable {
    /// It can't happen until someone fixes what `reason` says, in the deployment's words, where
    /// `fix` says: Cluenori's GitHub App, the component's links, the workflow in its repository, the
    /// release's notes, App Store Connect, or the component's version, which numbers its commits.
    case refused(reason: String, fix: PromotionFix)
    /// The component is being promoted to the environment already, by `promotion`, which may be of
    /// another release: it ends first.
    case inProgress(Promotion)
    /// GitHub or App Store Connect didn't answer, so nothing happened: trying again may.
    case unavailable
    /// No promotion of that ID is approved and waiting to be released any more.
    case notWaitingForRelease
    /// The deployment didn't answer, as when the phone is offline. Nothing is kept to send later.
    case unreachable
    /// The deployment no longer knows the release, or its project.
    case missing
    /// The deployment answered in a way this app doesn't understand.
    case unreadable

    static func of(_ error: APIError) -> PromotionProblem {
        switch error {
        case .promotionRefused(let refused): .refused(reason: refused.reason, fix: refused.fix)
        case .promotionInProgress(let inProgress): .inProgress(inProgress.promotion)
        case .promotionUnavailable: .unavailable
        case .promotionNotFound: .notWaitingForRelease
        case .unreachable: .unreachable
        case .projectNotFound, .releaseNotFound: .missing
        default: .unreadable
        }
    }
}

/// Promoting to one environment by its component's deploy target there, as its confirmation sheet
/// does: a release, or a component's commit that has no release yet, which the deployment numbers
/// as its next; the workflow it starts on GitHub and where it runs, then, for an app, TestFlight or
/// App Store review and how an approved version goes live; why, in the member's words; and where
/// sending it stands. Each send that succeeds starts a promotion; offline, sending fails, and
/// nothing waits to be sent.
@Observable
public final class PromoteModel: Identifiable {
    /// What is promoted.
    public enum Subject: Equatable, Sendable {
        /// A release, by its version.
        case release(ReleaseRef)
        /// A component's commit that has no release yet: `commit`, or its repository's default
        /// branch's newest. The deployment numbers it as the component's next release.
        case latestCommit(project: String, component: String)
    }

    public enum State: Equatable, Sendable {
        /// Waiting for the member to promote, or to cancel.
        case confirming
        case sending
        /// It started: the release lists it, and the sheet closes.
        case started(Promotion)
        /// It didn't start, for `PromotionProblem`; sending again may.
        case failed(PromotionProblem)
    }

    /// The most characters a reason may have, as the deployment counts them (UTF-16 code units).
    public static let reasonLimit = 500

    public let subject: Subject
    /// The deploy targets to choose from: the one a release is promoted by, or, for a commit, each
    /// of its component's with a workflow, which builds it.
    public let targets: [DeployTarget]
    /// Where it goes, and how: a workflow, an App Store Connect app, or both; one of `targets`.
    public var target: DeployTarget
    /// For a commit: its full SHA, in any case; empty for the default branch's newest.
    public var commit = ""
    /// The repository the workflow runs in, the component's; nil when the release doesn't say.
    public let repository: String?
    /// Why, in the member's words: sent trimmed, and left out when empty.
    public var reason = ""
    /// Where the workflow runs: `auto`, the founder's Mac when it is online, else the cloud; sent
    /// only for a target with a workflow.
    public var runner = Runner.auto
    /// When a version App Store review approves goes live: at once, or when a member releases it;
    /// sent, with `phased`, only for a target that goes to App Store review.
    public var releaseType = AppStoreReleaseType.afterApproval
    /// Whether it goes live to everyone over 7 days.
    public var phased = true
    public private(set) var state = State.confirming

    @ObservationIgnored private let api: CluenoriAPI
    @ObservationIgnored private let keyRejected: () -> Void
    @ObservationIgnored private let started: (Promotion) -> Void

    /// `target` is the one of `targets` chosen at first.
    init(
        subject: Subject,
        targets: [DeployTarget],
        target: DeployTarget,
        repository: String?,
        api: CluenoriAPI,
        keyRejected: @escaping () -> Void,
        started: @escaping (Promotion) -> Void
    ) {
        self.subject = subject
        self.targets = targets
        self.target = target
        self.repository = repository
        self.api = api
        self.keyRejected = keyRejected
        self.started = started
    }

    public var environment: String {
        target.environment
    }

    /// The release promoted, `1.4.0+58`; nil for a commit, which has none until it's promoted.
    public var releaseVersion: String? {
        guard case .release(let release) = subject else { return nil }
        return release.version
    }

    /// The commit to promote, as the deployment takes it: 40 lower-case hex characters; nil for the
    /// default branch's newest, and for a release.
    public var commitSha: String? {
        let sha = commit.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return sha.isEmpty ? nil : sha
    }

    /// Whether the commit typed is a full SHA, or left empty.
    public var isCommitValid: Bool {
        commitSha.map { $0.wholeMatch(of: /[0-9a-f]{40}/) != nil } ?? true
    }

    /// Whether, once App Store Connect has processed its build, it is submitted to App Store review,
    /// rather than ending in TestFlight or without an app.
    public var goesToReview: Bool {
        target.appStore?.distribution == .appStore
    }

    /// How many characters the reason, trimmed, has past `reasonLimit`; 0 when it fits.
    public var reasonExcess: Int {
        max(trimmedReason.utf16.count - Self.reasonLimit, 0)
    }

    /// Whether `send` sends: not while it sends or once it started, nor with a reason too long or a
    /// commit that isn't a full SHA.
    public var canSend: Bool {
        switch state {
        case .confirming, .failed: reasonExcess == 0 && isCommitValid
        case .sending, .started: false
        }
    }

    /// Asks the deployment to promote by the deploy target: for a commit, it numbers it first as
    /// the component's next release; it starts the workflow on GitHub on `runner`, and, for an app,
    /// follows its build into TestFlight, or submits it to App Store review as `releaseType` and
    /// `phased` say. Once it has started, the release lists it; else `state` says why not. Does
    /// nothing unless `canSend`.
    public func send() async {
        guard canSend else { return }
        state = .sending
        let reason = trimmedReason.isEmpty ? nil : trimmedReason
        let runner = target.workflow == nil ? nil : runner
        let submission = goesToReview ? AppStoreSubmission(releaseType: releaseType, phased: phased) : nil
        do {
            let promotion: Promotion
            switch subject {
            case .release(let release):
                promotion = try await api.promote(
                    project: release.project, component: release.component, release: release.version,
                    PromoteTo(environment: environment, reason: reason, runner: runner, submission: submission))
            case .latestCommit(let project, let component):
                promotion = try await api.promoteLatest(
                    project: project, component: component,
                    PromoteLatestTo(
                        environment: environment, commit: commitSha, reason: reason, runner: runner,
                        submission: submission))
            }
            state = .started(promotion)
            started(promotion)
        } catch .unauthorized {
            // The phone unpairs, and its screens go with it.
            keyRejected()
            state = .failed(.unreadable)
        } catch {
            state = .failed(.of(error))
        }
    }

    private var trimmedReason: String {
        reason.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

extension Promotion {
    /// Whether it has ended, no longer followed: it succeeded, failed, was cancelled, rejected in
    /// review, or lost; or, in a state from a newer API, the deployment saw it end.
    public var hasEnded: Bool {
        endedAt != nil || [.succeeded, .failed, .cancelled, .rejected, .lost].contains(state)
    }

    /// Its workflow run's page on GitHub, once the run is known.
    public var runPage: URL? {
        run.flatMap { URL(webPage: $0.url) }
    }

    /// The release it promotes, in its environment, as its screen opens it.
    public func releaseRef(in project: String) -> ReleaseRef {
        ReleaseRef(project: project, component: component, environment: environment, version: release)
    }
}
