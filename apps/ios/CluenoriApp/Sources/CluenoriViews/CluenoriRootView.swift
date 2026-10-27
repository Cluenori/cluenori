import CluenoriScreens
import SwiftUI

/// The app's window: pairing until the phone is paired, then Now, the screens a level deeper
/// opening over it; dark always, in the founder's palette.
public struct CluenoriRootView: View {
    let pairing: PairingModel

    public init(pairing: PairingModel) {
        self.pairing = pairing
    }

    public var body: some View {
        Group {
            if pairing.state == .paired, let models = pairing.models {
                PairedRoot(models: models, navigation: pairing.navigation, pairing: pairing)
            } else {
                PairScreen(pairing: pairing)
                    .measuredScreen("pair", feature: "settings.phones")
            }
        }
        .preferredColorScheme(.dark)
        .tint(Palette.blue)
    }
}

struct PairedRoot: View {
    let models: DeploymentModels
    @Bindable var navigation: Navigation
    let pairing: PairingModel

    var body: some View {
        NavigationStack(path: $navigation.path) {
            NowScreen(today: models.today, feeds: models.feeds, pairing: pairing)
                .navigationDestination(for: Route.self) { route in
                    RouteScreen(route: route, models: models, navigation: navigation)
                }
        }
        // What the phone allows alerts to do changes in Settings, so it is looked at again on return.
        .task { await models.alerts.refreshPermission() }
        .refreshWhenActive { await models.alerts.refreshPermission() }
    }
}

/// The screen a route opens, with its model, made once and kept while recently used: in the
/// environment the route names, else the one chosen for its project.
struct RouteScreen: View {
    let route: Route
    let models: DeploymentModels
    let navigation: Navigation

    var body: some View {
        let shown = models.resolved(route)
        Screen(route: shown, models: models, navigation: navigation)
            // Another environment, a cleared filter, or, for a screen that looks over it, another
            // period, is another screen, with its own state.
            .id(Identity(route: shown, period: Self.looksOverPeriod(shown) ? navigation.period : nil))
            .measuredScreen(shown.screenName, feature: shown.feature)
            // The project's environments, which choose the one shown; the first screen of a project
            // asks for them, and a link may show another project in this one's place.
            .task(id: route.project) {
                if let project = route.project {
                    await models.environments(project).loadOnce()
                }
            }
    }

    private struct Identity: Hashable {
        let route: Route
        let period: PeriodKey?
    }

    // Whether the screen looks over the period chosen; a project's follows it in place, and a
    // release, or a screen narrowed to one, looks over the release's own span.
    private static func looksOverPeriod(_ route: Route) -> Bool {
        switch route {
        case .operations(.project), .errors(.project), .error(.project, _), .logs(.project), .logMessage(.project, _),
            .releases, .componentReleases:
            true
        case .operation(let operation): operation.release == nil
        // A project's tech follows the period in place; a project's summary is over the last day.
        // Analytics look over their own period of UTC days, which their screens follow in place.
        // A feed is live, over its last 90 days.
        // A request is one thing, whenever it happened; so is an incident's life, or a monitor's.
        case .feeds, .feed, .project, .tech, .incidents, .incident, .uptime, .monitor, .delivery, .component,
            .release, .trace, .operations(.release),
            .errors(.release), .error(.release, _), .logs(.release), .logMessage(.release, _), .logLine, .notes,
            .notesStyle, .analytics, .features, .appHealth, .feature, .person, .personByID, .versionPolicy, .sdkKeys,
            .ingestKeys:
            false
        }
    }
}

/// The screen of a route whose environment is resolved: the deployment's own, or a project's.
private struct Screen: View {
    let route: Route
    let models: DeploymentModels
    let navigation: Navigation

    var body: some View {
        switch route {
        case .feeds:
            FeedsScreen(feeds: models.feeds, name: models.name(of:))
        case .feed(let id):
            FeedScreen(feed: models.feed(id), name: models.name(of:))
        default:
            if let project = route.project {
                ProjectRouteScreen(
                    route: route, environments: models.environments(project), models: models, navigation: navigation)
            }
        }
    }
}

/// The screen of a project's route, with the project's environments.
private struct ProjectRouteScreen: View {
    let route: Route
    let environments: EnvironmentChoice
    let models: DeploymentModels
    let navigation: Navigation

    var body: some View {
        switch route {
        // The deployment's own: `Screen` shows them.
        case .feeds, .feed:
            EmptyView()
        case .project(let key):
            ProjectScreen(
                key: key,
                today: models.today,
                delivery: models.delivery(key),
                name: models.name(of: key)
            )
        case .tech(let key, let environment):
            TechScreen(
                project: models.project(key, environment: environment, period: navigation.period),
                incidents: models.incidents(key),
                environments: environments,
                navigation: navigation
            )
        case .incidents(let key):
            IncidentsScreen(incidents: models.incidents(key), monitors: models.monitors(key))
        case .incident(let key, let id):
            IncidentScreen(
                incident: models.incident(key, id: id), incidents: models.incidents(key), today: models.today)
        case .uptime(let key):
            UptimeScreen(monitors: models.monitors(key))
        case .monitor(let key, let id):
            MonitorScreen(monitor: models.monitor(key, id: id), monitors: models.monitors(key))
        case .delivery(let key):
            DeliveryScreen(delivery: models.delivery(key), environments: environments)
        case .operations(let telemetry):
            OperationsScreen(
                operations: models.operations(telemetry, period: navigation.period),
                environments: environments,
                navigation: navigation
            )
        case .operation(let operation):
            OperationScreen(
                operation: models.operation(operation, period: navigation.period),
                incidents: models.incidents(operation.project),
                monitors: models.monitors(operation.project),
                environments: environments,
                navigation: navigation
            )
        case .trace(let trace):
            TraceScreen(trace: models.trace(trace))
        case .errors(let telemetry):
            ErrorsScreen(
                errors: models.errors(telemetry, period: navigation.period), environments: environments,
                navigation: navigation)
        case .error(let telemetry, let id):
            ErrorScreen(
                error: models.error(telemetry, id: id, period: navigation.period),
                monitors: models.monitors(telemetry.project), environments: environments, navigation: navigation)
        case .logs(let telemetry):
            LogsScreen(
                logs: models.logs(telemetry, period: navigation.period), environments: environments,
                navigation: navigation)
        case .logMessage(let telemetry, let id):
            LogMessageScreen(
                message: models.logMessage(telemetry, id: id, period: navigation.period),
                monitors: models.monitors(telemetry.project), environments: environments, navigation: navigation)
        case .logLine(let project, let id):
            LogLineByIDScreen(line: models.logLine(project, id: id))
        case .releases(let project, let environment):
            ReleasesScreen(
                releases: models.releases(project, environment: environment, period: navigation.period),
                environments: environments,
                navigation: navigation
            )
        case .component(let project, let component):
            ComponentScreen(
                delivery: models.delivery(project),
                component: component,
                versions: models.versions(project),
                release: models.release
            )
        case .componentReleases(let project, let component):
            ReleasesScreen(
                releases: models.releases(project, component: component, period: navigation.period),
                environments: environments,
                componentName: models.delivery(project).name(of: component),
                navigation: navigation
            )
        // A release is compared whole, whatever the period, in its own environment.
        case .release(let release):
            ReleaseScreen(release: models.release(release))
        // The same release's model as its screen's, so the notes it edits are those it promotes with.
        case .notes(let release):
            NotesScreen(release: models.release(release))
        case .notesStyle(let project):
            NotesStyleScreen(style: models.notesStyle(project))
        case .analytics(let analytics):
            AnalyticsScreen(
                analytics: models.analytics(analytics, period: navigation.analyticsPeriod),
                environments: environments,
                policies: models.versionPolicies(analytics.project),
                route: route,
                navigation: navigation
            )
        case .features(let analytics):
            FeaturesScreen(
                analytics: models.analytics(analytics, period: navigation.analyticsPeriod),
                environments: environments,
                route: route,
                navigation: navigation
            )
        // A release's app health is listed in its component's analytics, in its environment.
        case .appHealth(let release):
            AppHealthScreen(
                analytics: models.analytics(of: release, period: navigation.analyticsPeriod),
                release: release,
                period: navigation.analyticsPeriod
            )
        case .feature(let feature):
            FeatureScreen(feature: models.feature(feature), environments: environments, navigation: navigation)
        case .person(let project, let user):
            PersonScreen(person: models.person(project, user: user), navigation: navigation)
        case .personByID(let project, let person):
            PersonScreen(person: models.person(project, id: person), navigation: navigation)
        case .versionPolicy(let project, let component):
            VersionPolicyScreen(
                policies: models.versionPolicies(project), component: component,
                name: models.delivery(project).name(of: component))
        case .sdkKeys(let project, let component):
            SdkKeysScreen(
                keys: models.sdkKeys(project, component: component), name: models.delivery(project).name(of: component))
        case .ingestKeys(let project, let component):
            IngestKeysScreen(
                keys: models.ingestKeys(project, component: component),
                name: models.delivery(project).name(of: component))
        }
    }
}
