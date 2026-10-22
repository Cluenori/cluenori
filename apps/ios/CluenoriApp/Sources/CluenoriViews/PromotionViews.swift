import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

// A release's promotions, where each one is, on GitHub and in App Store Connect; promoting it by
// one of its component's deploy targets; and releasing one App Store review approved.

/// A release's promotions, the latest first, an approved one with its Release Now; then a button
/// for each of its component's deploy targets; nothing when it has neither.
struct PromotionsSection: View {
    let release: ReleaseModel

    var body: some View {
        let promotions = release.promotions
        let targets = release.deployTargets
        if !promotions.isEmpty || !targets.isEmpty {
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
                ForEach(targets, id: \.environment) { target in
                    Button {
                        release.startPromoting(target)
                    } label: {
                        Label {
                            Text(
                                "Promote to \(target.environment)",
                                bundle: #bundle,
                                comment: "Opens the sheet that promotes a release. The variable is an environment."
                            )
                        } icon: {
                            Image(systemName: "arrow.up.circle")
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
            Spacer(minLength: 8)
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
                Text("Release Now", bundle: #bundle, comment: "Releases a version App Store review approved.")
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

/// Promoting a release by one deploy target: what happens, step by step, where its workflow runs,
/// how an App Store version goes live, the notes it takes, an optional reason, why it didn't start
/// when it didn't, and Cancel and Promote, which shows its progress while it sends. A refusal for
/// missing notes opens the notes editor in the sheet.
struct PromoteSheet: View {
    @Bindable var promote: PromoteModel
    let release: ReleaseModel
    let cancel: () -> Void
    @State private var editsNotes = false

    var body: some View {
        let sending = promote.state == .sending
        NavigationStack {
            Form {
                if case .failed(let problem) = promote.state {
                    Section {
                        PromotionProblemView(problem: problem) {
                            editsNotes = true
                        }
                    }
                }
                Section {
                    PromotionSteps(
                        workflow: promote.target.workflow,
                        repository: promote.repository,
                        appStore: promote.target.appStore,
                        release: promote.release.version,
                        environment: promote.environment
                    )
                } header: {
                    Text("What happens", bundle: #bundle, comment: "Section of what promoting a release does.")
                }
                if promote.target.workflow != nil {
                    RunnerSection(runner: $promote.runner)
                        .disabled(sending)
                }
                if promote.goesToReview {
                    SubmissionSection(releaseType: $promote.releaseType, phased: $promote.phased)
                        .disabled(sending)
                }
                if let appStore = promote.target.appStore {
                    Section {
                        NavigationLink {
                            NotesScreen(release: release)
                        } label: {
                            NotesLinkLabel(
                                distribution: appStore.distribution, locales: release.notes.savedNotes.map(\.locale))
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
            }
            .navigationTitle(
                Text(
                    "Promote to \(promote.environment)",
                    bundle: #bundle,
                    comment: "Title of the sheet that promotes a release. The variable is an environment."
                )
            )
            .navigationDestination(isPresented: $editsNotes) {
                NotesScreen(release: release)
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel, action: cancel) {
                        Text("Cancel", bundle: #bundle, comment: "Closes the promote sheet without promoting.")
                    }
                    .disabled(sending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await promote.send() }
                    } label: {
                        if sending {
                            ProgressView()
                                .accessibilityLabel(
                                    Text("Promoting", bundle: #bundle, comment: "The promote button while it sends.")
                                )
                        } else {
                            Text("Promote", bundle: #bundle, comment: "Promotes a release: starts its deploy target.")
                        }
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(!promote.canSend)
                }
            }
        }
        .interactiveDismissDisabled(sending)
    }
}

/// What promoting by a deploy target does, one step to a row: its workflow on GitHub; then, for an
/// app, TestFlight with the notes as What to Test, or App Store review with them as What's New.
struct PromotionSteps: View {
    let workflow: String?
    let repository: String?
    let appStore: AppStoreTarget?
    let release: String
    let environment: String

    var body: some View {
        if let workflow {
            Label {
                WhatPromotingStarts(
                    workflow: workflow, repository: repository, release: release, environment: environment)
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
/// release 1.4.0+58 and environment production.`; without the repository when the release doesn't
/// name one.
struct WhatPromotingStarts: View {
    let workflow: String
    let repository: String?
    let release: String
    let environment: String

    var body: some View {
        let workflow = Text(verbatim: workflow).monospaced().fontWeight(.semibold)
        let release = Text(verbatim: release).monospaced().fontWeight(.semibold)
        let environment = Text(verbatim: environment).fontWeight(.semibold)
        if let repository {
            let repository = Text(verbatim: repository).fontWeight(.semibold)
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
    }
}

/// Where a promotion's workflow runs: Auto, Your Mac, or Cloud, with what each means.
struct RunnerSection: View {
    @Binding var runner: Runner

    var body: some View {
        Section {
            Picker(selection: $runner) {
                Text("Auto", bundle: #bundle, comment: "A workflow's runner: the Mac when online, else the cloud.")
                    .tag(Runner.auto)
                Text("Your Mac", bundle: #bundle, comment: "A workflow's runner: the founder's own Mac.")
                    .tag(Runner.local)
                Text("Cloud", bundle: #bundle, comment: "A workflow's runner: GitHub's hosted machines.")
                    .tag(Runner.cloud)
            } label: {
                Text("Runs on", bundle: #bundle, comment: "The picker of where a promotion's workflow runs.")
            }
        } footer: {
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
/// deployment's reason for refusing it, with the notes editor when notes are missing; the promotion
/// already in progress with its run; or that nothing was sent.
struct PromotionProblemView: View {
    let problem: PromotionProblem
    /// Opens the release's notes editor, offered when notes are what's missing.
    var writeNotes: (() -> Void)? = nil

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
                    Button(action: writeNotes) {
                        Text("Write the Notes", bundle: #bundle, comment: "Opens a release's notes editor.")
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
