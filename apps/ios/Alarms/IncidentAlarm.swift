import ActivityKit
import AlarmKit
import AppIntents
import CluenoriScreens
import Foundation
import SwiftUI

// Shared by the app and its notification extension: the extension starts an alarm, and the app,
// which the system wakes for its Acknowledge button, acknowledges the incident.

/// What an incident's alarm carries: the incident, absent for a test.
nonisolated struct IncidentAlarm: AlarmMetadata {
    let project: String?
    let incident: String?
}

/// Rings and stops alerts' alarms, each under its alert's ID.
nonisolated enum IncidentAlarms {
    /// Rings `alert` now, saying `title`, in the app's red, with our siren and an Acknowledge
    /// button. Fails when the phone doesn't allow alarms.
    static func ring(_ alert: PushAlert, title: String) async throws {
        stop(alert.alert)
        let attributes = AlarmAttributes(
            presentation: AlarmPresentation(
                alert: .init(
                    title: LocalizedStringResource(stringLiteral: title),
                    secondaryButton: AlarmButton(
                        text: LocalizedStringResource(
                            "Acknowledge", comment: "The alarm's button that acknowledges its incident."),
                        textColor: .white,
                        systemImageName: "checkmark.circle.fill"
                    ),
                    secondaryButtonBehavior: .custom
                )
            ),
            metadata: IncidentAlarm(project: alert.incident?.project, incident: alert.incident?.id),
            tintColor: .red
        )
        _ = try await AlarmManager.shared.schedule(
            id: alert.alert,
            configuration: .alarm(
                // AlarmKit rings at a time to come; a second on is now.
                schedule: .fixed(.now.addingTimeInterval(1)),
                attributes: attributes,
                secondaryIntent: AcknowledgeIncident(alert: alert),
                sound: .named("siren.caf")
            )
        )
    }

    /// Stops the alarm of the alert with this ID, ringing or about to; none is nothing to stop.
    static func stop(_ alert: UUID) {
        try? AlarmManager.shared.stop(id: alert)
        try? AlarmManager.shared.cancel(id: alert)
    }
}

/// The alarm's Acknowledge button: stops it, and tells the deployment someone is on the incident.
/// The system runs it in the app, waking it when it isn't running.
struct AcknowledgeIncident: LiveActivityIntent {
    static let title = LocalizedStringResource("Acknowledge", comment: "The intent that acknowledges an incident.")
    static let isDiscoverable = false

    @Parameter(title: LocalizedStringResource("Alert", comment: "The alert whose alarm rings."))
    var alert: String
    @Parameter(title: LocalizedStringResource("Project", comment: "The incident's project."))
    var project: String?
    @Parameter(title: LocalizedStringResource("Incident", comment: "The incident to acknowledge."))
    var incident: String?

    // Registered when the app launches (CluenoriApp.swift); the extension only makes the intent.
    @Dependency private var pairing: PairingModel

    nonisolated init() {}

    nonisolated init(alert: PushAlert) {
        self.alert = alert.alert.uuidString
        project = alert.incident?.project
        incident = alert.incident?.id
    }

    nonisolated func perform() async throws -> some IntentResult {
        if let id = UUID(uuidString: alert) {
            IncidentAlarms.stop(id)
        }
        if let project, let incident {
            // Not handled: telling the person when acknowledging failed; the alarm has stopped,
            // and the incident stays open on Today, where they can acknowledge it again.
            _ = await pairing.acknowledge(PushAlert.Incident(project: project, id: incident))
        }
        return .result()
    }
}
