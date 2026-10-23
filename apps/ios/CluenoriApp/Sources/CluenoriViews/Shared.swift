import CluenoriClient
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

/// A screen's empty answer: what there was none of, over which period, what would bring some, and a
/// way to look further.
struct NothingInPeriod: View {
    let title: Text
    let systemImage: String
    @Binding var period: PeriodKey
    /// What makes some appear, when it isn't plain.
    var note: Text? = nil

    var body: some View {
        ContentUnavailableView {
            Label {
                title
            } icon: {
                Image(systemName: systemImage)
            }
        } description: {
            VStack(spacing: 8) {
                Text(
                    "In \(periodPhrase(period)).", bundle: #bundle, comment: "Below an empty screen: over which period."
                )
                if let note {
                    note
                }
            }
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

    /// How a duration of `milliseconds` reads, inside a sentence too.
    static func style(_ milliseconds: Double) -> Duration.UnitsFormatStyle {
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

/// At the top of a screen narrowed to one release, in place of the period and environment: which
/// release, a button that shows every release instead, the release's environment, which its screens
/// keep to, and the span they look over.
struct ReleaseFilterSection: View {
    let release: ReleaseRef
    /// When it ran, from its detail; nil until the detail arrives.
    let span: ReleaseSpan?
    let showEveryRelease: () -> Void

    var body: some View {
        Section {
            HStack(spacing: 12) {
                Image(systemName: "shippingbox")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: release.version)
                        .unhyphenated()
                        .font(.body.monospaced())
                        .lineLimit(2)
                    Text(
                        "Only this release of \(release.component)",
                        bundle: #bundle,
                        comment: "Below the version a screen shows alone. The variable is a component."
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)
                Spacer(minLength: 8)
                Button(action: { showEveryRelease() }) {
                    Label {
                        Text("Show every release", bundle: #bundle, comment: "Clears a screen's release filter.")
                    } icon: {
                        Image(systemName: "xmark.circle.fill")
                    }
                    .labelStyle(.iconOnly)
                    .font(.title2)
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(.secondary)
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(.rect)
                }
                .buttonStyle(.borderless)
            }
            if let environment = release.environment {
                LabeledContent {
                    Text(verbatim: environment)
                } label: {
                    Text("Environment", bundle: #bundle, comment: "Where a screen's numbers come from.")
                }
            }
            if let span {
                SpanRow(span: span)
            }
        }
    }
}

/// The span a screen narrowed to a release looks over: `Ran  Oct 21, 7:53 PM – Oct 22, 12:21 AM`,
/// or, for a release without telemetry, `Since  Oct 21, 4:21 PM`.
struct SpanRow: View {
    let span: ReleaseSpan

    var body: some View {
        if let to = span.to {
            LabeledContent {
                Text(span.from..<max(span.from, to), format: .interval.month(.abbreviated).day().hour().minute())
                    .multilineTextAlignment(.trailing)
            } label: {
                Text("Ran", bundle: #bundle, comment: "When a release ran, from its first minute to its last.")
            }
        } else {
            LabeledContent {
                Text(span.from, format: .dateTime.month(.abbreviated).day().hour().minute())
            } label: {
                Text(
                    "Since",
                    bundle: #bundle,
                    comment: "From when a screen narrowed to a release without telemetry looks: its deploy or upload."
                )
            }
        }
    }
}

/// A screen's empty answer when it is narrowed to a release: there was none over the release's span.
struct NothingInRelease: View {
    let title: Text
    let systemImage: String

    var body: some View {
        ContentUnavailableView {
            Label {
                title
            } icon: {
                Image(systemName: systemImage)
            }
        } description: {
            Text(
                "Over all of this release, for the time shown above.",
                bundle: #bundle,
                comment: "Below an empty screen narrowed to one release: over which time."
            )
        }
    }
}

/// Which environment a screen's numbers come from, chosen in a menu that says so, `Showing  prod`:
/// the project's environments, those of its deploy targets in their order first, its production ones
/// marked; the one, as text, when there is only one; nothing for a deployment that doesn't tell
/// environments apart. It chooses what the screens show, never where a release goes.
struct EnvironmentSection: View {
    let choice: EnvironmentChoice
    /// The environment the screen shows; nil for every environment.
    let shown: String?
    let navigation: Navigation

    var body: some View {
        if shown != nil, !choice.environments.isEmpty {
            Section {
                EnvironmentRow(choice: choice, shown: shown, navigation: navigation)
            }
        }
    }
}

/// The row of `EnvironmentSection`, for a section of its own or another's: nothing for a deployment
/// that doesn't tell environments apart.
struct EnvironmentRow: View {
    let choice: EnvironmentChoice
    /// The environment the screen shows; nil for every environment.
    let shown: String?
    let navigation: Navigation

    var body: some View {
        let environments = choice.environments
        if let shown, !environments.isEmpty {
            if environments == [shown] {
                LabeledContent {
                    Text(verbatim: shown)
                } label: {
                    ShowingLabel()
                }
            } else {
                Picker(selection: Binding(get: { shown }, set: { navigation.show($0, of: choice) })) {
                    // A link may name an environment not offered: it is offered too, to show which
                    // is chosen.
                    ForEach(environments.contains(shown) ? environments : environments + [shown], id: \.self) {
                        environment in
                        EnvironmentOption(environment: environment, isProduction: choice.isProduction(environment))
                            .tag(environment)
                    }
                } label: {
                    ShowingLabel()
                }
                .pickerStyle(.menu)
            }
        }
    }
}

/// The label of the environment a screen shows: `Showing`, with an eye.
private struct ShowingLabel: View {
    var body: some View {
        Label {
            Text("Showing", bundle: #bundle, comment: "Label of the environment whose numbers a screen shows.")
        } icon: {
            Image(systemName: "eye")
        }
    }
}

/// An environment in the menu of those a screen can show: its name, and `Production` below it for
/// one the project calls production.
struct EnvironmentOption: View {
    let environment: String
    let isProduction: Bool

    var body: some View {
        if isProduction {
            VStack {
                Text(verbatim: environment)
                Text("Production", bundle: #bundle, comment: "Marks one of a project's production environments.")
            }
        } else {
            Text(verbatim: environment)
        }
    }
}

/// At the top of a screen of a project's telemetry, what its numbers cover: the period and the
/// environment; or, narrowed to a release, the release, its environment, and its span, with a
/// button that shows every release over the period instead.
struct CoverageSections: View {
    let telemetry: Telemetry
    /// The release it is narrowed to, whose detail says its span.
    let release: ReleaseModel?
    let environments: EnvironmentChoice
    /// The screen's route, which the release's button shows without the release.
    let route: Route
    @Bindable var navigation: Navigation

    var body: some View {
        if let narrowed = telemetry.release {
            ReleaseFilterSection(release: narrowed, span: release?.detail.value?.summary.span) {
                navigation.showWithoutRelease(route)
            }
        } else {
            PeriodSection(period: $navigation.period)
            EnvironmentSection(choice: environments, shown: telemetry.environment, navigation: navigation)
        }
    }
}

/// A screen's empty answer: none over the period, with a way to look further back; or, narrowed to
/// a release, none over the release's span.
struct NothingShown: View {
    let title: Text
    let systemImage: String
    let narrowed: Bool
    @Binding var period: PeriodKey

    var body: some View {
        if narrowed {
            NothingInRelease(title: title, systemImage: systemImage)
        } else {
            NothingInPeriod(title: title, systemImage: systemImage, period: $period)
        }
    }
}

extension Text {
    /// The text as an identifier is written, such as a key, a user ID, a version or a link: wrapped
    /// where it must be, never hyphenated, since a hyphen added at a break reads as part of it. It is
    /// typeset as text of no language ("zxx"), which has no hyphenation rules.
    func unhyphenated() -> Text {
        typesettingLanguage(Locale.Language(identifier: "zxx"))
    }
}

extension View {
    /// Shows `text` below the navigation title, when there is one.
    @ViewBuilder func navigationSubtitle(ifAny text: Text?) -> some View {
        if let text {
            navigationSubtitle(text)
        } else {
            self
        }
    }
}
