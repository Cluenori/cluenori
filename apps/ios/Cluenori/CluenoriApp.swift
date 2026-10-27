import AppIntents
import CluenoriClient
import CluenoriScreens
import CluenoriViews
import Foundation
import SwiftUI

/// The phone's pairing, one for the app: its window shows it, its delegate gives it push tokens and
/// what alerts' actions ask, and the alarms' Acknowledge intent acts on it, also when the system
/// wakes the app without a window. A Debug build launched for the made-up deployment pairs with that
/// instead (`DemoDeployment`).
@MainActor let pairing: PairingModel = {
    #if DEBUG
        if let demo = DemoDeployment.pairing() {
            return demo
        }
    #endif
    return PairingModel(
        store: KeychainStore(),
        details: .thisPhone,
        transport: measuredTransport,
        cacheDirectory: .cachesDirectory,
        alertSystem: AlertsOnThisPhone(),
        passkeyDeployment: passkeyDeployment
    )
}()

/// The deployment this build's passkeys sign in to, from Info.plist; nil when it is built for none.
nonisolated private var passkeyDeployment: URL? {
    guard let domain = Bundle.main.object(forInfoDictionaryKey: "CluenoriPasskeyDomain") as? String,
        !domain.isEmpty
    else {
        return nil
    }
    return URL(string: "https://\(domain)")
}

/// Where the app reports itself, and with which SDK key, from Info.plist: the deployment its
/// passkeys sign in to, `Local.xcconfig`'s; nil when the build has no key, and the app reports
/// nothing.
nonisolated private let telemetry: (key: String, deployment: URL)? = {
    guard let key = Bundle.main.object(forInfoDictionaryKey: "CluenoriSDKKey") as? String, !key.isEmpty,
        let deployment = passkeyDeployment
    else {
        return nil
    }
    return (key, deployment)
}()

/// The API's requests, with the screen's feature, the app's release and a trace when they go to the
/// deployment the app reports to, so its work splits by the client that asked; to any other, as
/// they are.
nonisolated private let measuredTransport: CluenoriAPI.Transport = { request in
    let sent =
        if let telemetry, request.url?.host() == telemetry.deployment.host() {
            AppTelemetry.measured(request)
        } else {
            request
        }
    return try await URLSession.shared.data(for: sent)
}

/// The app: its one window, the pairing links the system opens it with, and the system's calls
/// about alerts.
@main
struct CluenoriApp: App {
    @UIApplicationDelegateAdaptor private var delegate: AppDelegate

    init() {
        // First, so the launch is timed from the tap; never for the made-up deployment of a Debug
        // build, whose screens aren't real use.
        if let telemetry, !UserDefaults.standard.bool(forKey: "CluenoriDemo") {
            #if DEBUG
                let environment = "development"
            #else
                let environment = "production"
            #endif
            AppTelemetry.start(key: telemetry.key, environment: environment, deployment: telemetry.deployment)
        }
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
                // The member the phone acts for, the same person as on the web and the CLI.
                .task(id: pairing.state) {
                    if pairing.state == .paired, let member = await pairing.models?.memberID() {
                        AppTelemetry.identify(member: member)
                    }
                }
                #if DEBUG
                    .task { await DemoDeployment.open(in: pairing) }
                #endif
        }
    }
}
