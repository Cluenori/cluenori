import CluenoriClient
import Foundation

/// The paired deployment's screens: Now, from Today, each screen a route opens, and alerts, every one
/// asking the deployment with this phone's key and keeping its answers on the phone. A screen's
/// model is made once and kept while recently used, so going back to it shows it as it was, and a
/// view may ask for it each time it draws.
public final class DeploymentModels {
    public let today: TodayModel
    public let alerts: AlertsModel
    public let feeds: FeedsModel

    private let api: CluenoriAPI
    private let context: AnswerContext
    // The member the phone acts for, which says whose promotions are its own: asked by a release's
    // screen until known, and kept on the phone, since a pairing acts for one member.
    private let member: Answer<Member>
    private var kept: [String: AnyObject] = [:]
    // Each project's environment choice and delivery, kept apart from the screens' models: one per
    // project, which its screens share.
    private var choices: [String: EnvironmentChoice] = [:]
    private var deliveries: [String: DeliveryModel] = [:]
    private var incidents: [String: IncidentsModel] = [:]

    // The models of the screens recently opened, at most this many; past it, they are made anew.
    private static let keptAtMost = 64

    init(api: CluenoriAPI, context: AnswerContext, phone: String, alertSystem: (any AlertSystem)?) {
        self.api = api
        self.context = context
        today = TodayModel(api: api, context: context)
        feeds = FeedsModel(api: api, context: context)
        member = Answer(context, .init(key: "me") { () async throws(APIError) in try await api.me() })
        alerts = AlertsModel(api: api, phone: phone, system: alertSystem, keyRejected: context.keyRejected)
    }

    /// What people call `project`: its name, from Today; its key until Today says. A view reading it
    /// shows the name once Today arrives.
    public func name(of project: String) -> String {
        today.project(project)?.name ?? project
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

    /// How a project's components' releases reach their environments, and their next steps; one per
    /// project, kept while the app runs, which its components' and releases' screens share.
    public func delivery(_ project: String) -> DeliveryModel {
        if let delivery = deliveries[project] {
            return delivery
        }
        let delivery = DeliveryModel(
            project: project,
            detail: environments(project).detail,
            api: api,
            context: context,
            // A promotion started by a next step shows on its release's screen at once, before the
            // deployment knows the release.
            startedElsewhere: { [weak self] promotion in
                self?.release(promotion.releaseRef(in: project)).show(started: promotion)
            }
        )
        deliveries[project] = delivery
        return delivery
    }

    /// The screen `route` names, in the environment chosen for its project when it names none: what
    /// its screen shows, and the models it is made with.
    public func resolved(_ route: Route) -> Route {
        guard let project = route.project, let environment = environments(project).chosen else { return route }
        return route.choosing(environment)
    }

    /// A project's incidents, every environment's, and acknowledging one; one per project, kept while
    /// the app runs, which its tech, its incidents and each incident share.
    public func incidents(_ project: String) -> IncidentsModel {
        if let model = incidents[project] {
            return model
        }
        let model = IncidentsModel(project: project, api: api, context: context)
        incidents[project] = model
        return model
    }

    /// A project's tech in `environment`; its period changes by `ProjectModel.choose`.
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

    /// One request and its trace, whenever it happened.
    public func trace(_ trace: TraceRef) -> TraceModel {
        model("trace \(trace.project) \(trace.id)") {
            TraceModel(trace: trace, api: api, context: context)
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

    /// One log message, in a project's environment over `period`, or in one of its releases over its
    /// span.
    public func logMessage(_ telemetry: Telemetry, id: Int, period: PeriodKey) -> LogMessageModel {
        model("log message \(telemetry) \(id) \(over(telemetry, period))") {
            LogMessageModel(
                telemetry: telemetry, id: id, period: period, release: release(of: telemetry), api: api,
                context: context)
        }
    }

    /// One of a project's warnings and errors, by its ID.
    public func logLine(_ project: String, id: Int) -> LogLineModel {
        model("log line \(project) \(id)") {
            LogLineModel(project: project, id: id, api: api, context: context)
        }
    }

    /// The releases of a project in `environment` over `period`.
    public func releases(_ project: String, environment: String?, period: PeriodKey) -> ReleasesModel {
        model("releases \(project) \(environment ?? "") \(period)") {
            ReleasesModel(project: project, environment: environment, period: period, api: api, context: context)
        }
    }

    /// Every release of one of a project's components, in every environment, over `period`.
    public func releases(_ project: String, component: String, period: PeriodKey) -> ReleasesModel {
        model("component releases \(project) \(component) \(period)") {
            ReleasesModel(
                project: project, environment: nil, component: component, period: period, api: api, context: context)
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
        model("release \(release)") {
            ReleaseModel(
                release: release, api: api, context: context, member: member, delivery: delivery(release.project))
        }
    }

    /// How a project's apps are used and how healthy each release is, of every component or one, in
    /// an environment; its period changes by `AnalyticsModel.choose`. Its features' screen and its
    /// releases' app health share it.
    public func analytics(_ analytics: AnalyticsRef, period: AnalyticsPeriod) -> AnalyticsModel {
        model("analytics \(analytics.project) \(analytics.component ?? "*") \(analytics.environment ?? "*")") {
            AnalyticsModel(analytics: analytics, period: period, api: api, context: context)
        }
    }

    /// The analytics a release's app health is listed in: its component's, in its environment.
    public func analytics(of release: ReleaseRef, period: AnalyticsPeriod) -> AnalyticsModel {
        analytics(
            AnalyticsRef(project: release.project, component: release.component, environment: release.environment),
            period: period)
    }

    /// One feed, live, by its ID.
    public func feed(_ id: String) -> FeedModel {
        model("feed \(id)") { FeedModel(id: id, api: api, context: context) }
    }

    /// One person of a project, by the app's own user ID for them.
    public func person(_ project: String, user: String) -> PersonModel {
        model("person \(project) \(user)") {
            PersonModel(project: project, who: .user(user), api: api, context: context)
        }
    }

    /// One person of a project, by Cluenori's ID for them.
    public func person(_ project: String, id: String) -> PersonModel {
        model("person \(project) id \(id)") {
            PersonModel(project: project, who: .person(id), api: api, context: context)
        }
    }

    /// One feature's story, in its environment or every one.
    public func feature(_ feature: FeatureRef) -> FeatureModel {
        model("feature \(feature.project) \(feature.key) \(feature.environment ?? "*")") {
            FeatureModel(feature: feature, api: api, context: context)
        }
    }

    /// A project's components' version policies.
    public func versionPolicies(_ project: String) -> VersionPolicyModel {
        model("version policies \(project)") { VersionPolicyModel(project: project, api: api, context: context) }
    }

    /// One component's SDK keys.
    public func sdkKeys(_ project: String, component: String) -> SdkKeysModel {
        model("sdk keys \(project) \(component)") {
            SdkKeysModel(project: project, component: component, api: api, context: context)
        }
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
