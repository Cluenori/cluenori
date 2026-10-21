import CluenoriScreens
import SwiftUI

#if canImport(UIKit)
    import UIKit
#endif

/// The phone's own Settings page for the app, where its notifications and alarms are turned on.
@MainActor
private var appSettings: URL? {
    #if canImport(UIKit)
        URL(string: UIApplication.openSettingsURLString)
    #else
        nil
    #endif
}

/// What alerts need from the phone, over the top of Today until it allows them: asked the first
/// time, then a way to Settings.
struct AlertsCard: View {
    let alerts: AlertsModel
    @Environment(\.openURL) private var openURL

    var body: some View {
        if let permission = alerts.permission, permission != .allowed {
            VStack(alignment: .leading, spacing: 10) {
                Label {
                    message(permission)
                } icon: {
                    Image(systemName: permission == .withoutAlarms ? "alarm" : "bell.badge")
                        .foregroundStyle(.red)
                }
                .font(.subheadline)
                Button {
                    if permission == .notAsked {
                        Task { await alerts.turnOn() }
                    } else if let appSettings {
                        openURL(appSettings)
                    }
                } label: {
                    if permission == .notAsked {
                        Text("Turn On Alerts", bundle: #bundle, comment: "Asks the phone to allow alerts.")
                    } else {
                        Text("Open Settings", bundle: #bundle, comment: "Opens the app's page in Settings.")
                    }
                }
                .buttonStyle(.glassProminent)
                .tint(.red)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassEffect(in: .rect(cornerRadius: 24))
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
        }
    }

    private func message(_ permission: AlertPermission) -> Text {
        switch permission {
        case .notAsked:
            Text(
                "When a project is down or failing, Cluenori rings like an alarm clock, even in silent mode.",
                bundle: #bundle,
                comment: "Why to turn alerts on, before the phone asked."
            )
        case .withoutAlarms:
            Text(
                "Alarms are off, so a project that is down comes as a notification, which silent mode mutes.",
                bundle: #bundle,
                comment: "Notifications are allowed, alarms not."
            )
        case .denied, .allowed:
            Text(
                "Notifications are off, so nothing tells you when a project is down.",
                bundle: #bundle,
                comment: "The phone doesn't allow the app's notifications."
            )
        }
    }
}

/// The menu's part for alerts: turning them on, or ringing a test alarm.
struct AlertsMenuSection: View {
    let alerts: AlertsModel
    @Environment(\.openURL) private var openURL

    var body: some View {
        Section {
            switch alerts.permission {
            case .allowed, .withoutAlarms:
                Button {
                    Task { await alerts.ringTestAlarm() }
                } label: {
                    Label {
                        Text("Ring a Test Alarm", bundle: #bundle, comment: "Rings this phone through the deployment.")
                    } icon: {
                        Image(systemName: "alarm")
                    }
                }
                .disabled(alerts.testAlarm == .sending)
            case .notAsked:
                Button {
                    Task { await alerts.turnOn() }
                } label: {
                    Label {
                        Text("Turn On Alerts", bundle: #bundle, comment: "Asks the phone to allow alerts.")
                    } icon: {
                        Image(systemName: "bell.badge")
                    }
                }
            case .denied:
                if let appSettings {
                    Button {
                        openURL(appSettings)
                    } label: {
                        Label {
                            Text(
                                "Turn On Alerts in Settings",
                                bundle: #bundle,
                                comment: "Opens Settings, where the app's notifications are off."
                            )
                        } icon: {
                            Image(systemName: "bell.slash")
                        }
                    }
                }
            case nil:
                EmptyView()
            }
        }
    }
}

extension View {
    /// Says how the last test alarm went, once it went.
    func showsTestAlarm(_ alerts: AlertsModel?) -> some View {
        modifier(TestAlarmResult(alerts: alerts))
    }
}

private struct TestAlarmResult: ViewModifier {
    let alerts: AlertsModel?

    private var isShown: Binding<Bool> {
        Binding {
            switch alerts?.testAlarm {
            case .sent, .failed: true
            case .idle, .sending, nil: false
            }
        } set: { shown in
            if !shown {
                alerts?.dismissTestAlarm()
            }
        }
    }

    func body(content: Content) -> some View {
        content.alert(title, isPresented: isShown) {
            Button(role: .close) {
                alerts?.dismissTestAlarm()
            }
        } message: {
            message
        }
    }

    private var title: Text {
        if alerts?.testAlarm == .sent {
            Text("Test alarm sent", bundle: #bundle, comment: "Title once APNs took the test alarm.")
        } else {
            Text("No test alarm", bundle: #bundle, comment: "Title when the test alarm couldn't be sent.")
        }
    }

    private var message: Text {
        switch alerts?.testAlarm {
        case .failed(.notSetUp):
            Text(
                "The deployment can't push yet. On your computer, run ./cluenori push setup with your APNs key.",
                bundle: #bundle,
                comment: "The deployment has no APNs key."
            )
        case .failed(.noPushToken):
            Text(
                "The deployment doesn't know where this iPhone gets pushes yet. Open Cluenori again in a moment.",
                bundle: #bundle,
                comment: "The phone's push token hasn't reached the deployment."
            )
        case .failed(.rejected(let reason)):
            Text(
                "APNs refused it: \(reason). Check the key with ./cluenori push setup.",
                bundle: #bundle,
                comment: "APNs refused the test alarm. The variable is Apple's reason, such as BadDeviceToken."
            )
        case .failed(.apnsUnavailable):
            Text(
                "APNs didn't take it now. Try again in a minute.",
                bundle: #bundle,
                comment: "APNs was unavailable."
            )
        case .failed(.unreachable):
            Text(
                "Cluenori didn't answer. Check the connection, and try again.",
                bundle: #bundle,
                comment: "The deployment didn't answer the test alarm."
            )
        case .failed(.incidentNotFound), .failed(.unreadable):
            Text(
                "Cluenori answered in a way this version doesn't understand. Update the app.",
                bundle: #bundle,
                comment: "The deployment's answer couldn't be read."
            )
        case .sent, .idle, .sending, nil:
            Text(
                "It rings within seconds, through silent mode. Acknowledge stops it.",
                bundle: #bundle,
                comment: "What happens after the test alarm was sent."
            )
        }
    }
}
