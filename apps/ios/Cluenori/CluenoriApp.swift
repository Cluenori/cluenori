import AppIntents
import CluenoriScreens
import CluenoriViews
import SwiftUI

/// The phone's pairing, one for the app: its window shows it, its delegate gives it push tokens and
/// what alerts' actions ask, and the alarms' Acknowledge intent acts on it, also when the system
/// wakes the app without a window.
@MainActor let pairing = PairingModel(
    store: KeychainStore(),
    details: .thisPhone,
    cacheDirectory: .cachesDirectory,
    alertSystem: AlertsOnThisPhone(),
    passkeyDeployment: passkeyDeployment
)

/// The deployment this build's passkeys sign in to, from Info.plist; nil when it is built for none.
private var passkeyDeployment: URL? {
    guard let domain = Bundle.main.object(forInfoDictionaryKey: "CluenoriPasskeyDomain") as? String,
        !domain.isEmpty
    else {
        return nil
    }
    return URL(string: "https://\(domain)")
}

/// The app: its one window, the pairing links the system opens it with, and the system's calls
/// about alerts.
@main
struct CluenoriApp: App {
    @UIApplicationDelegateAdaptor private var delegate: AppDelegate

    init() {
        // Before any intent runs: an alarm's Acknowledge can launch the app (Apple's App Intents
        // guidance, "Dependencies"). SwiftUI makes the app on the main thread.
        MainActor.assumeIsolated {
            let model = pairing
            AppDependencyManager.shared.add(dependency: model)
        }
    }

    var body: some Scene {
        WindowGroup {
            CluenoriRootView(pairing: pairing)
                .onOpenURL { url in
                    Task { await pairing.open(url) }
                }
        }
    }
}
