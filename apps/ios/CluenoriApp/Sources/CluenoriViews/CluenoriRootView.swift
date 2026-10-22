import CluenoriScreens
import SwiftUI

/// The app's window: pairing until the phone is paired, then Today and the projects, in tabs.
public struct CluenoriRootView: View {
    let pairing: PairingModel

    public init(pairing: PairingModel) {
        self.pairing = pairing
    }

    public var body: some View {
        if pairing.state == .paired, let models = pairing.models {
            PairedTabs(models: models, navigation: pairing.navigation, pairing: pairing)
        } else {
            PairScreen(pairing: pairing)
        }
    }
}

struct PairedTabs: View {
    let models: DeploymentModels
    @Bindable var navigation: Navigation
    let pairing: PairingModel

    var body: some View {
        TabView(selection: $navigation.tab) {
            Tab(value: Navigation.Tab.today) {
                NavigationStack(path: $navigation.todayPath) {
                    TodayScreen(today: models.today, pairing: pairing)
                        .navigationDestination(for: Route.self) { route in
                            RouteScreen(route: route, models: models, navigation: navigation)
                        }
                }
            } label: {
                Label {
                    Text("Today", bundle: #bundle, comment: "Tab of the attention queue.")
                } icon: {
                    Image(systemName: "sun.max")
                }
            }
            Tab(value: Navigation.Tab.projects) {
                NavigationStack(path: $navigation.projectsPath) {
                    ProjectsScreen(projects: models.projects, pairing: pairing)
                        .navigationDestination(for: Route.self) { route in
                            RouteScreen(route: route, models: models, navigation: navigation)
                        }
                }
            } label: {
                Label {
                    Text("Projects", bundle: #bundle, comment: "Tab of the list of projects.")
                } icon: {
                    Image(systemName: "square.stack.3d.up")
                }
            }
        }
        // What the phone allows alerts to do changes in Settings, so it is looked at again on return.
        .task { await models.alerts.refreshPermission() }
        .refreshWhenActive { await models.alerts.refreshPermission() }
        // The views also build for macOS, for the package's tests on a Mac; this is iOS's alone.
        #if os(iOS)
            .tabBarMinimizeBehavior(.onScrollDown)
        #endif
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
            // The project's environments, which choose the one shown; the first screen of a project
            // asks for them, and a link may show another project in this one's place.
            .task(id: route.project) { await models.environments(route.project).loadOnce() }
    }

    private struct Identity: Hashable {
        let route: Route
        let period: PeriodKey?
    }

    // Whether the screen looks over the period chosen; a project's follows it in place, and a
    // release, or a screen narrowed to one, looks over the release's own span.
    private static func looksOverPeriod(_ route: Route) -> Bool {
        switch route {
        case .operations(.project), .errors(.project), .error(.project, _), .logs(.project), .releases,
            .componentReleases:
            true
        case .operation(let operation): operation.release == nil
        // Analytics look over their own period of UTC days, which their screens follow in place.
        case .project, .component, .release, .operations(.release), .errors(.release), .error(.release, _),
            .logs(.release), .notes, .notesStyle, .analytics, .features, .appHealth, .person, .versionPolicy,
            .sdkKeys:
            false
        }
    }
}

/// The screen of a route whose environment is resolved.
private struct Screen: View {
    let route: Route
    let models: DeploymentModels
    let navigation: Navigation

    var body: some View {
        let environments = models.environments(route.project)
        switch route {
        case .project(let key, let environment):
            ProjectScreen(
                project: models.project(key, environment: environment, period: navigation.period),
                delivery: models.delivery(key),
                environments: environments,
                name: models.name(of: key),
                navigation: navigation
            )
            .task {
                // Opened by a link at launch, before the projects: they bring its name.
                if models.projects.projects == nil {
                    await models.projects.load()
                }
            }
        case .operations(let telemetry):
            OperationsScreen(
                operations: models.operations(telemetry, period: navigation.period),
                environments: environments,
                navigation: navigation
            )
        case .operation(let operation):
            OperationScreen(
                operation: models.operation(operation, period: navigation.period),
                environments: environments,
                navigation: navigation
            )
        case .errors(let telemetry):
            ErrorsScreen(
                errors: models.errors(telemetry, period: navigation.period), environments: environments,
                navigation: navigation)
        case .error(let telemetry, let id):
            ErrorScreen(
                error: models.error(telemetry, id: id, period: navigation.period), environments: environments,
                navigation: navigation)
        case .logs(let telemetry):
            LogsScreen(
                logs: models.logs(telemetry, period: navigation.period), environments: environments,
                navigation: navigation)
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
        case .person(let project, let user):
            PersonScreen(person: models.person(project, user: user))
        case .versionPolicy(let project, let component):
            VersionPolicyScreen(
                policies: models.versionPolicies(project), component: component,
                name: models.delivery(project).name(of: component))
        case .sdkKeys(let project, let component):
            SdkKeysScreen(
                keys: models.sdkKeys(project, component: component), name: models.delivery(project).name(of: component))
        }
    }
}
