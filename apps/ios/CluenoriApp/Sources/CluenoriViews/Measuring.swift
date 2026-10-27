import Cluenori
import CluenoriAnalytics
import CluenoriPerformance
import CluenoriScreens
import Foundation
import SwiftUI

// The app measures itself with Cluenori's Swift SDK, when its build has a key (`CluenoriApp`):
// each screen by its kind, the feature it is, and how long it takes to show its answer, from what
// the phone kept or from the network. Before the SDK starts, as in previews, these do nothing.

/// The app's own telemetry, for its entry: the app links the SDK through CluenoriViews alone, so
/// one package pins its version.
public enum AppTelemetry {
    /// Starts the SDK and its performance measuring, as the app starts, so the launch is timed from
    /// the tap.
    public static func start(key: String, environment: String, deployment: URL) {
        Cluenori.start(key: key, environment: environment, deployment: deployment)
        Cluenori.measurePerformance()
    }

    /// The member the phone acts for, by their ID, the same person as on the web and the CLI.
    public static func identify(member: String) {
        Cluenori.identify(userID: member)
    }

    /// `request` with the screen's feature, the app's release and a trace, for the deployment's API.
    nonisolated public static func measured(_ request: URLRequest) -> URLRequest {
        var request = request
        request.addCluenoriHeaders()
        return request
    }
}

extension View {
    /// This view is the screen `name`, with `feature` in effect while it shows.
    func measuredScreen(_ name: String, feature: String) -> some View {
        cluenoriScreen(name).cluenoriFeature(feature)
    }

    /// Over the bottom of a screen, why what shows may be out of date (`AnswerBanner`), and when the
    /// screen's answer shows: kept, if it was there as the screen appeared, or fresh, when one
    /// arrives after. `receivedAt` is the answer's, nil until there is one.
    func answerBanner(problem: AnswerProblem?, receivedAt: Date?) -> some View {
        safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: problem, receivedAt: receivedAt)
        }
        .readyMark(receivedAt: receivedAt)
    }

    /// When the screen's answer shows, as `answerBanner` says it, for a screen with a banner of its own.
    func readyMark(receivedAt: Date?) -> some View {
        modifier(ReadyMark(receivedAt: receivedAt))
    }
}

private struct ReadyMark: ViewModifier {
    let receivedAt: Date?
    @State private var appearedAt: Date?

    func body(content: Content) -> some View {
        content
            .onAppear { appearedAt = .now }
            // A task starts after every view's onAppear, the screen's own included, so the kept answer
            // is this visit's, also on the way back to the screen.
            .task {
                if receivedAt != nil {
                    Cluenori.screenReady(.kept)
                }
            }
            .onChange(of: receivedAt) {
                if let receivedAt, let appearedAt, receivedAt > appearedAt {
                    Cluenori.screenReady(.fresh)
                }
            }
    }
}
