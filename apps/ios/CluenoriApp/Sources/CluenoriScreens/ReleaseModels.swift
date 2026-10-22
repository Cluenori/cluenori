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
/// couldn't be read lately for its component. It is the whole release,
/// whatever the period. Fails with `missing` for a release the project doesn't know: none of its
/// operations ran, no deploy or build of it was reported, or it was too long ago.
@Observable
public final class ReleaseModel {
    public let release: ReleaseRef
    public let detail: Answer<ReleaseDetail>

    init(release: ReleaseRef, api: CluenoriAPI, context: AnswerContext) {
        self.release = release
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
