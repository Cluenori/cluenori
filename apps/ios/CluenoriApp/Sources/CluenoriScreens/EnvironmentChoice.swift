import CluenoriClient
import Foundation
import Observation

/// The environments a project's screens can show, and the one they show: the project's production
/// environments and the environments its telemetry named in the last 30 days, asked of the
/// deployment and kept on the phone; and the one chosen on this phone, remembered for the project,
/// offline too. A deployment older than environments tells none apart: its project's screens show
/// every environment, as they did.
@Observable
public final class EnvironmentChoice {
    public let project: String
    /// The project, with its settings and the environments seen; without either from a deployment
    /// older than environments.
    public let detail: Answer<ProjectDetail>
    /// The environment chosen on this phone for the project, seen lately or not; nil until one is.
    public private(set) var remembered: String?

    @ObservationIgnored private let store: AnswerStore
    @ObservationIgnored private var asked = false

    init(project: String, api: CluenoriAPI, context: AnswerContext) {
        self.project = project
        store = context.store
        detail = Answer(
            context,
            .init(key: "projects/\(project)/detail") { () async throws(APIError) in
                try await api.project(project: project)
            })
        remembered = store.read(String.self, Self.key(project))?.value
    }

    /// The environments to choose from: those seen in the last 30 days, the production ones first in
    /// the project's order, then the rest by name. Empty for a deployment that doesn't tell them
    /// apart, or until the deployment answers.
    public var environments: [String] {
        guard let detail = detail.value, detail.settings != nil else { return [] }
        return detail.environments ?? []
    }

    /// Which of `environments` the project calls production.
    public var production: [String] {
        let production = detail.value?.settings?.productionEnvironments ?? []
        return environments.filter(production.contains)
    }

    /// The environment the project's screens show: the one chosen on this phone while it is seen,
    /// else the first seen, which is the project's first production environment seen when there is
    /// one. Nil, every environment, while none is known: from a deployment that doesn't tell them
    /// apart, or before it answers.
    public var chosen: String? {
        let environments = environments
        if let remembered, environments.contains(remembered) {
            return remembered
        }
        return environments.first
    }

    /// Remembers `environment` for the project, on the phone too, for when the app opens again.
    /// `Navigation.show` chooses, so the screens open follow.
    func choose(_ environment: String) {
        remembered = environment
        store.write(environment, receivedAt: .now, Self.key(project))
    }

    /// Asks for the project's settings and environments the first time a screen of the project
    /// shows while the app runs; `refresh` asks again.
    public func loadOnce() async {
        guard !asked else { return }
        await refresh()
    }

    /// Asks for the project's settings and environments again.
    public func refresh() async {
        asked = true
        await detail.load()
    }

    private static func key(_ project: String) -> String {
        "projects/\(project)/chosen-environment"
    }
}
