import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// One component's delivery: its environments as ordered stages, top to bottom, each with the release
/// there now and since when, a promotion under way, and its one next step, which opens the promote
/// sheet; its version, which numbers its builds; the components that ship with it, or the one it
/// ships with; and its every release. While a promotion hasn't ended, it asks again every 15
/// seconds.
struct ComponentScreen: View {
    let delivery: DeliveryModel
    let component: String
    let versions: VersionsModel
    /// A release's model, for the notes the promote sheet opens.
    let release: (ReleaseRef) -> ReleaseModel
    @State private var bumping: Bumping? = nil
    @State private var setting: VersionLine? = nil

    var body: some View {
        let stages = delivery.component(component)
        List {
            if let stages {
                if let shipsWith = stages.shipsWith {
                    ShipsWithSection(
                        project: delivery.project, component: shipsWith, name: delivery.name(of: shipsWith))
                }
                if stages.stages.isEmpty {
                    Section {
                        Text(
                            "No release of \(stages.name) has run anywhere yet.",
                            bundle: #bundle,
                            comment: "A component without environments. The variable is the component."
                        )
                        .foregroundStyle(.secondary)
                    }
                }
                ForEach(Array(stages.stages.enumerated()), id: \.element.id) { index, stage in
                    StageSection(
                        number: index + 1,
                        stage: stage,
                        project: delivery.project,
                        start: { delivery.start($0, of: component) }
                    )
                }
                if !stages.hasDeployTargets && stages.shipsWith == nil && !stages.stages.isEmpty {
                    Section {
                        Text(
                            "\(stages.name) has no deploy targets, so its releases can't be promoted from here. Link its deploy workflow from a terminal: ./cluenori component link",
                            bundle: #bundle,
                            comment:
                                "A component without deploy targets. The variable is the component; ./cluenori component link is a command, as is."
                        )
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    }
                }
                if !stages.parts.isEmpty {
                    PartsSection(project: delivery.project, name: stages.name, parts: stages.parts)
                }
                if stages.shipsWith == nil {
                    ComponentVersionSection(
                        versions: versions, component: component, bumping: $bumping, setting: $setting)
                }
                Section {
                    NavigationLink(value: Route.componentReleases(project: delivery.project, component: component)) {
                        Label {
                            Text("All Releases", bundle: #bundle, comment: "Opens every release of a component.")
                        } icon: {
                            Image(systemName: "clock.arrow.circlepath")
                        }
                    }
                    NavigationLink(value: Route.notesStyle(project: delivery.project)) {
                        Label {
                            Text("Notes Style", bundle: #bundle, comment: "Opens how a project's release notes read.")
                        } icon: {
                            Image(systemName: "text.quote")
                        }
                    }
                }
            }
        }
        .overlay {
            if stages == nil {
                if delivery.answer.value != nil {
                    ContentUnavailableView {
                        Label {
                            Text("Component not found", bundle: #bundle, comment: "A component the project lacks.")
                        } icon: {
                            Image(systemName: "shippingbox")
                        }
                    } description: {
                        Text(
                            "\(component) isn't one of this project's components any more.",
                            bundle: #bundle,
                            comment: "Why a component isn't found. The variable is its key."
                        )
                    }
                } else {
                    AnswerPlaceholder(problem: delivery.answer.problem)
                }
            }
        }
        .navigationTitle(Text(verbatim: stages?.name ?? delivery.name(of: component)))
        .navigationSubtitle(subtitle(stages))
        .versionChanges(versions, bumping: $bumping, setting: $setting)
        .sheet(item: promoting) { promote in
            PromoteSheet(
                promote: promote,
                release: promote.releaseRef.map(release),
                versions: versions,
                cancel: delivery.cancelPromoting
            )
        }
        .refreshable {
            async let delivery: Void = delivery.load()
            async let lines: Void = versions.load()
            _ = await (delivery, lines)
        }
        .task {
            async let delivery: Void = delivery.load()
            async let lines: Void = versions.load()
            _ = await (delivery, lines)
        }
        // Runs again once a promotion is shown that hasn't ended; stops when the screen leaves.
        .task(id: delivery.hasUnendedPromotions) { await delivery.followPromotions() }
        .sensoryFeedback(.impact(weight: .medium), trigger: delivery.lastStarted?.id)
        .sensoryFeedback(trigger: (stages?.stages ?? []).map(StageMark.init)) { before, after in
            // A promotion that ended while the screen showed it: failed, or brought its release.
            let ended = after.compactMap { now in
                before.first { $0.environment == now.environment }.flatMap { $0.ending(now) }
            }
            if ended.contains(false) {
                return .error
            }
            return ended.isEmpty ? nil : .success
        }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: delivery.answer.problem, receivedAt: delivery.answer.receivedAt)
        }
    }

    // How the title's subtitle describes the component: the one it ships with, or its version and
    // next build.
    private func subtitle(_ stages: ComponentStages?) -> Text {
        if let shipsWith = stages?.shipsWith {
            return Text(
                "Ships with \(delivery.name(of: shipsWith))",
                bundle: #bundle,
                comment: "A component deployed by another's deploys. The variable is that component."
            )
        }
        guard let version = stages?.version, let next = stages?.nextRelease else {
            return Text("No version yet", bundle: #bundle, comment: "A component whose version was never set.")
        }
        return Text(
            "Version \(version.version) · next build \(next)",
            bundle: #bundle,
            comment: "A component's version and the release its next build becomes. The variables are as is."
        )
    }

    // A stage as feedback tells a promotion's end: the promotion under way, the one that failed,
    // and the release there.
    private struct StageMark: Equatable {
        let environment: String
        let promotion: String?
        let promoted: String?
        let failed: String?
        let current: String?

        init(_ stage: DeliveryStage) {
            environment = stage.environment
            promotion = stage.promotion?.id
            promoted = stage.promotion?.release
            failed = stage.failed?.id
            current = stage.current?.summary.release
        }

        // How the promotion under way here ended by `now`: false when it failed, true when its
        // release reached the environment; nil while it hasn't ended, or when the delivery doesn't
        // say.
        func ending(_ now: StageMark) -> Bool? {
            guard let promotion, now.promotion == nil else { return nil }
            if now.failed == promotion {
                return false
            }
            return now.current == promoted ? true : nil
        }
    }

    // The promote sheet, while the delivery has one open; dismissed, it is cancelled.
    private var promoting: Binding<PromoteModel?> {
        Binding {
            delivery.promote
        } set: { promote in
            if promote == nil {
                delivery.cancelPromoting()
            }
        }
    }
}

extension PromoteModel {
    /// The release promoted, as its screen opens it; nil for a commit, which has none yet.
    var releaseRef: ReleaseRef? {
        guard case .release(let release) = subject else { return nil }
        return release
    }
}

/// One environment of a component, numbered in the order releases go through them: its name, marked
/// when it's production; the release there now, which opens it; a promotion to it under way, or the
/// last one when it failed; and the one next step, offered again after a failure.
struct StageSection: View {
    let number: Int
    let stage: DeliveryStage
    let project: String
    let start: (DeliveryStep) -> Void

    var body: some View {
        Section {
            if let current = stage.current {
                NavigationLink(value: Route.release(current.summary.ref(in: project))) {
                    CurrentReleaseView(current: current)
                }
            } else {
                Text(
                    "No release in \(stage.environment) yet",
                    bundle: #bundle,
                    comment: "An environment no release reached yet. The variable is the environment."
                )
                .foregroundStyle(.secondary)
                .padding(.vertical, 4)
            }
            if let promotion = stage.promotion {
                PromotionProgressRow(promotion: promotion, project: project)
            } else if let failed = stage.failed {
                FailedPromotionRow(promotion: failed)
            }
            if let next = stage.next {
                NextStepRow(step: next) { start(next) }
            }
        } header: {
            StageHeader(number: number, environment: stage.environment, isProduction: stage.isProduction)
        }
        .headerProminence(.increased)
    }
}

/// A stage's header: its number in the order, its environment, and `Production` for one.
struct StageHeader: View {
    let number: Int
    let environment: String
    let isProduction: Bool

    var body: some View {
        HStack(spacing: 8) {
            // SF Symbols number circles up to 50; past it, the order still reads top to bottom.
            if number <= 50 {
                Image(systemName: "\(number).circle.fill")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
            }
            Text(verbatim: environment)
                .font(.headline)
                .foregroundStyle(.primary)
            if isProduction {
                ProductionTag()
            }
        }
        .textCase(nil)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// The release in an environment now: large, how long it has been there, its commit's first line, its
/// verdict, and, for an app, where its build stands in App Store Connect.
struct CurrentReleaseView: View {
    let current: CurrentRelease

    var body: some View {
        let summary = current.summary
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: summary.release)
                    .font(.title2.monospaced().weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                SinceText(since: current.since)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 4) {
                if let message = summary.commit?.message.flatMap(firstLine) {
                    Fact(symbol: "arrow.triangle.branch") {
                        Text(message)
                            .lineLimit(2)
                    }
                }
                Fact(symbol: summary.verdict.symbol, tint: summary.verdict.tint) {
                    VerdictText(
                        verdict: summary.verdict, slower: summary.slower, failingMore: summary.failingMore,
                        newErrors: summary.newErrors
                    )
                    .foregroundStyle(summary.verdict.tint)
                }
                if let store = summary.store {
                    Fact(symbol: store.stage.symbol) {
                        Text(
                            verbatim: storeStageWords(
                                store.stage, appStoreState: store.appStoreState, phased: store.phasedRelease))
                    }
                }
            }
            .font(.subheadline)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// A commit message's first line, its subject; nil for an empty one.
func firstLine(_ message: String) -> String? {
    let line = message.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: true).first
    return line.map { String($0).trimmingCharacters(in: .whitespaces) }
}

/// One fact about a release, its symbol in a column of its own, so the facts' words line up.
struct Fact<Content: View>: View {
    let symbol: String
    var tint: Color = .secondary
    @ViewBuilder let content: Content
    @ScaledMetric(relativeTo: .subheadline) private var symbolWidth = 20

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: symbol)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(tint)
                .frame(width: symbolWidth)
                .accessibilityHidden(true)
            content
                // As tall as its words need, so a list row never cuts them short.
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// A promotion to an environment under way: what goes where, where it is in words, with a spinner
/// while it moves on its own; its run on GitHub, once known; and, approved in review and waiting, a
/// way to its release, which releases it.
struct PromotionProgressRow: View {
    let promotion: Promotion
    let project: String

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Group {
                if [.waiting, .approved].contains(promotion.state) {
                    Image(systemName: promotion.state.symbol)
                        .foregroundStyle(promotion.state.tint)
                } else {
                    ProgressView()
                }
            }
            .frame(width: 24)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                promotingText(promotion)
                PromotionStateText(state: promotion.state)
                    .font(.subheadline)
                    .foregroundStyle(promotion.state.tint)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        if promotion.state == .approved {
            NavigationLink(value: Route.release(promotion.releaseRef(in: project))) {
                Text(
                    "Release \(promotion.release) on the App Store…",
                    bundle: #bundle,
                    comment: "Opens the release App Review approved, to release it. The variable is a release."
                )
            }
        }
        if let run = promotion.runPage {
            RunLink(run: run)
        }
    }
}

/// The latest promotion to an environment, which failed and left it as it was: how, and its run on
/// GitHub. The stage's next step below offers it again.
struct FailedPromotionRow: View {
    let promotion: Promotion

    var body: some View {
        Fact(symbol: promotion.state.symbol, tint: promotion.state.tint) {
            FailedPromotionText(promotion: promotion)
        }
        .accessibilityElement(children: .combine)
        if let run = promotion.runPage {
            RunLink(run: run)
        }
    }
}

/// Opens a promotion's run on GitHub.
struct RunLink: View {
    let run: URL

    var body: some View {
        Link(destination: run) {
            Label {
                Text("Open the run on GitHub", bundle: #bundle, comment: "Opens a promotion's run. GitHub is a name.")
            } icon: {
                Image(systemName: "arrow.up.forward.app")
            }
        }
    }
}

/// A stage's one next step: a prominent button that says what goes where; for a build, what its
/// commit becomes.
struct NextStepRow: View {
    let step: DeliveryStep
    let action: () -> Void

    var body: some View {
        if case .unknown = step {
            stepTitle(step)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                // A release ready for the next environment is the news; building the latest commit is
                // always there, so it is quieter.
                if case .promote = step {
                    button.buttonStyle(.glassProminent)
                } else {
                    button.buttonStyle(.glass)
                }
                if case .buildLatest(_, let release) = step {
                    Group {
                        if let release {
                            Text(
                                "A new commit becomes \(Text(verbatim: release).monospaced()).",
                                bundle: #bundle,
                                comment: "Below the button that builds the newest commit. The variable is a release."
                            )
                        } else {
                            Text(
                                "Set the version below first: builds are numbered in it.",
                                bundle: #bundle,
                                comment:
                                    "Below the button that builds the newest commit, for a component without a version."
                            )
                        }
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .multilineTextAlignment(.center)
                }
            }
            .padding(.vertical, 4)
        }
    }

    private var button: some View {
        Button(action: { action() }) {
            stepTitle(step)
                .frame(maxWidth: .infinity)
        }
        .controlSize(.large)
    }
}

/// At the top of a component that ships with another: which, leading to it, and what that means.
struct ShipsWithSection: View {
    let project: String
    /// The component it ships with, by key.
    let component: String
    let name: String

    var body: some View {
        Section {
            NavigationLink(value: Route.component(project: project, component: component)) {
                Fact(symbol: "shippingbox") {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(
                            "Ships with \(name)",
                            bundle: #bundle,
                            comment: "A component deployed by another's deploys. The variable is that component."
                        )
                        .font(.headline)
                        Text(
                            "\(name)'s deploys deploy it too, from the same commit with the same release. Promote \(name) to move it on.",
                            bundle: #bundle,
                            comment: "What shipping with another component means. The variables are that component."
                        )
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

/// The components that ship with this one, each leading to its screen.
struct PartsSection: View {
    let project: String
    /// The component's name.
    let name: String
    let parts: [ShippedPart]

    var body: some View {
        Section {
            ForEach(parts) { part in
                NavigationLink(value: Route.component(project: project, component: part.component)) {
                    Label {
                        Text(verbatim: part.name)
                    } icon: {
                        Image(systemName: "shippingbox")
                    }
                }
            }
        } header: {
            Text(
                "Deployed with this component", bundle: #bundle,
                comment: "Section of the components another's deploys deploy too.")
        } footer: {
            Text(
                "Promoting \(name) deploys them too, from the same commit.",
                bundle: #bundle,
                comment: "Below the components that ship with another. The variable is that component."
            )
        }
    }
}

/// A component's version, which its builds are numbered in, bumped or set from a menu.
struct ComponentVersionSection: View {
    let versions: VersionsModel
    let component: String
    @Binding var bumping: Bumping?
    @Binding var setting: VersionLine?

    var body: some View {
        Section {
            if let line = versions.lines.first(where: { $0.component == component }) {
                VersionMenu(line: line, change: versions.changes[line.component]) { bump, next in
                    versions.dismissProblem(of: line.component)
                    bumping = Bumping(line: line, bump: bump, next: next)
                } set: {
                    versions.dismissProblem(of: line.component)
                    setting = line
                }
            } else {
                AnswerPlaceholder(problem: versions.list.problem)
            }
        } header: {
            Text("Version", bundle: #bundle, comment: "Section of a component's version.")
        } footer: {
            Text(
                "A commit built for the first time becomes the next release, for good. A version can't go lower.",
                bundle: #bundle,
                comment: "How Cluenori numbers releases, below the versions."
            )
        }
    }
}
