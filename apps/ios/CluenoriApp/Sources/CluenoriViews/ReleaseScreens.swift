import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// The releases of a project in the environment it shows, or of one component in every environment,
/// that ran, were deployed, or were uploaded over the period, the latest first, each with its verdict
/// against the release before it; and the sources of commits and builds that couldn't be read lately.
struct ReleasesScreen: View {
    let releases: ReleasesModel
    let environments: EnvironmentChoice
    /// What people call the component shown, for one component's releases.
    var componentName: String? = nil
    @Bindable var navigation: Navigation

    // The API lists at most this many: a list this long may leave older ones out.
    private static let listedAtMost = 30

    var body: some View {
        List {
            PeriodSection(period: $navigation.period)
            // One component's releases are every environment's: each row says where it ran.
            if releases.component == nil {
                EnvironmentSection(choice: environments, shown: releases.environment, navigation: navigation)
            }
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
        }
        .navigationTitle(Text("Releases", bundle: #bundle, comment: "Title of every release of a project."))
        .navigationSubtitle(ifAny: componentName.map { Text(verbatim: $0) })
        .refreshable { await releases.list.load() }
        .task { await releases.list.load() }
        .answerBanner(problem: releases.list.problem, receivedAt: releases.list.receivedAt)
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
                        .unhyphenated()
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

/// One release: what it is and where it runs now, with the one step that moves it on when its
/// delivery says it is next somewhere, and deploying it anywhere else in a menu; then its promotions,
/// then the answer to whether it works: its verdict and its life beside the release before's, its
/// life step by step, its errors and warnings, and its requests that moved; then what changed since
/// the release before, the incidents while it ran, its notes and its store build. Its numbers open
/// its operations, errors, and logs narrowed to it, and "Ask an agent" shares a brief of it. Each
/// section shows only when it has something. While a promotion hasn't ended, it asks again every 15
/// seconds.
struct ReleaseScreen: View {
    let release: ReleaseModel

    var body: some View {
        let places = release.places
        List {
            if let detail = release.detail.value {
                let summary = detail.summary
                Section {
                    ReleaseHeadline(
                        component: release.delivery.name(of: summary.component),
                        release: summary.release,
                        places: places
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
                    if let next = places?.next {
                        NextStepRow(step: next) { release.startPromoting(to: next.environment) }
                    }
                    if let page = detail.gitHubRelease.flatMap({ URL(webPage: $0.url) }) {
                        Link(destination: page) {
                            Label {
                                Text(
                                    "Release on GitHub", bundle: #bundle,
                                    comment: "Opens a release's page on its repository's Releases page.")
                            } icon: {
                                Image(systemName: "arrow.up.forward.app")
                            }
                        }
                    }
                }
                if !detail.problems.isEmpty {
                    SourceProblemsSection(problems: detail.problems, of: .release)
                }
                // A promotion still moving is the news; once they have ended, they follow the answer.
                if release.hasUnendedPromotions {
                    PromotionsSection(release: release)
                }
                let ref = summary.ref(in: release.release.project)
                ReleaseAnswerSection(summary: summary, life: detail.life, ref: ref)
                if !release.hasUnendedPromotions {
                    PromotionsSection(release: release)
                }
                if let life = detail.life {
                    ReleaseLifeSection(life: life)
                }
                if detail.life != nil || !detail.errors.isEmpty {
                    ReleaseErrorsSection(
                        errors: detail.errors, release: summary.release, warnings: detail.life?.totals.warnings,
                        ref: ref)
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
                if let changes = detail.changes {
                    ChangesSection(previous: summary.previous, changes: changes)
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
                NotesSection(release: release.release, locales: release.notes.savedNotes.map(\.locale))
                if let store = summary.store {
                    StoreSection(store: store)
                }
            } else if !release.promotions.isEmpty {
                // A commit just promoted from this phone: the deployment knows its release once its
                // workflow reports a deploy, or its build reaches App Store Connect.
                Section {
                    Text(verbatim: release.release.version)
                        .font(.headline.monospaced())
                        .textSelection(.enabled)
                } footer: {
                    Text(
                        "Cluenori shows this release once its workflow reports a deploy, or its build reaches App Store Connect. Until then its promotion shows as it started.",
                        bundle: #bundle,
                        comment: "A release just numbered and promoted, which the deployment doesn't list yet."
                    )
                }
                PromotionsSection(release: release)
            }
        }
        .overlay {
            if release.detail.value == nil && release.promotions.isEmpty {
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
        .navigationTitle(Text(verbatim: release.release.version))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            if let detail = release.detail.value {
                ToolbarItem(placement: .primaryAction) {
                    AskAnAgent(brief: releaseBrief(project: release.release.project, detail: detail))
                }
            }
            if let others = places?.otherDeploys, !others.isEmpty {
                ToolbarItem(placement: .primaryAction) {
                    OtherDeploysMenu(deploys: others) { release.startPromoting(to: $0) }
                }
            }
        }
        .refreshable { await release.refresh() }
        .task { await release.refresh() }
        .sensoryFeedback(.impact(weight: .medium), trigger: release.lastStarted?.id)
        .sensoryFeedback(trigger: release.promotions.map(PromotionEnd.init)) { before, after in
            // A promotion that ended while the screen showed it: how.
            let ended = after.filter { end in
                end.hasEnded && before.contains { $0.id == end.id && !$0.hasEnded }
            }
            if ended.contains(where: { !$0.succeeded }) {
                return .error
            }
            return ended.isEmpty ? nil : .success
        }
        // Runs again once a promotion is shown that hasn't ended, as one just started; stops when the
        // screen leaves.
        .task(id: release.hasUnendedPromotions) { await release.followPromotions() }
        .sheet(item: promoting) { promote in
            PromoteSheet(promote: promote, release: release, versions: nil, cancel: release.cancelPromoting)
        }
        .answerBanner(problem: release.detail.problem, receivedAt: release.detail.receivedAt)
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

/// What a release is and where it is now: its component, its version, large, and the environments
/// it is in, with what it hasn't reached yet: `In dev since 1:57 PM · not in prod yet`.
struct ReleaseHeadline: View {
    /// The component's name.
    let component: String
    let release: String
    /// Nil until its delivery arrives.
    let places: ReleasePlaces?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: component)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(.secondary)
                Text(verbatim: release)
                    .unhyphenated()
                    .font(.title.monospaced().weight(.bold))
                    .lineLimit(2)
                    .minimumScaleFactor(0.6)
                    .textSelection(.enabled)
            }
            if let places {
                Fact(symbol: "mappin.and.ellipse") {
                    WhereText(places: places)
                }
                .font(.subheadline)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// Where a release runs now, in a sentence: `In dev since 1:57 PM · not in prod yet`,
/// `In dev and prod`, `Not in any environment now`.
struct WhereText: View {
    let places: ReleasePlaces

    var body: some View {
        let promoting = places.promoting.map(\.environment)
        if let only = places.here.first, places.here.count == 1 {
            let here = Text(
                "In \(only.environment) since \(reachedText(only.since))",
                bundle: #bundle,
                comment: "Where a release runs now, and since when. The variables are an environment and a time or day."
            )
            .foregroundStyle(.primary)
            rest(after: here, promoting: promoting)
        } else if !places.here.isEmpty {
            let here = Text(
                "In \(places.here.map(\.environment).formatted(.list(type: .and)))",
                bundle: #bundle,
                comment: "The environments a release runs in now. The variable is a list of environments."
            )
            .foregroundStyle(.primary)
            rest(after: here, promoting: promoting)
        } else if !promoting.isEmpty {
            Text(
                "Promoting to \(promoting.formatted(.list(type: .and)))",
                bundle: #bundle,
                comment: "A release in no environment yet, being promoted. The variable is a list of environments."
            )
        } else if !places.notYet.isEmpty {
            Text(
                "Not in any environment yet",
                bundle: #bundle,
                comment: "A release that hasn't reached any environment of its component."
            )
        } else {
            Text(
                "Not in any environment now: newer releases replaced it",
                bundle: #bundle,
                comment: "An older release that no environment of its component runs any more."
            )
        }
    }

    // Where it is, then where it's going or hasn't reached.
    @ViewBuilder private func rest(after here: Text, promoting: [String]) -> some View {
        if !promoting.isEmpty {
            Text(
                "\(here) · promoting to \(promoting.formatted(.list(type: .and)))",
                bundle: #bundle,
                comment:
                    "Where a release runs now, and where it is being promoted. The variables are where, and a list of environments."
            )
        } else if !places.notYet.isEmpty {
            Text(
                "\(here) · not in \(places.notYet.formatted(.list(type: .and))) yet",
                bundle: #bundle,
                comment:
                    "Where a release runs now, and where it hasn't reached yet. The variables are where, and a list of environments."
            )
        } else {
            here
        }
    }
}

/// Deploying a release outside the usual order, in a menu of its own: to each other environment with
/// a deploy target, `Deploy to prod (roll back)` for an older release than the one there.
struct OtherDeploysMenu: View {
    let deploys: [ReleasePlaces.OtherDeploy]
    let deploy: (String) -> Void

    var body: some View {
        Menu {
            Section {
                ForEach(deploys) { other in
                    Button {
                        deploy(other.environment)
                    } label: {
                        Label {
                            if other.isRollback {
                                Text(
                                    "Deploy to \(other.environment) (roll back)",
                                    bundle: #bundle,
                                    comment:
                                        "Deploys an older release than the one in an environment. The variable is the environment."
                                )
                            } else {
                                Text(
                                    "Deploy to \(other.environment)",
                                    bundle: #bundle,
                                    comment:
                                        "Deploys a release to an environment outside the usual order. The variable is the environment."
                                )
                            }
                            if let replacing = other.replacing {
                                Text(
                                    "Replaces \(replacing.summary.release)",
                                    bundle: #bundle,
                                    comment: "What deploying a release replaces. The variable is the release there now."
                                )
                            }
                        } icon: {
                            Image(systemName: other.isRollback ? "arrow.uturn.backward" : "arrow.up.right")
                        }
                    }
                }
            } header: {
                Text(
                    "Outside the usual order", bundle: #bundle,
                    comment: "Heads the menu that deploys a release to another environment.")
            }
        } label: {
            Label {
                Text(
                    "Deploy Elsewhere", bundle: #bundle,
                    comment: "The menu that deploys a release to other environments.")
            } icon: {
                Image(systemName: "ellipsis")
            }
        }
    }
}

/// A promotion as feedback tells its ending apart: ended or not, and succeeded or not.
struct PromotionEnd: Equatable {
    let id: String
    let hasEnded: Bool
    let succeeded: Bool

    init(_ promotion: Promotion) {
        id = promotion.id
        hasEnded = promotion.hasEnded
        succeeded = promotion.succeeded
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

/// A release's notes for its users: the languages it has them in, opening its notes screen.
struct NotesSection: View {
    let release: ReleaseRef
    /// The languages it has notes in.
    let locales: [String]

    var body: some View {
        Section {
            NavigationLink(value: Route.notes(release)) {
                LabeledContent {
                    if locales.isEmpty {
                        Text("None yet", bundle: #bundle, comment: "A release without notes.")
                    } else {
                        Text(verbatim: locales.formatted(.list(type: .and, width: .narrow)))
                    }
                } label: {
                    Label {
                        Text("Release Notes", bundle: #bundle, comment: "Opens a release's notes for its users.")
                    } icon: {
                        Image(systemName: "text.bubble")
                    }
                }
            }
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
