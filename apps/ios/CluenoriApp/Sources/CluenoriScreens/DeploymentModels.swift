import CluenoriClient
import Foundation

/// The paired deployment's screens: Today, the projects, each screen a route opens, and alerts, every one
/// asking the deployment with this phone's key and keeping its answers on the phone. A screen's
/// model is made once and kept while recently used, so going back to it shows it as it was, and a
/// view may ask for it each time it draws.
public final class DeploymentModels {
    public let today: TodayModel
    public let projects: ProjectsModel
    public let alerts: AlertsModel

    private let api: CluenoriAPI
    private let context: AnswerContext
    // The member the phone acts for, which says whose promotions are its own: asked by a release's
    // screen until known, and kept on the phone, since a pairing acts for one member.
    private let member: Answer<Member>
    private var kept: [String: AnyObject] = [:]
    // Each project's environment choice, kept apart from the screens' models: one per project.
    private var choices: [String: EnvironmentChoice] = [:]

    // The models of the screens recently opened, at most this many; past it, they are made anew.
    private static let keptAtMost = 64

    init(api: CluenoriAPI, context: AnswerContext, phone: String, alertSystem: (any AlertSystem)?) {
        self.api = api
        self.context = context
        today = TodayModel(api: api, context: context)
        projects = ProjectsModel(api: api, context: context)
        member = Answer(context, .init(key: "me") { () async throws(APIError) in try await api.me() })
        alerts = AlertsModel(api: api, phone: phone, system: alertSystem, keyRejected: context.keyRejected)
    }

    /// What people call `project`: its name, from the projects or Today; its key until either says.
    /// A view reading it shows the name once the projects arrive.
    public func name(of project: String) -> String {
        projects.projects?.first { $0.key == project }?.name
            ?? today.answer.value?.projects.first { $0.key == project }?.name
            ?? project
    }

    /// The environments a project's screens can show, and the one they show; one per project, kept
    /// while the app runs.
    public func environments(_ project: String) -> EnvironmentChoice {
        if let choice = choices[project] {
            return choice
        }
        let choice = EnvironmentChoice(project: project, api: api, context: context)
        choices[project] = choice
        return choice
    }

    /// The screen `route` names, in the environment chosen for its project when it names none: what
    /// its screen shows, and the models it is made with.
    public func resolved(_ route: Route) -> Route {
        guard let environment = environments(route.project).chosen else { return route }
        return route.choosing(environment)
    }

    /// A project's overview in `environment`; its period changes by `ProjectModel.choose`.
    public func project(_ key: String, environment: String?, period: PeriodKey) -> ProjectModel {
        model("project \(key) \(environment ?? "")") {
            ProjectModel(key: key, environment: environment, period: period, api: api, context: context)
        }
    }

    /// Every operation of a project in an environment over `period`, or of one of its releases over
    /// its span.
    public func operations(_ telemetry: Telemetry, period: PeriodKey) -> OperationsModel {
        model("operations \(telemetry) \(over(telemetry, period))") {
            OperationsModel(
                telemetry: telemetry, period: period, release: release(of: telemetry), api: api, context: context)
        }
    }

    /// One operation in its environment, over `period` and every release, or over one release's span.
    public func operation(_ operation: OperationRef, period: PeriodKey) -> OperationModel {
        model("operation \(operation) \(over(operation.telemetry, period))") {
            OperationModel(
                operation: operation, period: period, release: release(of: operation.telemetry), api: api,
                context: context)
        }
    }

    /// Every error of a project in an environment over `period`, or of one of its releases over its
    /// span.
    public func errors(_ telemetry: Telemetry, period: PeriodKey) -> ErrorsModel {
        model("errors \(telemetry) \(over(telemetry, period))") {
            ErrorsModel(
                telemetry: telemetry, period: period, release: release(of: telemetry), api: api, context: context)
        }
    }

    /// One error, in a project's environment over `period`, or in one of its releases over its span.
    public func error(_ telemetry: Telemetry, id: String, period: PeriodKey) -> ErrorModel {
        model("error \(telemetry) \(id) \(over(telemetry, period))") {
            ErrorModel(
                telemetry: telemetry, id: id, period: period, release: release(of: telemetry), api: api,
                context: context)
        }
    }

    /// The warnings and errors of a project in an environment over `period`, or of one of its
    /// releases over its span.
    public func logs(_ telemetry: Telemetry, period: PeriodKey) -> LogsModel {
        model("logs \(telemetry) \(over(telemetry, period))") {
            LogsModel(telemetry: telemetry, period: period, release: release(of: telemetry), api: api, context: context)
        }
    }

    /// The releases of a project in `environment` over `period`.
    public func releases(_ project: String, environment: String?, period: PeriodKey) -> ReleasesModel {
        model("releases \(project) \(environment ?? "") \(period)") {
            ReleasesModel(project: project, environment: environment, period: period, api: api, context: context)
        }
    }

    /// A project's components' versions, which its builds are numbered in.
    public func versions(_ project: String) -> VersionsModel {
        model("versions \(project)") {
            VersionsModel(project: project, projectDetail: environments(project).detail, api: api, context: context)
        }
    }

    /// How a project's release notes read, which drafts follow.
    public func notesStyle(_ project: String) -> NotesStyleModel {
        model("notes style \(project)") { NotesStyleModel(project: project, api: api, context: context) }
    }

    /// One release, whatever the period: its comparison is of the whole release.
    public func release(_ release: ReleaseRef) -> ReleaseModel {
        model("release \(release)") { ReleaseModel(release: release, api: api, context: context, member: member) }
    }

    // The release `telemetry` is narrowed to, whose span its screens look over.
    private func release(of telemetry: Telemetry) -> ReleaseModel? {
        telemetry.release.map(release)
    }

    // What a screen's model looks over, beside its telemetry: the period for a project's; a release's
    // own span, whatever the period, for one release's.
    private func over(_ telemetry: Telemetry, _ period: PeriodKey) -> String {
        telemetry.release == nil ? period.rawValue : "span"
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
