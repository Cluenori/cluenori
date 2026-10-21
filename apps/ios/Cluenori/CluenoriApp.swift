import CluenoriScreens
import CluenoriViews
import SwiftUI

/// The app: its one window, and the pairing links the system opens it with.
@main
struct CluenoriApp: App {
    @State private var pairing = PairingModel(
        store: KeychainStore(),
        details: .thisPhone,
        cacheDirectory: .cachesDirectory
    )

    var body: some Scene {
        WindowGroup {
            CluenoriRootView(pairing: pairing)
                .onOpenURL { url in
                    Task { await pairing.open(url) }
                }
        }
    }
}
