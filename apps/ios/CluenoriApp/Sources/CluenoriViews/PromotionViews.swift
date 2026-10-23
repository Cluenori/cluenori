import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

// A release's promotions, where each one is, on GitHub and in App Store Connect; promoting by a
// deploy target, as the promote sheet does; and releasing one App Store review approved.

/// A release's promotions, the latest first, an approved one with its Release Now; nothing when it
/// has none.
struct PromotionsSection: View {
    let release: ReleaseModel

    var body: some View {
        let promotions = release.promotions
        if !promotions.isEmpty {
            Section {
                ForEach(promotions, id: \.id) { promotion in
                    PromotionRow(
                        environment: promotion.environment,
                        state: promotion.state,
                        startedAt: promotion.startedAt,
                        yours: release.isYours(promotion),
                        reason: promotion.reason,
                        run: promotion.runPage
                    )
                    if promotion.state == .approved {
                        ReleaseNowRow(
                            release: promotion.release,
                            phased: promotion.submission?.phased ?? true,
                            state: release.releasingNow[promotion.id]
                        ) {
                            await release.releaseNow(promotion)
                        }
                    }
                }
            } header: {
                Text("Promotions", bundle: #bundle, comment: "Section of a release's promotions to environments.")
            }
        }
    }
}

/// One promotion: where to, where it is, when it started and whether you started it, and why;
/// opening its run on GitHub once the run is known.
struct PromotionRow: View {
    let environment: String
    let state: PromotionState
    let startedAt: Date
    /// Whether the member the phone acts for started it.
    let yours: Bool
    let reason: String?
    let run: URL?

    var body: some View {
        if let run {
            Link(destination: run) {
                content(opens: true)
            }
            .foregroundStyle(.primary)
        } else {
            content(opens: false)
        }
    }

    private func content(opens: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: state.symbol)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(state.tint)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: environment)
                PromotionStateText(state: state)
                    .font(.subheadline)
                    .foregroundStyle(state.tint)
                Group {
                    let started = startedAt.formatted(.relative(presentation: .named))
                    if yours {
                        Text(
                            "You started it \(started)",
                            bundle: #bundle,
                            comment:
                                "When you started a promotion. The variable is a relative time, such as 3 minutes ago."
                        )
                    } else {
                        Text(
                            "Started \(started)",
                            bundle: #bundle,
                            comment: "When a promotion started. The variable is a relative time, such as 3 minutes ago."
                        )
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                if let reason {
                    Text(reason)
                        .font(.subheadline)
                        .lineLimit(3)
                }
            }
            // The words take the row's width, so they wrap only when they must.
            .frame(maxWidth: .infinity, alignment: .leading)
            if opens {
                Image(systemName: "arrow.up.forward")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// Below a promotion App Store review approved, which waits for a member: Release Now, behind a
/// confirmation, and its progress while it's sent; once sent, the promotion says it's releasing.
struct ReleaseNowRow: View {
    let release: String
    /// Whether it goes live over 7 days.
    let phased: Bool
    let state: ReleaseModel.ReleaseNow?
    let action: () async -> Void
    @State private var isConfirming = false

    var body: some View {
        switch state {
        case .sending:
            HStack(spacing: 12) {
                ProgressView()
                Text("Releasing…", bundle: #bundle, comment: "While an approved version is being released.")
                    .foregroundStyle(.secondary)
            }
        case .failed(let problem):
            VStack(alignment: .leading, spacing: 8) {
                PromotionProblemView(problem: problem)
                button
            }
        case nil:
            button
        }
    }

    private var button: some View {
        Button {
            isConfirming = true
        } label: {
            Label {
                Text(
                    "Release \(release) on the App Store",
                    bundle: #bundle,
                    comment: "Releases a version App Store review approved. The variable is a release."
                )
            } icon: {
                Image(systemName: "paperplane.fill")
            }
        }
        .confirmationDialog(
            Text(
                "Release \(release) on the App Store?",
                bundle: #bundle,
                comment: "Confirms releasing an approved version. The variable is a release."
            ),
            isPresented: $isConfirming,
            titleVisibility: .visible
        ) {
            Button {
                Task { await action() }
            } label: {
                Text("Release Now", bundle: #bundle, comment: "Releases a version App Store review approved.")
            }
        } message: {
            if phased {
                Text(
                    "It goes live to more people each day over 7 days.",
                    bundle: #bundle,
                    comment: "What releasing an approved version with a phased release does."
                )
            } else {
                Text(
                    "It goes live to everyone at once.",
                    bundle: #bundle,
                    comment: "What releasing an approved version without a phased release does."
                )
            }
        }
    }
}

/// Where a promotion is, in words: `Running`, `In App Store review`.
struct PromotionStateText: View {
    let state: PromotionState

    var body: some View {
        switch state {
        case .starting:
            Text("Starting", bundle: #bundle, comment: "A promotion's state: GitHub took it, its run isn't known yet.")
        case .queued:
            Text("Queued", bundle: #bundle, comment: "A promotion's state: its run waits for a runner.")
        case .waiting:
            Text(
                "Waiting for approval on GitHub",
                bundle: #bundle,
                comment: "A promotion's state: someone must approve its environment on GitHub."
            )
        case .running:
            Text("Running", bundle: #bundle, comment: "A promotion's state: its run is running.")
        case .processing:
            Text(
                "Processing in App Store Connect",
                bundle: #bundle,
                comment: "A promotion's state: Apple is processing its build. App Store Connect is a name."
            )
        case .inReview:
            Text("In App Store review", bundle: #bundle, comment: "A promotion's state: submitted to App Review.")
        case .releasing:
            Text(
                "Releasing on the App Store",
                bundle: #bundle,
                comment: "A promotion's state: a member released it, and App Store Connect is making it live."
            )
        case .approved:
            Text(
                "Approved",
                bundle: #bundle,
                comment: "A promotion's state: App Review approved it, and it waits to be released."
            )
        case .succeeded:
            Text("Succeeded", bundle: #bundle, comment: "A promotion's state: it's deployed, or live.")
        case .failed:
            Text("Failed", bundle: #bundle, comment: "A promotion's state: its run, or its build's processing, failed.")
        case .cancelled:
            Text("Cancelled", bundle: #bundle, comment: "A promotion's state: its run was cancelled.")
        case .rejected:
            Text("Rejected in review", bundle: #bundle, comment: "A promotion's state: App Review rejected it.")
        case .lost:
            Text(
                "Not followed, see GitHub",
                bundle: #bundle,
                comment: "A promotion's state: its run or build wasn't found, or didn't end in time. GitHub is a name."
            )
        default:
            Text(
                "A state this version can't show. Update the app.",
                bundle: #bundle,
                comment: "A promotion's state of a kind this app doesn't know."
            )
        }
    }
}

extension PromotionState {
    /// The symbol a promotion leads with: orange when it waits for a person, blue while it moves on
    /// its own.
    var symbol: String {
        switch self {
        case .starting: "circle.dotted"
        case .queued: "clock"
        case .waiting: "hand.raised.fill"
        case .running: "arrow.triangle.2.circlepath"
        case .processing: "gearshape.2"
        case .inReview: "magnifyingglass"
        case .approved: "checkmark.seal"
        case .releasing: "paperplane"
        case .succeeded: "checkmark.circle.fill"
        case .failed: "xmark.octagon.fill"
        case .cancelled: "slash.circle"
        case .rejected: "xmark.seal.fill"
        case .lost: "eye.slash"
        default: "questionmark.circle"
        }
    }

    var tint: Color {
        switch self {
        case .succeeded: .green
        case .failed, .rejected: .red
        case .waiting, .approved: .orange
        case .running, .processing, .inReview, .releasing: .blue
        default: .secondary
        }
    }
}

/// Promoting by one deploy target: a release, or a component's newest commit, which the deployment
/// numbers as its next release. Its main path: what goes where, and what it replaces there; what
/// happens, step by step; for an app, how an approved version goes live and the notes it takes; an
/// optional reason; and, at the bottom, the one button that says what it does, `Promote 1.0.0+3 to
/// prod`, which shows its progress while it sends. Collapsed below the reason, the options a
/// promotion rarely needs: where its workflow runs, and another commit to build. Above it all, why
/// it didn't start when it didn't: a refusal for missing notes opens the notes editor in the sheet,
/// and one for a missing version the version's.
struct PromoteSheet: View {
    @Bindable var promote: PromoteModel
    /// The release promoted, whose notes the sheet opens; nil for a commit, which has none yet.
    let release: ReleaseModel?
    /// The project's versions, set from the sheet when a commit can't be numbered; a release has its
    /// number, so needs none.
    let versions: VersionsModel?
    let cancel: () -> Void
    @State private var editsNotes = false
    @State private var setsVersion = false
    @State private var showsOptions = false

    var body: some View {
        let sending = promote.state == .sending
        NavigationStack {
            Form {
                if case .failed(let problem) = promote.state {
                    Section {
                        PromotionProblemView(
                            problem: problem,
                            writeNotes: release == nil ? nil : { editsNotes = true },
                            setVersion: versionLine == nil ? nil : { setsVersion = true }
                        )
                    }
                }
                PromoteSummarySection(
                    promote: promote,
                    component: release?.delivery.name(of: promote.component) ?? promote.component,
                    nextRelease: versionLine?.nextRelease
                )
                if case .latestCommit = promote.subject, promote.targets.count > 1 {
                    LatestCommitTargetSection(promote: promote)
                        .disabled(sending)
                }
                Section {
                    PromotionSteps(
                        workflow: promote.target.workflow,
                        repository: promote.repository,
                        appStore: promote.target.appStore,
                        release: promote.releaseVersion,
                        commit: promote.isCommitValid ? promote.commitSha : nil,
                        environment: promote.environment
                    )
                } header: {
                    Text("What happens", bundle: #bundle, comment: "Section of what promoting a release does.")
                }
                if promote.goesToReview {
                    SubmissionSection(releaseType: $promote.releaseType, phased: $promote.phased)
                        .disabled(sending)
                }
                if let appStore = promote.target.appStore {
                    if let release {
                        Section {
                            NavigationLink {
                                NotesScreen(release: release)
                            } label: {
                                NotesLinkLabel(
                                    distribution: appStore.distribution,
                                    locales: release.notes.savedNotes.map(\.locale))
                            }
                        } footer: {
                            if promote.goesToReview {
                                Text(
                                    "App Store review needs notes in each of the app's languages.",
                                    bundle: #bundle,
                                    comment: "Below the notes a release goes to App Store review with."
                                )
                            }
                        }
                    } else if promote.goesToReview {
                        Section {
                            Text(
                                "App Store review needs the release's notes, which can be written once it's built: promote it to TestFlight first, unless it's the app's first version.",
                                bundle: #bundle,
                                comment:
                                    "Promoting a commit straight to App Store review: it has no release, so no notes, yet. TestFlight is a name."
                            )
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        }
                    }
                }
                Section {
                    TextField(text: $promote.reason, axis: .vertical) {
                        Text("Reason", bundle: #bundle, comment: "The field for why a release is promoted.")
                    }
                    .lineLimit(2...6)
                    .disabled(sending)
                } header: {
                    Text("Reason", bundle: #bundle, comment: "The field for why a release is promoted.")
                } footer: {
                    if promote.reasonExcess > 0 {
                        Text(
                            "^[\(promote.reasonExcess) character](inflect: true) too long: a reason has at most \(PromoteModel.reasonLimit).",
                            bundle: #bundle,
                            comment: "Below a reason that is too long. The variables are counts of characters."
                        )
                        .foregroundStyle(.red)
                    } else {
                        Text(
                            "Optional. Kept with the promotion, for everyone who sees the project.",
                            bundle: #bundle,
                            comment: "Below the field for why a release is promoted."
                        )
                    }
                }
                PromoteOptionsSection(promote: promote, isExpanded: $showsOptions)
                    .disabled(sending)
            }
            .navigationTitle(title)
            .navigationDestination(isPresented: $editsNotes) {
                if let release {
                    NotesScreen(release: release)
                }
            }
            .navigationDestination(isPresented: $setsVersion) {
                if let versions, let versionLine {
                    SetVersionForm(line: versionLine, versions: versions, cancel: nil) {
                        setsVersion = false
                    }
                }
            }
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel, action: cancel) {
                        Text("Cancel", bundle: #bundle, comment: "Closes the promote sheet without promoting.")
                    }
                    .disabled(sending)
                }
            }
            .safeAreaBar(edge: .bottom) {
                Button {
                    Task { await promote.send() }
                } label: {
                    Group {
                        if sending {
                            HStack(spacing: 8) {
                                ProgressView()
                                Text("Promoting…", bundle: #bundle, comment: "The promote button while it sends.")
                            }
                        } else {
                            PromoteButtonTitle(promote: promote)
                        }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .disabled(!promote.canSend)
                .padding(.horizontal)
                .padding(.bottom, 8)
            }
        }
        .interactiveDismissDisabled(sending)
        // The release's notes, which an app's promotion takes, when its screen never asked for them.
        .task {
            if let release, release.detail.value == nil {
                await release.refresh()
            }
        }
        .sensoryFeedback(trigger: promote.state) { _, state in
            if case .failed = state { .error } else { nil }
        }
    }

    private var title: Text {
        switch promote.subject {
        case .release:
            if promote.replacing?.isRollback == true {
                Text(
                    "Roll Back \(promote.environment)",
                    bundle: #bundle,
                    comment:
                        "Title of the sheet that deploys an older release to an environment. The variable is the environment."
                )
            } else {
                Text(
                    "Promote to \(promote.environment)",
                    bundle: #bundle,
                    comment: "Title of the sheet that promotes a release. The variable is an environment."
                )
            }
        case .latestCommit:
            Text(
                "Build Latest Commit",
                bundle: #bundle,
                comment: "Title of the sheet that builds and deploys a component's newest commit."
            )
        }
    }

    // The version line of the component whose commit is promoted, which Set Version changes.
    private var versionLine: VersionLine? {
        guard case .latestCommit(_, let component) = promote.subject else { return nil }
        return versions?.lines.first { $0.component == component }
    }
}

/// What the promote sheet's button does, in full: `Promote 1.0.0+3 to prod`, `Roll back prod to
/// 1.0.0+1`, `Build latest commit for internal`.
struct PromoteButtonTitle: View {
    let promote: PromoteModel

    var body: some View {
        if let release = promote.releaseVersion {
            if promote.replacing?.isRollback == true {
                Text(
                    "Roll back \(promote.environment) to \(release)",
                    bundle: #bundle,
                    comment:
                        "Deploys an older release to an environment. The variables are the environment and the release."
                )
            } else {
                Text(
                    "Promote \(release) to \(promote.environment)",
                    bundle: #bundle,
                    comment: "Promotes a release to an environment. The variables are a release and an environment."
                )
            }
        } else if let commit = promote.isCommitValid ? promote.commitSha : nil {
            Text(
                "Build \(String(commit.prefix(7))) for \(promote.environment)",
                bundle: #bundle,
                comment:
                    "Builds a commit and deploys it to an environment. The variables are a short SHA and an environment."
            )
        } else {
            Text(
                "Build latest commit for \(promote.environment)",
                bundle: #bundle,
                comment:
                    "Builds the default branch's newest commit and deploys it to an environment. The variable is the environment."
            )
        }
    }
}

/// At the top of the promote sheet, what goes where: the release, large, or the latest commit and
/// what it becomes; the component, from where to where; and what it replaces there, warning when
/// that rolls the environment back.
struct PromoteSummarySection: View {
    let promote: PromoteModel
    /// The component's name.
    let component: String
    /// What a new commit becomes, for a commit; nil for a release, or a component without a version.
    let nextRelease: String?

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: component)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                    if let release = promote.releaseVersion {
                        Text(verbatim: release)
                            .unhyphenated()
                            .font(.title.monospaced().weight(.bold))
                            .lineLimit(2)
                            .minimumScaleFactor(0.6)
                    } else {
                        Text("Latest commit", bundle: #bundle, comment: "The commit a build promotes, as a title.")
                            .font(.title.weight(.bold))
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    Fact(symbol: "arrow.right") {
                        destination
                    }
                    if let replacing = promote.replacing {
                        Fact(
                            symbol: replacing.isRollback ? "arrow.uturn.backward" : "arrow.2.squarepath",
                            tint: replacing.isRollback ? .orange : .secondary
                        ) {
                            ReplacingText(replacing: replacing, environment: promote.environment)
                        }
                    }
                    if promote.releaseVersion == nil, let nextRelease {
                        Fact(symbol: "number") {
                            Text(
                                "A new commit becomes \(Text(verbatim: nextRelease).monospaced()); one built before is the same release again.",
                                bundle: #bundle,
                                comment: "What a built commit becomes. The variable is a release."
                            )
                        }
                    }
                }
                .font(.subheadline)
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .combine)
        }
    }

    @ViewBuilder private var destination: some View {
        let to = Text(verbatim: promote.environment).fontWeight(.semibold)
        if case .release(let release) = promote.subject, let from = release.environment, from != promote.environment {
            Text(
                "From \(from) to \(to)",
                bundle: #bundle,
                comment: "Where a promotion goes, from where. The variables are environments."
            )
        } else {
            Text("To \(to)", bundle: #bundle, comment: "Where a promotion goes. The variable is an environment.")
        }
    }
}

/// What a promotion replaces in its environment, in a sentence: `Replaces 1.0.0+2, there since
/// 1:57 PM.`; for an older release, that it rolls the environment back.
struct ReplacingText: View {
    let replacing: PromoteModel.Replacing
    let environment: String

    var body: some View {
        let release = Text(verbatim: replacing.release).monospaced()
        if replacing.isRollback {
            Text(
                "Rolls \(environment) back from \(release), the newer release there since \(reachedText(replacing.since)).",
                bundle: #bundle,
                comment:
                    "What deploying an older release replaces. The variables are an environment, the release there now, and a time or day."
            )
            .foregroundStyle(.orange)
        } else {
            Text(
                "Replaces \(release), in \(environment) since \(reachedText(replacing.since)).",
                bundle: #bundle,
                comment:
                    "What a promotion replaces. The variables are the release there now, an environment, and a time or day."
            )
        }
    }
}

/// For a component's newest commit with several deploy targets that build it: the environment it
/// goes to.
struct LatestCommitTargetSection: View {
    @Bindable var promote: PromoteModel

    var body: some View {
        Section {
            Picker(selection: $promote.target) {
                ForEach(promote.targets, id: \.self) { target in
                    Text(verbatim: target.environment).tag(target)
                }
            } label: {
                Text("Environment", bundle: #bundle, comment: "The picker of where a commit is promoted to.")
            }
        }
    }
}

/// What a promotion rarely needs changed, collapsed below its reason: where its workflow runs, Auto
/// unless chosen, and, for a commit, which one, the default branch's newest unless typed; each with
/// what it means. Nothing for a promotion with neither. Collapsed, it says when the commit typed
/// isn't one.
struct PromoteOptionsSection: View {
    @Bindable var promote: PromoteModel
    @Binding var isExpanded: Bool

    var body: some View {
        let isCommit = promote.releaseVersion == nil
        if promote.target.workflow != nil || isCommit {
            Section {
                DisclosureGroup(isExpanded: $isExpanded) {
                    if promote.target.workflow != nil {
                        RunnerOption(runner: $promote.runner)
                    }
                    if isCommit {
                        CommitOption(promote: promote)
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Options", bundle: #bundle, comment: "Opens what a promotion rarely needs changed.")
                        if !promote.isCommitValid && !isExpanded {
                            Text(
                                "The commit isn't a full SHA.", bundle: #bundle,
                                comment: "Below the collapsed options, when the commit typed isn't one."
                            )
                            .font(.footnote)
                            .foregroundStyle(.red)
                        }
                    }
                }
            }
        }
    }
}

/// Where a promotion's workflow runs: Auto, Your Mac, or Cloud, with what the one chosen means.
struct RunnerOption: View {
    @Binding var runner: Runner

    var body: some View {
        Picker(selection: $runner) {
            Text("Auto", bundle: #bundle, comment: "A workflow's runner: the Mac when online, else the cloud.")
                .tag(Runner.auto)
            Text("Your Mac", bundle: #bundle, comment: "A workflow's runner: the founder's own Mac.")
                .tag(Runner.local)
            Text("Cloud", bundle: #bundle, comment: "A workflow's runner: GitHub's hosted machines.")
                .tag(Runner.cloud)
        } label: {
            VStack(alignment: .leading, spacing: 2) {
                Text("Runs on", bundle: #bundle, comment: "The picker of where a promotion's workflow runs.")
                Group {
                    switch runner {
                    case .local:
                        Text(
                            "Your Mac's runner. The run waits while your Mac is offline.",
                            bundle: #bundle,
                            comment: "What the Your Mac runner means."
                        )
                    case .cloud:
                        Text(
                            "The repository's hosted runners, in the cloud.",
                            bundle: #bundle,
                            comment: "What the Cloud runner means."
                        )
                    default:
                        Text(
                            "Your Mac when it's online, else the cloud.",
                            bundle: #bundle,
                            comment: "What the Auto runner means."
                        )
                    }
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
            }
        }
    }
}

/// For a component's newest commit: another commit to build in its place, by its full SHA, with
/// what it means, or why what's typed isn't one.
struct CommitOption: View {
    @Bindable var promote: PromoteModel

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField(
                text: $promote.commit,
                prompt: Text("Newest on the default branch", bundle: #bundle, comment: "An empty commit field.")
            ) {
                Text("Commit", bundle: #bundle, comment: "The field for the commit to promote.")
            }
            .monospaced()
            .autocorrectionDisabled()
            #if os(iOS)
                .textInputAutocapitalization(.never)
            #endif
            Group {
                if promote.isCommitValid {
                    Text(
                        "Optional: a full commit SHA. A commit promoted before is the same release again.",
                        bundle: #bundle,
                        comment: "Below the field for the commit to promote."
                    )
                    .foregroundStyle(.secondary)
                } else {
                    Text(
                        "A full commit SHA has 40 characters, 0 to 9 and a to f.",
                        bundle: #bundle,
                        comment: "Below a commit typed that isn't a full SHA."
                    )
                    .foregroundStyle(.red)
                }
            }
            .font(.footnote)
        }
    }
}

/// What promoting by a deploy target does, one step to a row: its workflow on GitHub, for a commit
/// once it's numbered; then, for an app, TestFlight with the notes as What to Test, or App Store
/// review with them as What's New.
struct PromotionSteps: View {
    let workflow: String?
    let repository: String?
    let appStore: AppStoreTarget?
    /// The release promoted; nil for a commit, numbered as its component's next.
    let release: String?
    /// The commit promoted, when one is typed; nil for the default branch's newest.
    let commit: String?
    let environment: String

    var body: some View {
        if let workflow {
            Label {
                WhatPromotingStarts(
                    workflow: workflow, repository: repository, release: release, commit: commit,
                    environment: environment)
            } icon: {
                Image(systemName: "gearshape.2")
                    .foregroundStyle(.secondary)
            }
        }
        if let appStore {
            let app = Text(verbatim: appStore.bundleId).monospaced().fontWeight(.semibold)
            Label {
                if appStore.distribution == .appStore {
                    Text(
                        "Once App Store Connect has processed its build, \(app) goes to App Store review, with the release's notes as What's New.",
                        bundle: #bundle,
                        comment:
                            "What promoting to the App Store does. The variable is an app's bundle ID. App Store Connect and What's New are names."
                    )
                } else {
                    Text(
                        "Once App Store Connect has processed its build, testers of \(app) get it in TestFlight, with the release's notes as What to Test.",
                        bundle: #bundle,
                        comment:
                            "What promoting to TestFlight does. The variable is an app's bundle ID. App Store Connect, TestFlight and What to Test are names."
                    )
                }
            } icon: {
                Image(systemName: appStore.distribution == .appStore ? "checkmark.seal" : "airplane")
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// What a promotion's workflow starts on GitHub: `Starts deploy.yml in acme/notes on GitHub, with
/// release 1.4.0+58 and environment production.`; for a commit, numbered first as the next release;
/// without the repository when the release doesn't name one.
struct WhatPromotingStarts: View {
    let workflow: String
    let repository: String?
    /// Nil for a commit.
    let release: String?
    /// The commit typed, for a commit; nil for the default branch's newest.
    let commit: String?
    let environment: String

    var body: some View {
        let workflow = Text(verbatim: workflow).monospaced().fontWeight(.semibold)
        let environment = Text(verbatim: environment).fontWeight(.semibold)
        let repository = repository.map { Text(verbatim: $0).fontWeight(.semibold) }
        if let release {
            let release = Text(verbatim: release).monospaced().fontWeight(.semibold)
            if let repository {
                Text(
                    "Starts \(workflow) in \(repository) on GitHub, with release \(release) and environment \(environment).",
                    bundle: #bundle,
                    comment:
                        "What promoting a release does. The variables are a workflow's file, a repository, a release, and an environment. GitHub is a name."
                )
            } else {
                Text(
                    "Starts \(workflow) on GitHub, with release \(release) and environment \(environment).",
                    bundle: #bundle,
                    comment:
                        "What promoting a release does. The variables are a workflow's file, a release, and an environment. GitHub is a name."
                )
            }
        } else {
            let promoted =
                commit.map {
                    Text(
                        "commit \(Text(verbatim: String($0.prefix(7))).monospaced().fontWeight(.semibold))",
                        bundle: #bundle,
                        comment: "A commit, inside a sentence. The variable is its short SHA."
                    )
                }
                ?? Text(
                    "the newest commit on the default branch",
                    bundle: #bundle,
                    comment: "The commit promoted when none is typed, inside a sentence."
                )
            if let repository {
                Text(
                    "Numbers \(promoted) as the next release, then starts \(workflow) in \(repository) on GitHub with it and environment \(environment).",
                    bundle: #bundle,
                    comment:
                        "What promoting a commit does. The variables are a commit, a workflow's file, a repository, and an environment. GitHub is a name."
                )
            } else {
                Text(
                    "Numbers \(promoted) as the next release, then starts \(workflow) on GitHub with it and environment \(environment).",
                    bundle: #bundle,
                    comment:
                        "What promoting a commit does. The variables are a commit, a workflow's file, and an environment. GitHub is a name."
                )
            }
        }
    }
}

/// How a version App Store review approves goes live: when approved, or when released here; and
/// whether over 7 days.
struct SubmissionSection: View {
    @Binding var releaseType: AppStoreReleaseType
    @Binding var phased: Bool

    var body: some View {
        Section {
            Picker(selection: $releaseType) {
                Text("Release when approved", bundle: #bundle, comment: "Goes live as soon as App Review approves it.")
                    .tag(AppStoreReleaseType.afterApproval)
                Text("Release manually", bundle: #bundle, comment: "Waits, once approved, for a member to release it.")
                    .tag(AppStoreReleaseType.manual)
            } label: {
                Text("Release", bundle: #bundle, comment: "The picker of when an approved version goes live.")
            }
            .pickerStyle(.inline)
            .labelsHidden()
            Toggle(isOn: $phased) {
                Text("Phased over 7 days", bundle: #bundle, comment: "Releases to more people each day for 7 days.")
            }
        } header: {
            Text("App Store", bundle: #bundle, comment: "Section of how a version goes live on the App Store.")
        } footer: {
            if releaseType == .manual {
                Text(
                    "Once approved, it waits for you to release it from this release.",
                    bundle: #bundle,
                    comment: "What releasing manually means."
                )
            } else {
                Text(
                    "It goes live as soon as App Review approves it.",
                    bundle: #bundle,
                    comment: "What releasing when approved means. App Review is a name."
                )
            }
        }
    }
}

/// The notes a promotion to an app takes, leading to their editor: What's New for the App Store,
/// What to Test for TestFlight, with the languages saved, or none yet.
struct NotesLinkLabel: View {
    let distribution: AppStoreDistribution
    let locales: [String]

    var body: some View {
        LabeledContent {
            if locales.isEmpty {
                Text("None yet", bundle: #bundle, comment: "A release without notes.")
            } else {
                Text(verbatim: locales.formatted(.list(type: .and, width: .narrow)))
            }
        } label: {
            if distribution == .appStore {
                Text("What's New", bundle: #bundle, comment: "An App Store version's notes. A name, as Apple calls it.")
            } else {
                Text("What to Test", bundle: #bundle, comment: "A TestFlight build's notes. A name, as Apple calls it.")
            }
        }
    }
}

/// Why a promotion didn't start, or an approved one wasn't released, and what to do: the
/// deployment's reason for refusing it, with the notes editor when notes are missing, or the
/// version's when the component has none; the promotion already in progress with its run; or that
/// nothing was sent.
struct PromotionProblemView: View {
    let problem: PromotionProblem
    /// Opens the release's notes editor, offered when notes are what's missing.
    var writeNotes: (() -> Void)? = nil
    /// Opens the component's version, offered when a commit can't be numbered without one.
    var setVersion: (() -> Void)? = nil

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 6) {
                message
                if case .inProgress(let promotion) = problem, let run = promotion.runPage {
                    Link(destination: run) {
                        Text("Open its run on GitHub", bundle: #bundle, comment: "Opens a promotion's run.")
                    }
                }
                if case .refused(_, .notes) = problem, let writeNotes {
                    Button(action: { writeNotes() }) {
                        Text("Write the Notes", bundle: #bundle, comment: "Opens a release's notes editor.")
                    }
                    .buttonStyle(.borderless)
                }
                if case .refused(_, .version) = problem, let setVersion {
                    Button(action: { setVersion() }) {
                        Text(
                            "Set Version…", bundle: #bundle, comment: "Opens the sheet that sets a component's version."
                        )
                    }
                    .buttonStyle(.borderless)
                }
            }
        } icon: {
            Image(systemName: symbol)
                .foregroundStyle(.orange)
        }
    }

    private var symbol: String {
        switch problem {
        case .inProgress: "hourglass"
        case .unreachable: "wifi.exclamationmark"
        default: "exclamationmark.triangle.fill"
        }
    }

    @ViewBuilder private var message: some View {
        switch problem {
        case .refused(let reason, _):
            Text(reason)
        case .inProgress(let promotion):
            VStack(alignment: .leading, spacing: 2) {
                Text(
                    "Already promoting \(Text(verbatim: promotion.release).monospaced()) to \(promotion.environment).",
                    bundle: #bundle,
                    comment:
                        "A promotion can't start while another of the component to that environment hasn't ended. The variables are a release and an environment."
                )
                PromotionStateText(state: promotion.state)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        case .unavailable:
            Text(
                "GitHub or App Store Connect didn't answer, so nothing happened. Try again.",
                bundle: #bundle,
                comment: "A promotion or release didn't happen: a service was unavailable. The services are names."
            )
        case .notWaitingForRelease:
            Text(
                "It isn't waiting to be released any more.",
                bundle: #bundle,
                comment: "Releasing an approved version failed: it was released, or is no longer approved."
            )
        case .unreachable:
            Text(
                "Offline. Cluenori didn't answer, and nothing waits to be sent: try again once online.",
                bundle: #bundle,
                comment: "An action couldn't be sent: the deployment didn't answer. It isn't kept to send later."
            )
        case .missing:
            Text(
                "Cluenori doesn't know this release any more, so it can't be promoted.",
                bundle: #bundle,
                comment: "A promotion couldn't start: the release or its project is gone."
            )
        case .unreadable:
            Text(
                "Cluenori answered in a way this version doesn't understand. Update the app.",
                bundle: #bundle,
                comment: "The deployment's answer couldn't be read."
            )
        }
    }
}
