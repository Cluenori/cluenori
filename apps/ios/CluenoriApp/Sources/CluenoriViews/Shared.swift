import CluenoriScreens
import Foundation
import SwiftUI

/// The period every screen looks over: one segmented choice, as on the web.
struct PeriodPicker: View {
    @Binding var period: PeriodKey

    var body: some View {
        Picker(selection: $period) {
            ForEach(PeriodKey.allCases, id: \.self) { key in
                Text(verbatim: key.rawValue).tag(key)
            }
        } label: {
            Text("Period", bundle: #bundle, comment: "The picker of how far back screens look.")
        }
        .pickerStyle(.segmented)
    }
}

/// Over the bottom of a screen, why what shows may be out of date: asking again failed.
struct AnswerBanner: View {
    let problem: AnswerProblem?
    let receivedAt: Date?

    var body: some View {
        switch problem {
        case .unreachable:
            BannerText(systemImage: "wifi.exclamationmark") {
                if let receivedAt {
                    Text(
                        "Offline. Showing what was here at \(receivedAt, format: .dateTime.hour().minute()).",
                        bundle: #bundle,
                        comment: "Banner when a screen couldn't be asked for. The variable is a time of day."
                    )
                } else {
                    Text("Offline.", bundle: #bundle, comment: "Banner when a screen couldn't be asked for.")
                }
            }
        case .unreadable:
            BannerText(systemImage: "exclamationmark.triangle") {
                Text(
                    "Cluenori answered in a way this version doesn't understand. Update the app.",
                    bundle: #bundle,
                    comment: "Banner when the deployment's answer couldn't be read."
                )
            }
        case nil:
            EmptyView()
        }
    }
}

/// What a screen shows before its answer arrives: a spinner, or why it couldn't come.
struct AnswerPlaceholder: View {
    let problem: AnswerProblem?

    var body: some View {
        if problem != nil {
            ContentUnavailableView {
                Label {
                    Text("Nothing to show yet", bundle: #bundle, comment: "A screen never loaded.")
                } icon: {
                    Image(systemName: "wifi.exclamationmark")
                }
            } description: {
                Text("Pull down to try again.", bundle: #bundle, comment: "How to ask for a screen again.")
            }
        } else {
            ProgressView()
                .frame(maxWidth: .infinity, alignment: .center)
        }
    }
}

/// A duration in milliseconds, as people read it: `840 ms`, `1.2 s`.
struct DurationText: View {
    let milliseconds: Double

    var body: some View {
        Text(Duration.milliseconds(milliseconds), format: Self.style(milliseconds))
            .monospacedDigit()
    }

    private static func style(_ milliseconds: Double) -> Duration.UnitsFormatStyle {
        milliseconds < 1_000
            ? .units(allowed: [.milliseconds], width: .abbreviated, fractionalPart: .hide)
            : .units(allowed: [.seconds], width: .abbreviated, fractionalPart: .show(length: 1))
    }
}

/// A count of something, with the share of it that failed: `1,204 · 2.1% failed`.
struct FailedShare: View {
    let count: Int
    let failed: Int

    var body: some View {
        let share = count == 0 ? 0 : Double(failed) / Double(count)
        Text(
            "\(share, format: .percent.precision(.fractionLength(0...1))) failed",
            bundle: #bundle,
            comment: "The share of operations that failed. The variable is a percentage."
        )
        .foregroundStyle(failed > 0 ? .red : .secondary)
    }
}
