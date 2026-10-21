import AlarmKit
import CluenoriClient
import CluenoriScreens
import Foundation
import UIKit
import UserNotifications

/// Alerts' side on this iPhone: the permissions for notifications and alarms, and registering for
/// pushes, whose token the app delegate hears.
nonisolated struct AlertsOnThisPhone: AlertSystem {
    func permission() async -> AlertPermission {
        let notifications = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        let alarms = AlarmManager.shared.authorizationState
        switch (notifications, alarms) {
        case (.notDetermined, _), (_, .notDetermined): return .notAsked
        case (.denied, _): return .denied
        case (_, .authorized): return .allowed
        default: return .withoutAlarms
        }
    }

    func turnOn() async -> AlertPermission {
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        _ = try? await AlarmManager.shared.requestAuthorization()
        await MainActor.run { UIApplication.shared.registerForRemoteNotifications() }
        return await permission()
    }
}

extension PushEnvironment {
    /// The APNs this build's push tokens belong to: development when Xcode installed it, which
    /// leaves its provisioning profile in the app saying so; production from TestFlight, whose
    /// builds have none.
    static var thisBuild: PushEnvironment {
        guard let url = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision"),
            let profile = try? Data(contentsOf: url)
        else {
            return .production
        }
        // The profile is a signed property list, whose entitlements are plain text inside it.
        let text = String(decoding: profile, as: UTF8.self)
        let says = text.range(of: "<key>aps-environment</key>").map { text[$0.upperBound...].prefix(64) }
        return says?.contains("<string>development</string>") == true ? .development : .production
    }
}
