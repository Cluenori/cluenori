import CluenoriScreens
import Foundation
import SwiftUI

/// A short message over the bottom of a screen, in glass: why what shows may be out of date.
struct BannerText<Content: View>: View {
    let systemImage: String
    @ViewBuilder let content: Content

    var body: some View {
        Label {
            content
        } icon: {
            Image(systemName: systemImage)
        }
        .font(.subheadline)
        .padding(.horizontal, 18)
        .padding(.vertical, 12)
        .glassEffect(in: .capsule)
        .padding(.bottom, 8)
    }
}

/// The phone's own settings: which deployment it is paired with, its alerts, and unpairing it.
struct PhoneMenu: View {
    let pairing: PairingModel
    @State private var isConfirming = false
    @State private var isScanRequested = false

    var body: some View {
        Menu {
            if let host = pairing.host {
                Section {
                    Text("Paired with \(host)", bundle: #bundle, comment: "The deployment's address, in the menu.")
                }
            }
            if let alerts = pairing.models?.alerts {
                AlertsMenuSection(alerts: alerts)
            }
            ScanPairingCodeButton(isRequested: $isScanRequested, prominent: false)
            Button(role: .destructive) {
                isConfirming = true
            } label: {
                Label {
                    Text("Unpair This iPhone", bundle: #bundle, comment: "Menu item that unpairs the phone.")
                } icon: {
                    Image(systemName: "iphone.slash")
                }
            }
        } label: {
            Label {
                Text("Settings", bundle: #bundle, comment: "The menu with the phone's settings.")
            } icon: {
                Image(systemName: "gearshape")
            }
        }
        .scansPairingCode($isScanRequested, pairing: pairing)
        .showsTestAlarm(pairing.models?.alerts)
        .confirmationDialog(
            Text("Unpair this iPhone?", bundle: #bundle, comment: "Title of the confirmation before unpairing."),
            isPresented: $isConfirming,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await pairing.unpair() }
            } label: {
                Text("Unpair", bundle: #bundle, comment: "Confirms unpairing the phone.")
            }
        } message: {
            Text(
                "Its key stops working, and it no longer shows your projects. To use it again, pair it again.",
                bundle: #bundle,
                comment: "What unpairing does."
            )
        }
    }
}
