import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// The releases of a project that ran over the period, the latest first seen first, each with its
/// verdict against the release before it.
struct ReleasesScreen: View {
    let releases: ReleasesModel
    @Bindable var navigation: Navigation

    // The API lists at most this many: a list this long may leave older ones out.
    private static let listedAtMost = 30

    var body: some View {
        List {
            PeriodSection(period: $navigation.period)
            if let list = releases.list.value, !list.releases.isEmpty {
                Section {
                    ForEach(list.releases, id: \.self) { summary in
                        ReleaseLink(project: releases.project, summary: summary)
                    }
                } footer: {
                    if list.releases.count >= Self.listedAtMost {
                        Text(
                            "Only the \(Self.listedAtMost) latest are listed.",
                            bundle: #bundle,
                            comment: "Below a full list of releases. The variable is how many it lists."
                        )
                    }
                }
            }
        }
        .overlay {
            if let list = releases.list.value {
                if list.releases.isEmpty {
                    NothingInPeriod(
                        title: Text(
                            "No releases", bundle: #bundle, comment: "A project had no releases in the period."),
                        systemImage: "shippingbox",
                        period: $navigation.period,
                        note: Text(
                            "A release shows once a service reports its version in `service.version`.",
                            bundle: #bundle,
                            comment: "What makes releases appear. service.version is a name, as is."
                        )
                    )
                }
            } else {
                AnswerPlaceholder(problem: releases.list.problem)
            }
        }
        .navigationTitle(Text("Releases", bundle: #bundle, comment: "Title of every release of a project."))
        .refreshable { await releases.list.load() }
        .task { await releases.list.load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: releases.list.problem, receivedAt: releases.list.receivedAt)
        }
    }
}

/// A release, leading to its comparison with the release before it.
struct ReleaseLink: View {
    let project: String
    let summary: ReleaseSummary

    var body: some View {
        NavigationLink(
            value: Route.release(
                ReleaseRef(
                    project: project,
                    component: summary.component,
                    environment: summary.environment,
                    version: summary.release
                )
            )
        ) {
            ReleaseRow(
                release: summary.release,
                component: summary.component,
                environment: summary.environment,
                firstSeen: summary.firstSeen,
                lastSeen: summary.lastSeen,
                count: summary.count,
                errors: summary.errors,
                verdict: summary.verdict,
                slower: summary.slower,
                failingMore: summary.failingMore,
                newErrors: summary.newErrors
            )
        }
    }
}

/// One release: its version and verdict, how much it ran and failed, and where and when it ran.
struct ReleaseRow: View {
    let release: String
    let component: String
    let environment: String?
    let firstSeen: Date
    let lastSeen: Date
    let count: Int
    let errors: Int
    let verdict: Verdict
    let slower: Int
    let failingMore: Int
    let newErrors: Int

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: verdict.symbol)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(verdict.tint)
                .font(.title3)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(verbatim: release)
                        .font(.body.monospaced())
                        .lineLimit(2)
                    Spacer(minLength: 12)
                    Text(count, format: .number)
                        .font(.body.monospacedDigit().weight(.semibold))
                }
                HStack(alignment: .firstTextBaseline) {
                    VerdictText(verdict: verdict, slower: slower, failingMore: failingMore, newErrors: newErrors)
                        .foregroundStyle(verdict.tint)
                    Spacer(minLength: 12)
                    FailedShare(count: count, failed: errors)
                }
                .font(.subheadline)
                RanText(component: component, environment: environment, firstSeen: firstSeen, lastSeen: lastSeen)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// Where and when a release ran: `notes-api · production · Oct 21, 9:12 – 1:40 PM`.
struct RanText: View {
    let component: String
    let environment: String?
    let firstSeen: Date
    let lastSeen: Date

    var body: some View {
        // The API's last minute ends after its first starts; a range the other way round would trap.
        let ran = min(firstSeen, lastSeen)..<max(firstSeen, lastSeen)
        if let environment {
            Text(
                "\(component) · \(environment) · \(ran, format: .interval.month(.abbreviated).day().hour().minute())",
                bundle: #bundle,
                comment: "Where and when a release ran. The variables are a component, an environment, and a period."
            )
        } else {
            Text(
                "\(component) · \(ran, format: .interval.month(.abbreviated).day().hour().minute())",
                bundle: #bundle,
                comment: "Where and when a release ran. The variables are a component and a period."
            )
        }
    }
}

/// A verdict in words, with what it counts: `Worse: 2 slower, 1 new error`, `About the same`.
struct VerdictText: View {
    let verdict: Verdict
    let slower: Int
    let failingMore: Int
    let newErrors: Int

    var body: some View {
        switch verdict {
        case .worse:
            if reasons.isEmpty {
                Text("Worse", bundle: #bundle, comment: "A release's verdict: something got worse.")
            } else {
                Text(
                    "Worse: \(reasons, format: .list(type: .and, width: .narrow))",
                    bundle: #bundle,
                    comment: "A release's verdict, with what got worse, such as: 2 slower, 1 new error."
                )
            }
        case .better:
            Text("Better", bundle: #bundle, comment: "A release's verdict: something got better, nothing worse.")
        case .same:
            Text("About the same", bundle: #bundle, comment: "A release's verdict: nothing moved enough to tell.")
        case .tooEarly:
            Text("Too early to tell", bundle: #bundle, comment: "A release's verdict: it hasn't run enough yet.")
        case .first:
            Text("First release counted", bundle: #bundle, comment: "A release's verdict: none before it to compare.")
        default:
            Text(
                "A verdict this version can't show. Update the app.",
                bundle: #bundle,
                comment: "A release's verdict of a kind this app doesn't know."
            )
        }
    }

    // What made it worse, each only when there is some.
    private var reasons: [String] {
        var reasons: [String] = []
        if slower > 0 {
            reasons.append(
                String(
                    localized: "\(slower) slower",
                    bundle: #bundle,
                    comment: "How many operations got slower in a release. The variable is a count."
                ))
        }
        if failingMore > 0 {
            reasons.append(
                String(
                    localized: "\(failingMore) failing more",
                    bundle: #bundle,
                    comment: "How many operations fail more in a release. The variable is a count."
                ))
        }
        if newErrors > 0 {
            reasons.append(
                String(
                    AttributedString(
                        localized: "^[\(newErrors) new error](inflect: true)",
                        bundle: #bundle,
                        comment: "How many errors were first seen in a release. The variable is a count."
                    ).characters))
        }
        return reasons
    }
}

extension Verdict {
    /// The symbol a release leads with.
    var symbol: String {
        switch self {
        case .worse: "exclamationmark.triangle.fill"
        case .better: "checkmark.circle.fill"
        case .same: "equal.circle"
        case .tooEarly: "hourglass"
        case .first: "flag"
        default: "questionmark.circle"
        }
    }

    var tint: Color {
        switch self {
        case .worse: .red
        case .better: .green
        default: .secondary
        }
    }
}

/// One release compared with the one before it: what got slower or fails more, its new errors, the
/// incidents while it ran, then what got faster or fails less and what's new in it; each section
/// only when it has something.
struct ReleaseScreen: View {
    let release: ReleaseModel

    var body: some View {
        List {
            if let detail = release.detail.value {
                let summary = detail.summary
                Section {
                    ReleaseHeader(
                        release: summary.release,
                        component: summary.component,
                        environment: summary.environment,
                        previous: summary.previous,
                        firstSeen: summary.firstSeen,
                        lastSeen: summary.lastSeen,
                        count: summary.count,
                        errors: summary.errors,
                        verdict: summary.verdict,
                        slower: summary.slower,
                        failingMore: summary.failingMore,
                        newErrors: summary.newErrors
                    )
                }
                ComparedSection(
                    title: Text("Slower", bundle: #bundle, comment: "Section of the operations a release made slower."),
                    release: release.release,
                    operations: detail.slower,
                    change: .slower
                )
                ComparedSection(
                    title: Text("Fails more", bundle: #bundle, comment: "Section of the operations failing more."),
                    release: release.release,
                    operations: detail.failingMore,
                    change: .failingMore
                )
                if !detail.newErrors.isEmpty {
                    Section {
                        ForEach(detail.newErrors, id: \.id) { group in
                            NavigationLink(value: Route.error(project: release.release.project, id: group.id)) {
                                ErrorGroupRow(
                                    title: group.title, culprit: group.culprit, occurrences: group.occurrences)
                            }
                        }
                    } header: {
                        Text("New errors", bundle: #bundle, comment: "Section of the errors first seen in a release.")
                    }
                }
                if !detail.incidents.isEmpty {
                    Section {
                        ForEach(detail.incidents, id: \.id) { incident in
                            IncidentRow(
                                title: incident.title,
                                openedAt: incident.openedAt,
                                acknowledged: incident.acknowledgedAt != nil,
                                resolvedAt: incident.resolvedAt
                            )
                        }
                    } header: {
                        Text(
                            "Incidents while it ran",
                            bundle: #bundle,
                            comment: "Section of the incidents that opened while a release ran."
                        )
                    }
                }
                ComparedSection(
                    title: Text("Faster", bundle: #bundle, comment: "Section of the operations a release made faster."),
                    release: release.release,
                    operations: detail.faster,
                    change: .faster
                )
                ComparedSection(
                    title: Text("Fails less", bundle: #bundle, comment: "Section of the operations failing less."),
                    release: release.release,
                    operations: detail.failingLess,
                    change: .failingLess
                )
                if !detail.newOperations.isEmpty {
                    Section {
                        ForEach(detail.newOperations, id: \.self) { name in
                            NavigationLink(value: Route.operation(operation(name))) {
                                Text(name)
                                    .lineLimit(2)
                            }
                        }
                    } header: {
                        Text(
                            "New operations",
                            bundle: #bundle,
                            comment: "Section of the operations a release ran that the one before didn't."
                        )
                    }
                }
            }
        }
        .overlay {
            if release.detail.value == nil {
                if release.detail.problem == .missing {
                    ContentUnavailableView {
                        Label {
                            Text("Release not found", bundle: #bundle, comment: "A release the project doesn't count.")
                        } icon: {
                            Image(systemName: "shippingbox")
                        }
                    } description: {
                        Text(
                            "\(release.release.version) of \(release.release.component) wasn't counted: none of its operations ran, or it ran too long ago.",
                            bundle: #bundle,
                            comment: "Why a release isn't found. The variables are its version and its component."
                        )
                    }
                } else {
                    AnswerPlaceholder(problem: release.detail.problem)
                }
            }
        }
        .navigationTitle(Text("Release", bundle: #bundle, comment: "Title of one release."))
        .refreshable { await release.detail.load() }
        .task { await release.detail.load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: release.detail.problem, receivedAt: release.detail.receivedAt)
        }
    }

    private func operation(_ name: String) -> OperationRef {
        OperationRef(
            project: release.release.project,
            component: release.release.component,
            environment: release.release.environment,
            name: name
        )
    }
}

/// The release itself: its version, its verdict and why, what it's compared with, and how much it
/// ran and failed.
struct ReleaseHeader: View {
    let release: String
    let component: String
    let environment: String?
    let previous: String?
    let firstSeen: Date
    let lastSeen: Date
    let count: Int
    let errors: Int
    let verdict: Verdict
    let slower: Int
    let failingMore: Int
    let newErrors: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(verbatim: release)
                .font(.headline.monospaced())
                .textSelection(.enabled)
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    VerdictText(verdict: verdict, slower: slower, failingMore: failingMore, newErrors: newErrors)
                        .foregroundStyle(verdict.tint)
                    VerdictReason(verdict: verdict, component: component)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: verdict.symbol)
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(verdict.tint)
            }
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
                GridRow {
                    Text("Compared with", bundle: #bundle, comment: "The release before the one shown.")
                        .foregroundStyle(.secondary)
                    if let previous {
                        Text(verbatim: previous)
                            .monospaced()
                    } else {
                        Text("No release before it", bundle: #bundle, comment: "A release with none before it.")
                    }
                }
                GridRow {
                    Text("Component", bundle: #bundle, comment: "The component a release is of.")
                        .foregroundStyle(.secondary)
                    Text(verbatim: component)
                }
                if let environment {
                    GridRow {
                        Text("Environment", bundle: #bundle, comment: "Where a release ran, such as production.")
                            .foregroundStyle(.secondary)
                        Text(verbatim: environment)
                    }
                }
                GridRow {
                    Text("Ran", bundle: #bundle, comment: "When a release ran, from its first minute to its last.")
                        .foregroundStyle(.secondary)
                    Text(
                        min(firstSeen, lastSeen)..<max(firstSeen, lastSeen),
                        format: .interval.month(.abbreviated).day().hour().minute()
                    )
                }
                GridRow {
                    Text("Runs", bundle: #bundle, comment: "How many operations a release ran.")
                        .foregroundStyle(.secondary)
                    HStack(spacing: 6) {
                        Text(count, format: .number)
                            .monospacedDigit()
                        FailedShare(count: count, failed: errors)
                    }
                }
            }
            .font(.subheadline)
        }
        .padding(.vertical, 4)
    }
}

/// Why a verdict says what it does, for those whose sections don't show it.
struct VerdictReason: View {
    let verdict: Verdict
    let component: String

    var body: some View {
        switch verdict {
        case .same:
            Text(
                "Nothing moved enough to tell, and no error was first seen in it.",
                bundle: #bundle,
                comment: "Why a release is about the same as the one before."
            )
        case .tooEarly:
            Text(
                "Nothing worse yet, but it ran under an hour, or no operation ran 100 times in it and in the release before.",
                bundle: #bundle,
                comment: "Why it's too early to tell how a release compares."
            )
        case .first:
            Text(
                "No release of \(component) before it was counted, so there's nothing to compare it with.",
                bundle: #bundle,
                comment: "Why a release isn't compared. The variable is its component."
            )
        default:
            EmptyView()
        }
    }
}

/// Operations compared with the release before, in a section of their own when there are any.
struct ComparedSection: View {
    /// What moved: the measure each row shows first, in the colour of its change.
    enum Change {
        case slower, failingMore, faster, failingLess
    }

    let title: Text
    let release: ReleaseRef
    let operations: [ComparedOperation]
    let change: Change

    var body: some View {
        if !operations.isEmpty {
            Section {
                ForEach(operations, id: \.self) { operation in
                    NavigationLink(
                        value: Route.operation(
                            OperationRef(
                                project: release.project,
                                component: release.component,
                                environment: release.environment,
                                name: operation.operation
                            )
                        )
                    ) {
                        ComparedOperationRow(
                            name: operation.operation,
                            p95Ms: operation.p95Ms,
                            previousP95Ms: operation.previousP95Ms,
                            count: operation.count,
                            errors: operation.errors,
                            previousCount: operation.previousCount,
                            previousErrors: operation.previousErrors,
                            change: change
                        )
                    }
                }
            } header: {
                title
            }
        }
    }
}

/// An operation now and in the release before, side by side: `p95  210 ms  was 106 ms`.
struct ComparedOperationRow: View {
    let name: String
    let p95Ms: Double
    let previousP95Ms: Double
    let count: Int
    let errors: Int
    let previousCount: Int
    let previousErrors: Int
    let change: ComparedSection.Change

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(name)
                .lineLimit(2)
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 2) {
                switch change {
                case .slower, .faster:
                    latency(tint)
                    failures(.primary)
                case .failingMore, .failingLess:
                    failures(tint)
                    latency(.primary)
                }
                GridRow {
                    Text("runs", bundle: #bundle, comment: "Label of how many times an operation ran.")
                        .foregroundStyle(.secondary)
                    Text(count, format: .number)
                    Text(
                        "was \(previousCount, format: .number)",
                        bundle: #bundle,
                        comment: "An operation's count in the release before. The variable is a count."
                    )
                    .foregroundStyle(.secondary)
                }
            }
            .font(.subheadline.monospacedDigit())
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    private var tint: Color {
        switch change {
        case .slower, .failingMore: .red
        case .faster, .failingLess: .green
        }
    }

    // Each row's value now, in `style`; before, beside it.
    private func latency(_ style: Color) -> some View {
        GridRow {
            Text(verbatim: "p95")
                .foregroundStyle(.secondary)
            DurationText(milliseconds: p95Ms)
                .fontWeight(.semibold)
                .foregroundStyle(style)
            Text(
                "was \(Duration.milliseconds(previousP95Ms), format: DurationText.style(previousP95Ms))",
                bundle: #bundle,
                comment: "An operation's p95 in the release before. The variable is a duration."
            )
            .foregroundStyle(.secondary)
        }
    }

    private func failures(_ style: Color) -> some View {
        GridRow {
            Text("failed", bundle: #bundle, comment: "Label of the share of an operation's runs that failed.")
                .foregroundStyle(.secondary)
            ShareText(failed: errors, count: count)
                .fontWeight(.semibold)
                .foregroundStyle(style)
            if previousCount > 0 {
                Text(
                    "was \(Double(previousErrors) / Double(previousCount), format: .percent.precision(.fractionLength(0...1)))",
                    bundle: #bundle,
                    comment:
                        "The share of an operation's runs that failed in the release before. The variable is a percentage."
                )
                .foregroundStyle(.secondary)
            } else {
                Text("didn't run before", bundle: #bundle, comment: "An operation with no runs in the release before.")
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// The share of runs that failed, `2.1%`; without runs, there is no share to show.
struct ShareText: View {
    let failed: Int
    let count: Int

    var body: some View {
        if count > 0 {
            Text(Double(failed) / Double(count), format: .percent.precision(.fractionLength(0...1)))
        } else {
            Text("no runs", bundle: #bundle, comment: "An operation that didn't run, so has no failure rate.")
        }
    }
}
