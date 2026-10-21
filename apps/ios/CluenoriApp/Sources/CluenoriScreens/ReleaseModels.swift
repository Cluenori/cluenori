import CluenoriClient
import Foundation
import Observation

/// The releases of a project that ran over a period, the latest first seen first, at most 30: each
/// with its verdict against the release before it of the same component and environment.
@Observable
public final class ReleasesModel {
    public let project: String
    public let period: PeriodKey
    public let list: Answer<ReleaseList>

    init(project: String, period: PeriodKey, api: CluenoriAPI, context: AnswerContext) {
        self.project = project
        self.period = period
        list = Answer(context, Self.question(api, project, period))
    }

    /// The question of the releases over `period`, which the project's overview asks too, so each
    /// shows what the other kept.
    static func question(_ api: CluenoriAPI, _ project: String, _ period: PeriodKey) -> Answer<ReleaseList>.Question {
        .init(key: "projects/\(project)/releases/\(period.rawValue)") { () async throws(APIError) in
            let (from, to) = period.endingNow
            return try await api.releases(project: project, from: from, to: to)
        }
    }
}

/// One release compared with the one before it: the operations that got slower or fail more, the
/// errors first seen in it, the incidents that opened while it ran, and what got better. It is the
/// whole release, whatever the period. Fails with `missing` for a release the project doesn't
/// count: none of its operations was, or it ran too long ago.
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
}
