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

/// The screen a route opens, with its model, made once and kept while recently used.
struct RouteScreen: View {
    let route: Route
    let models: DeploymentModels
    let navigation: Navigation

    var body: some View {
        switch route {
        case .project(let key):
            ProjectScreen(
                project: models.project(key, period: navigation.period),
                name: models.name(of: key),
                navigation: navigation
            )
            .task {
                // Opened by a link at launch, before the projects: they bring its name.
                if models.projects.projects == nil {
                    await models.projects.load()
                }
            }
        // Each of these looks over one period: a new one is another screen, with its own state.
        case .operations(let project):
            OperationsScreen(operations: models.operations(project, period: navigation.period), navigation: navigation)
                .id(navigation.period)
        case .operation(let operation):
            OperationScreen(operation: models.operation(operation, period: navigation.period), navigation: navigation)
                .id(navigation.period)
        case .errors(let project):
            ErrorsScreen(errors: models.errors(project, period: navigation.period), navigation: navigation)
                .id(navigation.period)
        case .error(let project, let id):
            ErrorScreen(error: models.error(project, id: id, period: navigation.period), navigation: navigation)
                .id(navigation.period)
        case .logs(let project):
            LogsScreen(logs: models.logs(project, period: navigation.period), navigation: navigation)
                .id(navigation.period)
        }
    }
}
