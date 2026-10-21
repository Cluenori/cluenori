import CluenoriClient
import CluenoriScreens
import UIKit
import UserNotifications

/// What the system tells the app outside its window: the push token APNs gave it, and what the
/// person did with an alert, pressing Acknowledge or opening it.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    /// The notifications' category with an Acknowledge action, which the deployment's alerts name.
    nonisolated static let incidentCategory = "incident"
    nonisolated static let acknowledgeAction = "acknowledge"

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories([
            UNNotificationCategory(
                identifier: Self.incidentCategory,
                actions: [
                    UNNotificationAction(
                        identifier: Self.acknowledgeAction,
                        title: String(
                            localized: "Acknowledge", comment: "The alert's action that acknowledges its incident.")
                    )
                ],
                intentIdentifiers: []
            )
        ])
        // The token comes on every launch, whether or not alerts are allowed yet.
        application.registerForRemoteNotifications()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { await pairing.registerPush(token: token, environment: .thisBuild) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        // Not handled: showing why. It fails without the push entitlement, as in the simulator;
        // alerts then don't reach this phone, and a test alarm says it has no push token.
    }

    // An alert while the app is open shows as it would on the lock screen.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let alert = PushAlert(payload: response.notification.request.content.userInfo) else { return }
        let action = response.actionIdentifier
        IncidentAlarms.stop(alert.alert)
        if action == Self.acknowledgeAction, let incident = alert.incident {
            _ = await pairing.acknowledge(incident)
        } else if action == UNNotificationDefaultActionIdentifier {
            await pairing.open(alert)
        }
    }
}
