import CluenoriScreens
import Foundation
import SwiftUI

/// Pairing this phone: how to get a pairing link from the web, and pasting one, which a simulator
/// needs since it has no camera.
struct PairScreen: View {
    let pairing: PairingModel

    var body: some View {
        VStack(spacing: 32) {
            Spacer()
            PairHeader()
            PairSteps()
            Spacer()
            PairFooter(pairing: pairing)
        }
        .padding(24)
        .frame(maxWidth: 520)
    }
}

struct PairHeader: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "qrcode.viewfinder")
                .font(.system(.largeTitle, weight: .regular))
                .imageScale(.large)
                .frame(width: 88, height: 88)
                .glassEffect(.regular.tint(.accentColor.opacity(0.25)), in: .circle)
                .accessibilityHidden(true)
            Text("Pair with Cluenori", bundle: #bundle, comment: "Title of the screen that pairs the phone.")
                .font(.largeTitle.bold())
                .multilineTextAlignment(.center)
            Text(
                "See your projects on this iPhone.",
                bundle: #bundle,
                comment: "Subtitle under the pairing screen's title."
            )
            .font(.title3)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
        }
    }
}

struct PairSteps: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            PairStep(number: 1) {
                Text(
                    "On your computer, open Cluenori and choose Phones.",
                    bundle: #bundle,
                    comment: "First pairing step."
                )
            }
            PairStep(number: 2) {
                Text("Choose Add a phone.", bundle: #bundle, comment: "Second pairing step: the web's button.")
            }
            PairStep(number: 3) {
                Text(
                    "Tap Scan the Code, and point this iPhone at it.",
                    bundle: #bundle,
                    comment: "Third pairing step: the button below."
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct PairStep<Content: View>: View {
    let number: Int
    @ViewBuilder let content: Content

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Text(number, format: .number)
                .font(.headline.monospacedDigit())
                .frame(width: 28, height: 28)
                .glassEffect(in: .circle)
                .accessibilityHidden(true)
            content
                .font(.body)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

struct PairFooter: View {
    let pairing: PairingModel
    @State private var isScanRequested = false

    var body: some View {
        VStack(spacing: 16) {
            if let problem = pairing.problem {
                PairingProblemText(problem: problem)
                    .font(.callout)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
            if pairing.state == .pairing {
                ProgressView {
                    Text("Pairing…", bundle: #bundle, comment: "Shown while the phone pairs.")
                }
            } else if pairing.canRetry {
                Button {
                    Task { await pairing.retry() }
                } label: {
                    Text("Try Again", bundle: #bundle, comment: "Tries the same pairing link again.")
                        .padding(.horizontal, 12)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
            } else {
                ScanPairingCodeButton(isRequested: $isScanRequested)
                if pairing.passkeyDeployment != nil {
                    PasskeySignInButton(pairing: pairing)
                }
                VStack(spacing: 8) {
                    Text(
                        "Or copy the link on the web, and paste it here.",
                        bundle: #bundle,
                        comment: "Above the Paste button, for pairing without the Camera."
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    PasteButton(payloadType: URL.self) { urls in
                        guard let url = urls.first else { return }
                        Task { await pairing.open(url) }
                    }
                    .buttonBorderShape(.capsule)
                }
            }
        }
        .scansPairingCode($isScanRequested, pairing: pairing)
    }
}

/// Why pairing failed, or why the phone isn't paired any more, and what to do.
struct PairingProblemText: View {
    let problem: PairingModel.Problem

    var body: some View {
        switch problem {
        case .notAPairingLink:
            Text(
                "That isn't a pairing link. Copy it again from Phones on the web.",
                bundle: #bundle,
                comment: "The pasted or opened link isn't a pairing link."
            )
        case .codeRejected:
            Text(
                "This code was already used, or is older than 10 minutes. Show a new one on the web.",
                bundle: #bundle,
                comment: "The pairing code was rejected."
            )
        case .removed:
            Text(
                "This iPhone was removed from Cluenori. Pair it again to use it.",
                bundle: #bundle,
                comment: "The deployment refused the phone's key."
            )
        case .unreachable:
            Text(
                "Cluenori didn't answer. Check this iPhone's connection, and try again.",
                bundle: #bundle,
                comment: "The deployment didn't answer."
            )
        case .unreadable:
            Text(
                "Cluenori answered in a way this version doesn't understand. Update the app.",
                bundle: #bundle,
                comment: "The deployment's answer couldn't be read."
            )
        case .keychain:
            Text(
                "This iPhone couldn't keep its key. Try again.",
                bundle: #bundle,
                comment: "The Keychain refused to store or read the phone's key."
            )
        case .passkeyNotUsed:
            Text(
                "No passkey was used. Try again when you're ready.",
                bundle: #bundle,
                comment: "The person cancelled the passkey request."
            )
        case .passkeyRejected:
            Text(
                "That passkey didn't work here: it may be another deployment's. Try another, or scan a code.",
                bundle: #bundle,
                comment: "The deployment refused the passkey."
            )
        case .passkeysUnavailable:
            Text(
                "This iPhone has no passkey for Cluenori yet. Make one with your invitation, or scan a code.",
                bundle: #bundle,
                comment: "The phone can't use the deployment's passkeys, or has none."
            )
        }
    }
}
