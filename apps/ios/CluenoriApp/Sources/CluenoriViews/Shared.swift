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

/// The period switch at the top of a list, on the list's background.
struct PeriodSection: View {
    @Binding var period: PeriodKey

    var body: some View {
        Section {
            PeriodPicker(period: $period)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
        }
    }
}

/// The period as words inside a sentence: "the last hour", "the last 24 hours".
func periodPhrase(_ period: PeriodKey) -> Text {
    switch period {
    case .hour: Text("the last hour", bundle: #bundle, comment: "A period, inside a sentence.")
    case .day: Text("the last 24 hours", bundle: #bundle, comment: "A period, inside a sentence.")
    case .week: Text("the last 7 days", bundle: #bundle, comment: "A period, inside a sentence.")
    case .month: Text("the last 30 days", bundle: #bundle, comment: "A period, inside a sentence.")
    }
}

/// The button that looks further back: to the next longer period; nothing past the longest.
struct LookFurtherBack: View {
    @Binding var period: PeriodKey

    var body: some View {
        if let longer = period.longer {
            Button {
                period = longer
            } label: {
                Text(
                    "Show \(periodPhrase(longer))",
                    bundle: #bundle,
                    comment: "Widens the period. The variable is a period, such as the last 24 hours."
                )
            }
            .buttonStyle(.glass)
        }
    }
}

/// A screen's empty answer: what there was none of, over which period, and a way to look further.
struct NothingInPeriod: View {
    let title: Text
    let systemImage: String
    @Binding var period: PeriodKey

    var body: some View {
        ContentUnavailableView {
            Label {
                title
            } icon: {
                Image(systemName: systemImage)
            }
        } description: {
            Text("In \(periodPhrase(period)).", bundle: #bundle, comment: "Below an empty screen: over which period.")
        } actions: {
            LookFurtherBack(period: $period)
        }
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
        case .missing, nil:
            EmptyView()
        }
    }
}

/// What a screen shows before its answer arrives: a spinner, or why it couldn't come.
struct AnswerPlaceholder: View {
    let problem: AnswerProblem?

    var body: some View {
        if problem == .missing {
            ContentUnavailableView {
                Label {
                    Text("Not found", bundle: #bundle, comment: "The deployment has no such thing.")
                } icon: {
                    Image(systemName: "questionmark.circle")
                }
            }
        } else if problem != nil {
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
