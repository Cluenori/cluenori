import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// The releases of a project that ran, were deployed, or were uploaded over the period, the latest
/// first, each with its verdict against the release before it; the sources of commits and builds
/// that couldn't be read lately; then its components' versions, which its builds are numbered in,
/// and how its release notes read.
struct ReleasesScreen: View {
    let releases: ReleasesModel
    let environments: EnvironmentChoice
    let versions: VersionsModel
    @Bindable var navigation: Navigation
    @State private var bumping: Bumping? = nil
    @State private var setting: VersionLine? = nil

    // The API lists at most this many: a list this long may leave older ones out.
    private static let listedAtMost = 30

    var body: some View {
        List {
            PeriodSection(period: $navigation.period)
            EnvironmentSection(choice: environments, shown: releases.environment, navigation: navigation)
            if let list = releases.list.value {
                if !list.problems.isEmpty {
                    SourceProblemsSection(problems: list.problems, of: .releases)
                    // With the problems on screen, an empty list says so in a row of its own.
                    if list.releases.isEmpty {
                        Section {
                            Text(
                                "No releases in \(periodPhrase(navigation.period)).",
                                bundle: #bundle,
                                comment: "A project had no releases. The variable is a period, such as the last hour."
                            )
                            .foregroundStyle(.secondary)
                            LookFurtherBack(period: $navigation.period)
                        }
                    }
                }
                if list.releases.isEmpty && list.problems.isEmpty {
                    // In the list, not over it, so the versions below stay in reach.
                    Section {
                        NothingInPeriod(
                            title: Text(
                                "No releases", bundle: #bundle, comment: "A project had no releases in the period."),
                            systemImage: "shippingbox",
                            period: $navigation.period,
                            note: Text(
                                "A release shows once a service reports its version in `service.version`, `cluenori-release` reports a deploy, or App Store Connect has a build.",
                                bundle: #bundle,
                                comment:
                                    "What makes releases appear. service.version and cluenori-release are names, as is."
                            )
                        )
                    }
                }
                if !list.releases.isEmpty {
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
            } else {
                Section {
                    AnswerPlaceholder(problem: releases.list.problem)
                }
            }
            VersionsSection(versions: versions, bumping: $bumping, setting: $setting)
            Section {
                NavigationLink(value: Route.notesStyle(project: releases.project)) {
                    Label {
                        Text("Notes Style", bundle: #bundle, comment: "Opens how a project's release notes read.")
                    } icon: {
                        Image(systemName: "text.quote")
                    }
                }
            } footer: {
                Text(
                    "How drafts of release notes read, in the project's own words.",
                    bundle: #bundle,
                    comment: "Below the link to a project's notes style."
                )
            }
        }
        .versionChanges(versions, bumping: $bumping, setting: $setting)
        .navigationTitle(Text("Releases", bundle: #bundle, comment: "Title of every release of a project."))
        .refreshable {
            async let list: Void = releases.list.load()
            async let lines: Void = versions.load()
            _ = await (list, lines)
        }
        .task {
            async let list: Void = releases.list.load()
            async let lines: Void = versions.load()
            _ = await (list, lines)
        }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: releases.list.problem, receivedAt: releases.list.receivedAt)
        }
    }
}

/// A release, leading to its comparison with the release before it; held, it opens its commit on
/// GitHub.
struct ReleaseLink: View {
    let project: String
    let summary: ReleaseSummary

    var body: some View {
        NavigationLink(value: Route.release(summary.ref(in: project))) {
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
                newErrors: summary.newErrors,
                commit: summary.commit?.name,
                store: summary.store,
                deployedAt: summary.deployedAt
            )
        }
        .contextMenu {
            if let url = summary.commit?.url.flatMap({ URL(webPage: $0) }) {
                Link(destination: url) {
                    Label {
                        Text("Open the commit on GitHub", bundle: #bundle, comment: "Opens a release's commit.")
                    } icon: {
                        Image(systemName: "arrow.up.forward.app")
                    }
                }
            }
        }
    }
}

/// One release: its version and verdict, how much it ran and failed, where and when it ran, and its
/// commit, store stage, and deploy, each when known.
struct ReleaseRow: View {
    let release: String
    let component: String
    let environment: String?
    let firstSeen: Date?
    let lastSeen: Date?
    /// Absent without telemetry, as are `errors` and the times.
    let count: Int?
    let errors: Int?
    let verdict: Verdict
    let slower: Int
    let failingMore: Int
    let newErrors: Int
    /// Its tag, else its short SHA.
    let commit: String?
    let store: StoreBuild?
    let deployedAt: Date?

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
                    if let count {
                        Text(count, format: .number)
                            .font(.body.monospacedDigit().weight(.semibold))
                    }
                }
                HStack(alignment: .firstTextBaseline) {
                    VerdictText(verdict: verdict, slower: slower, failingMore: failingMore, newErrors: newErrors)
                        .foregroundStyle(verdict.tint)
                    Spacer(minLength: 12)
                    if let count, let errors {
                        FailedShare(count: count, failed: errors)
                    }
                }
                .font(.subheadline)
                RanText(component: component, environment: environment, firstSeen: firstSeen, lastSeen: lastSeen)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                if let provenance {
                    Text(verbatim: provenance)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    // Where it comes from, each part when known: `v1.4.2 · In TestFlight · deployed Oct 21, 9:10 AM`.
    private var provenance: String? {
        var parts: [String] = []
        if let commit {
            parts.append(commit)
        }
        if let store {
            parts.append(storeStageWords(store.stage, appStoreState: store.appStoreState, phased: store.phasedRelease))
        }
        if let deployedAt {
            parts.append(
                String(
                    localized:
                        "deployed \(deployedAt, format: .dateTime.month(.abbreviated).day().hour().minute())",
                    bundle: #bundle,
                    comment:
                        "When a release was deployed, in a list of facts about it. The variable is a date and time."
                ))
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

/// Where and when a release ran: `notes-api · production · Oct 21, 9:12 – 1:40 PM`; where alone
/// for one without telemetry.
struct RanText: View {
    let component: String
    let environment: String?
    let firstSeen: Date?
    let lastSeen: Date?

    var body: some View {
        if let firstSeen, let lastSeen {
            // The API's last minute ends after its first starts; a range the other way round would trap.
            let ran = min(firstSeen, lastSeen)..<max(firstSeen, lastSeen)
            if let environment {
                Text(
                    "\(component) · \(environment) · \(ran, format: .interval.month(.abbreviated).day().hour().minute())",
                    bundle: #bundle,
                    comment:
                        "Where and when a release ran. The variables are a component, an environment, and a period."
                )
            } else {
                Text(
                    "\(component) · \(ran, format: .interval.month(.abbreviated).day().hour().minute())",
                    bundle: #bundle,
                    comment: "Where and when a release ran. The variables are a component and a period."
                )
            }
        } else if let environment {
            Text(verbatim: "\(component) · \(environment)")
        } else {
            Text(verbatim: component)
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
        case .unmeasured:
            Text("No telemetry yet", bundle: #bundle, comment: "A release's verdict: nothing from it has arrived yet.")
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
        case .unmeasured: "circle.dashed"
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

/// One release compared with the one before it: its promotions and promoting it, what got slower or
/// fails more, its new errors, the incidents while it ran, then what changed since the release before
/// and its store build, then what got faster or fails less and what's new in it; each section only
/// when it has something. Its operations, errors, and logs open narrowed to it. While a promotion
/// hasn't ended, it asks again every 15 seconds.
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
                        newErrors: summary.newErrors,
                        deployedAt: summary.deployedAt,
                        storeStage: summary.store.map {
                            storeStageWords($0.stage, appStoreState: $0.appStoreState, phased: $0.phasedRelease)
                        }
                    )
                    if let commit = summary.commit {
                        CommitRow(
                            name: commit.name,
                            sha: commit.tag == nil ? nil : commit.shortSha,
                            message: commit.message,
                            author: commit.author,
                            committedAt: commit.committedAt,
                            url: commit.url.flatMap { URL(webPage: $0) }
                        )
                    }
                }
                if !detail.problems.isEmpty {
                    SourceProblemsSection(problems: detail.problems, of: .release)
                }
                PromotionsSection(release: release)
                InThisReleaseSection(
                    release: summary.ref(in: release.release.project),
                    notes: release.release,
                    noteLocales: release.notes.savedNotes.map(\.locale)
                )
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
                            NavigationLink(value: Route.error(of: .project(release.release.project), id: group.id)) {
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
                if let changes = detail.changes {
                    ChangesSection(previous: summary.previous, changes: changes)
                }
                if let store = summary.store {
                    StoreSection(store: store)
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
                            Text("Release not found", bundle: #bundle, comment: "A release the project doesn't know.")
                        } icon: {
                            Image(systemName: "shippingbox")
                        }
                    } description: {
                        Text(
                            "\(release.release.version) of \(release.release.component) isn't known: none of its operations ran, no deploy or build of it was reported, or it was too long ago.",
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
        .refreshable { await release.refresh() }
        .task { await release.refresh() }
        // Runs again once a promotion is shown that hasn't ended, as one just started; stops when the
        // screen leaves.
        .task(id: release.hasUnendedPromotions) { await release.followPromotions() }
        .sheet(item: promoting) { promote in
            PromoteSheet(promote: promote, release: release, cancel: release.cancelPromoting)
        }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: release.detail.problem, receivedAt: release.detail.receivedAt)
        }
    }

    // The promote sheet, while the release's model has one open; dismissed, it is cancelled.
    private var promoting: Binding<PromoteModel?> {
        Binding {
            release.promote
        } set: { promote in
            if promote == nil {
                release.cancelPromoting()
            }
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

/// The release itself: its version, its verdict and why, the release before it, how much it ran and
/// failed, and when it was deployed and where its build stands, each when known.
struct ReleaseHeader: View {
    let release: String
    let component: String
    let environment: String?
    let previous: String?
    let firstSeen: Date?
    let lastSeen: Date?
    /// Absent without telemetry, as are `errors` and the times.
    let count: Int?
    let errors: Int?
    let verdict: Verdict
    let slower: Int
    let failingMore: Int
    let newErrors: Int
    let deployedAt: Date?
    /// Where its build stands in App Store Connect, in words; nil for a release without one.
    let storeStage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(verbatim: release)
                .font(.headline.monospaced())
                .textSelection(.enabled)
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    VerdictText(verdict: verdict, slower: slower, failingMore: failingMore, newErrors: newErrors)
                        .foregroundStyle(verdict.tint)
                    VerdictReason(verdict: verdict, release: release, component: component)
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
                    Text("Release before", bundle: #bundle, comment: "The release before the one shown.")
                        .foregroundStyle(.secondary)
                    if let previous {
                        Text(verbatim: previous)
                            .monospaced()
                    } else {
                        Text("None", bundle: #bundle, comment: "A release with no release before it.")
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
                if let firstSeen, let lastSeen {
                    GridRow {
                        Text("Ran", bundle: #bundle, comment: "When a release ran, from its first minute to its last.")
                            .foregroundStyle(.secondary)
                        Text(
                            min(firstSeen, lastSeen)..<max(firstSeen, lastSeen),
                            format: .interval.month(.abbreviated).day().hour().minute()
                        )
                        // Over two days, it takes two lines rather than an ellipsis.
                        .fixedSize(horizontal: false, vertical: true)
                    }
                }
                if let count {
                    GridRow {
                        Text("Runs", bundle: #bundle, comment: "How many operations a release ran.")
                            .foregroundStyle(.secondary)
                        HStack(spacing: 6) {
                            Text(count, format: .number)
                                .monospacedDigit()
                            if let errors {
                                FailedShare(count: count, failed: errors)
                            }
                        }
                    }
                }
                if let deployedAt {
                    GridRow {
                        Text("Deployed", bundle: #bundle, comment: "When a release's deploy was reported.")
                            .foregroundStyle(.secondary)
                        Text(deployedAt, format: .dateTime.month(.abbreviated).day().hour().minute())
                    }
                }
                if let storeStage {
                    GridRow {
                        Text(
                            "App Store", bundle: #bundle,
                            comment: "Where a release's build stands in App Store Connect."
                        )
                        .foregroundStyle(.secondary)
                        Text(verbatim: storeStage)
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
    let release: String
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
        case .unmeasured:
            Text(
                "Nothing it ran has reached Cluenori yet. It's compared once \(component) reports \(release) in `service.version`.",
                bundle: #bundle,
                comment:
                    "Why a release isn't compared yet. The variables are its component and its version; service.version is a name, as is."
            )
        default:
            EmptyView()
        }
    }
}

/// The project's operations, errors, and logs of one release: the screens the app has, narrowed to
/// it; and its notes for its users.
struct InThisReleaseSection: View {
    let release: ReleaseRef
    /// The release whose notes screen opens: the one the screen shows, whose notes it edits.
    let notes: ReleaseRef
    /// The languages it has notes in.
    let noteLocales: [String]

    var body: some View {
        Section {
            NavigationLink(value: Route.operations(of: .release(release))) {
                Label {
                    Text("Operations", bundle: #bundle, comment: "Opens the operations of one release.")
                } icon: {
                    Image(systemName: "chart.bar")
                }
            }
            NavigationLink(value: Route.errors(of: .release(release))) {
                Label {
                    Text("Errors", bundle: #bundle, comment: "Opens the errors of one release.")
                } icon: {
                    Image(systemName: "exclamationmark.octagon")
                }
            }
            NavigationLink(value: Route.logs(of: .release(release))) {
                Label {
                    Text("Logs", bundle: #bundle, comment: "Opens the warnings and errors logged by one release.")
                } icon: {
                    Image(systemName: "text.page")
                }
            }
            NavigationLink(value: Route.notes(notes)) {
                LabeledContent {
                    if noteLocales.isEmpty {
                        Text("None yet", bundle: #bundle, comment: "A release without notes.")
                    } else {
                        Text(verbatim: noteLocales.formatted(.list(type: .and, width: .narrow)))
                    }
                } label: {
                    Label {
                        Text("Release Notes", bundle: #bundle, comment: "Opens a release's notes for its users.")
                    } icon: {
                        Image(systemName: "text.bubble")
                    }
                }
            }
        } header: {
            Text("In this release", bundle: #bundle, comment: "Section of links to one release's telemetry.")
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
