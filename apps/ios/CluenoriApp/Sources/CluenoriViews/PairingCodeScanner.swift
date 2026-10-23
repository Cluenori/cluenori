import CluenoriScreens
import Foundation
import SwiftUI

#if os(iOS)
    import AVFoundation
    import Vision
    import VisionKit
#endif

/// The button that asks for the camera to scan a pairing code: prominent on the pairing screen,
/// plain in a menu. What it opens is `scansPairingCode`, on a view that stays while it shows.
struct ScanPairingCodeButton: View {
    @Binding var isRequested: Bool
    var prominent = true

    var body: some View {
        if prominent {
            Button {
                isRequested = true
            } label: {
                label.padding(.horizontal, 12)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
        } else {
            Button {
                isRequested = true
            } label: {
                label
            }
        }
    }

    private var label: some View {
        Label {
            Text("Scan the Code", bundle: #bundle, comment: "Opens the camera to scan the web's pairing code.")
        } icon: {
            Image(systemName: "qrcode.viewfinder")
        }
    }
}

extension View {
    /// When `isRequested` turns true, opens the camera to scan a pairing code, asking for it once,
    /// and opens the link the code holds with `pairing`. When the camera was refused, says how to
    /// allow it; on a device that can't scan, says so.
    func scansPairingCode(_ isRequested: Binding<Bool>, pairing: PairingModel) -> some View {
        #if os(iOS)
            modifier(PairingCodeScanning(isRequested: isRequested, pairing: pairing))
        #else
            self
        #endif
    }
}

#if os(iOS)
    struct PairingCodeScanning: ViewModifier {
        @Binding var isRequested: Bool
        let pairing: PairingModel
        @State private var isScanning = false
        @State private var isRefused = false
        @Environment(\.openURL) private var openURL

        func body(content: Content) -> some View {
            content
                .onChange(of: isRequested) { _, requested in
                    if requested {
                        isRequested = false
                        start()
                    }
                }
                .fullScreenCover(isPresented: $isScanning) {
                    ScannerScreen { url in
                        isScanning = false
                        Task { await pairing.open(url) }
                    } onClose: {
                        isScanning = false
                    }
                }
                .alert(
                    Text(
                        "Cluenori can't use the camera", bundle: #bundle, comment: "Title when the camera was refused."),
                    isPresented: $isRefused
                ) {
                    Button {
                        if let settings = URL(string: UIApplication.openSettingsURLString) {
                            openURL(settings)
                        }
                    } label: {
                        Text("Open Settings", bundle: #bundle, comment: "Opens the app's settings to allow the camera.")
                    }
                    Button(role: .cancel) {
                    } label: {
                        Text("Not Now", bundle: #bundle, comment: "Dismisses the camera alert.")
                    }
                } message: {
                    Text(
                        "Allow Camera in Settings to scan the code, or copy the link on the web and paste it here.",
                        bundle: #bundle,
                        comment: "How to scan after refusing the camera."
                    )
                }
        }

        private func start() {
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                isScanning = true
            case .notDetermined:
                Task {
                    if await AVCaptureDevice.requestAccess(for: .video) {
                        isScanning = true
                    } else {
                        isRefused = true
                    }
                }
            default:
                isRefused = true
            }
        }
    }

    /// The camera, full screen, looking for a pairing code, with what to point it at and a way out.
    struct ScannerScreen: View {
        let onLink: (URL) -> Void
        let onClose: () -> Void

        var body: some View {
            ZStack {
                if DataScannerViewController.isSupported {
                    PairingCodeCamera(onLink: onLink)
                        .ignoresSafeArea()
                } else {
                    Color.black.ignoresSafeArea()
                    Text(
                        "This iPhone can't scan codes here. Use the Camera app, or paste the link.",
                        bundle: #bundle,
                        comment: "When the device can't scan codes in the app."
                    )
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding(32)
                }
                VStack {
                    HStack {
                        Spacer()
                        Button(action: { onClose() }) {
                            Image(systemName: "xmark")
                                .font(.title3.weight(.semibold))
                                .frame(width: 44, height: 44)
                        }
                        .buttonStyle(.glass)
                        .buttonBorderShape(.circle)
                        .accessibilityLabel(Text("Close", bundle: #bundle, comment: "Closes the camera."))
                    }
                    Spacer()
                    Text(
                        "Point at the code on Cluenori's Phones page.",
                        bundle: #bundle,
                        comment: "What to point the camera at."
                    )
                    .font(.callout)
                    .padding(.horizontal, 20)
                    .padding(.vertical, 12)
                    .glassEffect(in: .capsule)
                }
                .padding()
            }
        }
    }

    /// VisionKit's scanner, for QR codes: the first that holds a `cluenori:` link is handed on, once.
    struct PairingCodeCamera: UIViewControllerRepresentable {
        let onLink: (URL) -> Void

        func makeUIViewController(context: Context) -> DataScannerViewController {
            let scanner = DataScannerViewController(
                recognizedDataTypes: [.barcode(symbologies: [.qr])],
                qualityLevel: .balanced,
                recognizesMultipleItems: false,
                isHighFrameRateTrackingEnabled: false,
                isHighlightingEnabled: true
            )
            scanner.delegate = context.coordinator
            return scanner
        }

        func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {
            // It scans once it is on screen; failing to start leaves the screen's way out.
            if !scanner.isScanning {
                try? scanner.startScanning()
            }
        }

        static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
            scanner.stopScanning()
        }

        func makeCoordinator() -> Coordinator {
            Coordinator(onLink: onLink)
        }

        final class Coordinator: NSObject, DataScannerViewControllerDelegate {
            private let onLink: (URL) -> Void
            private var handedOn = false

            init(onLink: @escaping (URL) -> Void) {
                self.onLink = onLink
            }

            func dataScanner(
                _ dataScanner: DataScannerViewController,
                didAdd addedItems: [RecognizedItem],
                allItems: [RecognizedItem]
            ) {
                guard !handedOn else { return }
                for item in addedItems {
                    guard case .barcode(let code) = item, let text = code.payloadStringValue,
                        let url = URL(string: text), url.scheme == "cluenori"
                    else { continue }
                    handedOn = true
                    dataScanner.stopScanning()
                    onLink(url)
                    return
                }
            }
        }
    }
#endif
