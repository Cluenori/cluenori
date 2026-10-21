import CluenoriClient
import Foundation

/// The paired deployment's screens: Today, the projects, and each screen a route opens, every one
/// asking the deployment with this phone's key and keeping its answers on the phone. A screen's
/// model is made once and kept while recently used, so going back to it shows it as it was, and a
/// view may ask for it each time it draws.
public final class DeploymentModels {
    public let today: TodayModel
    public let projects: ProjectsModel

    private let api: CluenoriAPI
    private let context: AnswerContext
    private var kept: [String: AnyObject] = [:]

    // The models of the screens recently opened, at most this many; past it, they are made anew.
    private static let keptAtMost = 64

    init(api: CluenoriAPI, context: AnswerContext) {
        self.api = api
        self.context = context
        today = TodayModel(api: api, context: context)
        projects = ProjectsModel(api: api, context: context)
    }

    /// What people call `project`: its name, from the projects or Today; its key until either says.
    /// A view reading it shows the name once the projects arrive.
    public func name(of project: String) -> String {
        projects.projects?.first { $0.key == project }?.name
            ?? today.answer.value?.projects.first { $0.key == project }?.name
            ?? project
    }

    /// A project's overview; its period changes by `ProjectModel.choose`.
    public func project(_ key: String, period: PeriodKey) -> ProjectModel {
        model("project \(key)") {
            ProjectModel(key: key, period: period, api: api, context: context)
        }
    }

    public func operations(_ project: String, period: PeriodKey) -> OperationsModel {
        model("operations \(project) \(period)") {
            OperationsModel(project: project, period: period, api: api, context: context)
        }
    }

    public func operation(_ operation: OperationRef, period: PeriodKey) -> OperationModel {
        model("operation \(operation) \(period)") {
            OperationModel(operation: operation, period: period, api: api, context: context)
        }
    }

    public func errors(_ project: String, period: PeriodKey) -> ErrorsModel {
        model("errors \(project) \(period)") {
            ErrorsModel(project: project, period: period, api: api, context: context)
        }
    }

    public func error(_ project: String, id: String, period: PeriodKey) -> ErrorModel {
        model("error \(project) \(id) \(period)") {
            ErrorModel(project: project, id: id, period: period, api: api, context: context)
        }
    }

    public func logs(_ project: String, period: PeriodKey) -> LogsModel {
        model("logs \(project) \(period)") { LogsModel(project: project, period: period, api: api, context: context) }
    }

    private func model<Model: AnyObject>(_ key: String, _ make: () -> Model) -> Model {
        if let model = kept[key] as? Model {
            return model
        }
        if kept.count >= Self.keptAtMost {
            kept.removeAll()
        }
        let model = make()
        kept[key] = model
        return model
    }
}
