import CluenoriClient
import Foundation
import Observation

/// The paired deployment's projects, by name: asked for when shown and on refresh. When asking
/// again fails, the projects already shown stay, with `problem` saying why.
@Observable
public final class ProjectsModel {
    /// The projects, by name; nil until they first arrive or are read from the phone.
    public private(set) var projects: [Project]? = nil
    public var problem: AnswerProblem? { answer.problem }
    public var isLoading: Bool { answer.isLoading }

    @ObservationIgnored let answer: Answer<ProjectList>

    init(api: CluenoriAPI, context: AnswerContext) {
        answer = Answer(context, .init(key: "projects") { () async throws(APIError) in try await api.listProjects() })
        show()
    }

    /// Asks the deployment for its projects. A refused key unpairs the phone.
    public func load() async {
        await answer.load()
        show()
    }

    private func show() {
        projects = answer.value?.projects.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }
}
