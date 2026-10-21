import CluenoriScreens
import Foundation
import UserNotifications

/// Runs for every alert push, which asks for it with `mutable-content`: rings an alarm that is
/// still news, and stops an incident's alarm when a later push says it recovered or someone is on
/// it. The notification itself shows as the deployment wrote it.
nonisolated final class NotificationService: UNNotificationServiceExtension {
    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent,
            let alert = PushAlert(payload: request.content.userInfo)
        else {
            contentHandler(request.content)
            return
        }
        let delivery = Delivery(content: content, handler: contentHandler)
        let title = content.title
        Task {
            var isLoud = false
            if alert.rings(at: .now) {
                do {
                    try await IncidentAlarms.ring(alert, title: title)
                } catch {
                    // Alarms aren't allowed: the notification is as loud as it can be without one.
                    isLoud = true
                }
            } else {
                IncidentAlarms.stop(alert.alert)
                // Too late to ring: told as a time-sensitive notification is.
                isLoud = alert.level == .alarm
            }
            delivery.finish(withSound: isLoud)
        }
    }
}

/// The notification to deliver and the system's handler for it, handed from `didReceive` to the
/// task that finishes them. Unchecked, since the SDK doesn't mark them: the system lets the handler
/// be called once, from any thread, and only the task touches either after `didReceive` returns.
private nonisolated struct Delivery: @unchecked Sendable {
    let content: UNMutableNotificationContent
    let handler: (UNNotificationContent) -> Void

    func finish(withSound: Bool) {
        if withSound {
            content.sound = .default
        }
        handler(content)
    }
}
