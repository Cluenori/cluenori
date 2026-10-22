import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

// What a release's sources say of it beside its telemetry: its commit and what changed since the
// release before, from GitHub or a deploy report; its build in App Store Connect; and the sources
// that couldn't be read lately.

/// The sources of releases' commits and builds that couldn't be read lately, so a release without
/// one isn't taken for one that has none: over a list of releases, or over one release.
struct SourceProblemsSection: View {
    /// What the problems leave out: the commits and builds of a list of releases, or of one.
    enum Of {
        case releases, release
    }

    let problems: [SourceProblem]
    let of: Of

    var body: some View {
        Section {
            ForEach(problems, id: \.self) { problem in
                SourceProblemRow(
                    component: problem.component, source: problem.source, problem: problem.problem, at: problem.at)
            }
        } header: {
            Text("Couldn't be read lately", bundle: #bundle, comment: "Section of release sources that failed.")
        } footer: {
            switch of {
            case .releases:
                Text(
                    "Until they're read again, releases may lack their commits or builds.",
                    bundle: #bundle,
                    comment: "Below the release sources that failed: what it means for the releases shown."
                )
            case .release:
                Text(
                    "Until they're read again, this release may lack its commit, its changes, or its build.",
                    bundle: #bundle,
                    comment: "Below the sources that failed for one release: what it means for what's shown of it."
                )
            }
        }
    }
}

/// One source that couldn't be read: which, for which component, what it said, and when.
struct SourceProblemRow: View {
    let component: String
    let source: ReleaseSource
    let problem: String
    let at: Date

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(
                    "\(sourceName(source)) for \(component)",
                    bundle: #bundle,
                    comment:
                        "A release source that failed. The variables are a service, such as GitHub, and a component."
                )
                Text(problem)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(4)
                Text(at, format: .dateTime.month(.abbreviated).day().hour().minute())
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A source of releases' facts by its name: GitHub, App Store Connect.
func sourceName(_ source: ReleaseSource) -> String {
    switch source {
    case .github: "GitHub"
    case .appStoreConnect: "App Store Connect"
    default: source.rawValue
    }
}

extension StoreStage {
    /// The symbol of where an app's build stands: TestFlight's plane, review's magnifier, the App
    /// Store's storefront.
    var symbol: String {
        switch self {
        case .processing: "gearshape.2"
        case .failed: "xmark.octagon"
        case .testing, .expired: "airplane"
        case .waitingForReview, .inReview: "magnifyingglass"
        case .rejected: "xmark.seal"
        case .pendingRelease: "clock"
        case .releasing, .live: "storefront"
        default: "app"
        }
    }
}

/// Where an app's build stands in App Store Connect, in words: `In TestFlight`, `In review`,
/// `Phased release, day 3 of 7`, `On the App Store`.
func storeStageWords(_ stage: StoreStage, appStoreState: String?, phased: PhasedRelease?) -> String {
    switch stage {
    case .processing:
        String(localized: "Processing", bundle: #bundle, comment: "A build's store stage: Apple is processing it.")
    case .failed:
        String(localized: "Failed processing", bundle: #bundle, comment: "A build's store stage.")
    case .testing:
        String(localized: "In TestFlight", bundle: #bundle, comment: "A build's store stage. TestFlight is a name.")
    case .waitingForReview:
        String(localized: "Waiting for review", bundle: #bundle, comment: "A build's store stage, in App Review.")
    case .inReview:
        String(localized: "In review", bundle: #bundle, comment: "A build's store stage, in App Review.")
    case .rejected:
        String(localized: "Rejected", bundle: #bundle, comment: "A build's store stage: App Review rejected it.")
    case .pendingRelease:
        String(localized: "Pending release", bundle: #bundle, comment: "A build's store stage: approved, not out.")
    case .releasing:
        phasedReleaseWords(phased)
    case .live:
        String(localized: "On the App Store", bundle: #bundle, comment: "A build's store stage: released.")
    case .replaced:
        String(localized: "Replaced by a later version", bundle: #bundle, comment: "A build's store stage.")
    case .expired:
        String(localized: "TestFlight build expired", bundle: #bundle, comment: "A build's store stage.")
    default:
        // `other`, or a stage from a newer API: Apple's own word, when there is one.
        appStoreState.map(appleWords)
            ?? String(
                localized: "A stage this version can't show",
                bundle: #bundle,
                comment: "A build's store stage of a kind this app doesn't know."
            )
    }
}

// A phased release in words: `Phased release, day 3 of 7`; paused, it says so.
private func phasedReleaseWords(_ phased: PhasedRelease?) -> String {
    let paused = phased?.state == "PAUSED"
    switch (phased?.day, paused) {
    case (let day?, false):
        return String(
            localized: "Phased release, day \(day) of 7",
            bundle: #bundle,
            comment: "A build's store stage: released to more people each day for 7 days. The variable is the day."
        )
    case (let day?, true):
        return String(
            localized: "Phased release paused, day \(day) of 7",
            bundle: #bundle,
            comment: "A build's store stage: its 7-day phased release is paused. The variable is the day."
        )
    case (nil, false):
        return String(localized: "Phased release", bundle: #bundle, comment: "A build's store stage.")
    case (nil, true):
        return String(localized: "Phased release paused", bundle: #bundle, comment: "A build's store stage.")
    }
}

/// Apple's word for a state, `IN_BETA_TESTING`, as people read it: `In beta testing`.
func appleWords(_ state: String) -> String {
    let words = state.replacingOccurrences(of: "_", with: " ").lowercased()
    return words.prefix(1).uppercased() + words.dropFirst()
}

/// A release's commit: its tag, or its short SHA; its message, and who made it when; opening it on
/// GitHub when it can.
struct CommitRow: View {
    let name: String
    /// The short SHA, beside a tag; nil when the name is the SHA.
    let sha: String?
    let message: String?
    let author: String?
    let committedAt: Date?
    let url: URL?

    var body: some View {
        if let url {
            Link(destination: url) {
                content(opens: true)
            }
            .foregroundStyle(.primary)
        } else {
            content(opens: false)
        }
    }

    private func content(opens: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Image(systemName: "arrow.triangle.branch")
                .foregroundStyle(.secondary)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(verbatim: name)
                        .font(.body.monospaced())
                    if let sha {
                        Text(verbatim: sha)
                            .font(.subheadline.monospaced())
                            .foregroundStyle(.secondary)
                    }
                }
                if let subject = message.flatMap(firstLine) {
                    Text(subject)
                        .font(.subheadline)
                        .lineLimit(2)
                }
                ByLine(author: author, at: committedAt)
                    .font(.caption)
                    .foregroundStyle(.secondary)
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
        .accessibilityElement(children: .combine)
    }
}

/// Who did something and when, each when known: `alex · Oct 21, 9:02 AM`.
struct ByLine: View {
    let author: String?
    let at: Date?

    var body: some View {
        switch (author, at) {
        case (let author?, let at?):
            Text(
                "\(author) · \(at, format: .dateTime.month(.abbreviated).day().hour().minute())",
                bundle: #bundle,
                comment: "Who made a commit and when. The variables are a name and a date and time."
            )
        case (let author?, nil):
            Text(verbatim: author)
        case (nil, let at?):
            Text(at, format: .dateTime.month(.abbreviated).day().hour().minute())
        case (nil, nil):
            EmptyView()
        }
    }
}

/// What changed in the repository since the release before: how much, its pull requests, else its
/// commits, newest first, and a link to GitHub's comparison.
struct ChangesSection: View {
    let previous: String?
    let changes: ReleaseChanges
    @State private var showsEveryCommit = false

    // The commits shown before the rest are asked for.
    private static let commitsAtFirst = 10

    var body: some View {
        Section {
            ChangeCounts(
                commits: changes.totalCommits,
                files: changes.filesChanged,
                additions: changes.additions,
                deletions: changes.deletions
            )
            if !changes.pullRequests.isEmpty {
                ForEach(changes.pullRequests, id: \.number) { pullRequest in
                    PullRequestRow(
                        number: pullRequest.number,
                        title: pullRequest.title,
                        author: pullRequest.author,
                        labels: pullRequest.labels,
                        url: URL(webPage: pullRequest.url)
                    )
                }
            } else {
                ForEach(shownCommits, id: \.sha) { commit in
                    ChangedCommitRow(
                        sha: commit.shortSha,
                        message: commit.message,
                        author: commit.author,
                        committedAt: commit.committedAt,
                        url: commit.url.flatMap { URL(webPage: $0) }
                    )
                }
                if shownCommits.count < changes.commits.count {
                    Button {
                        showsEveryCommit = true
                    } label: {
                        Text(
                            "Show all \(changes.commits.count) commits",
                            bundle: #bundle,
                            comment: "Shows every commit listed between two releases. The variable is how many."
                        )
                    }
                }
            }
            if let url = changes.url.flatMap({ URL(webPage: $0) }) {
                Link(destination: url) {
                    Label {
                        Text(
                            "Compare on GitHub", bundle: #bundle, comment: "Opens GitHub's page comparing two releases."
                        )
                    } icon: {
                        Image(systemName: "arrow.up.forward.app")
                    }
                }
            }
        } header: {
            if let previous {
                Text(
                    "Changes since \(previous)",
                    bundle: #bundle,
                    comment: "Section of what changed in a release. The variable is the release before it."
                )
            } else {
                Text("Changes", bundle: #bundle, comment: "Section of what changed in a release.")
            }
        } footer: {
            VStack(alignment: .leading, spacing: 4) {
                if changes.pullRequests.isEmpty && changes.commits.count < changes.totalCommits {
                    Text(
                        "The \(changes.commits.count) newest of \(changes.totalCommits) commits are listed.",
                        bundle: #bundle,
                        comment: "Below a release's commits, when not all are listed. The variables are counts."
                    )
                }
                // Without GitHub's comparison, only a deploy report listed them: what GitHub knows is unknown.
                if changes.url == nil && changes.filesChanged == nil {
                    Text(
                        "As the deploy report listed them. Files and pull requests show once GitHub can be read.",
                        bundle: #bundle,
                        comment: "Below a release's commits known only from its deploy report. GitHub is a name."
                    )
                }
            }
        }
    }

    private var shownCommits: ArraySlice<ChangedCommit> {
        showsEveryCommit ? changes.commits[...] : changes.commits.prefix(Self.commitsAtFirst)
    }
}

/// How much changed: `37 commits · 12 files · +340 −120`, the files and lines when GitHub said.
struct ChangeCounts: View {
    let commits: Int
    let files: Int?
    let additions: Int?
    let deletions: Int?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            if commits == 0 {
                Text("No commits", bundle: #bundle, comment: "Two releases of the same commit.")
            } else {
                // Its plural forms are in the string catalog: inflection takes "commit" for a verb.
                Text(
                    "\(commits) commits",
                    bundle: #bundle,
                    comment: "How many commits a release has since the one before. The variable is a count."
                )
            }
            if let files {
                Text(
                    "^[\(files) file](inflect: true)",
                    bundle: #bundle,
                    comment: "How many files changed since the release before. The variable is a count."
                )
            }
            Spacer(minLength: 0)
            if let additions {
                Text(verbatim: "+\(additions.formatted())")
                    .foregroundStyle(.green)
            }
            if let deletions {
                Text(verbatim: "−\(deletions.formatted())")
                    .foregroundStyle(.red)
            }
        }
        .font(.subheadline.monospacedDigit())
        .accessibilityElement(children: .combine)
    }
}

/// A pull request merged since the release before: its number and title, who opened it, and its
/// labels; opening it on GitHub.
struct PullRequestRow: View {
    let number: Int
    let title: String
    let author: String
    let labels: [String]
    let url: URL?

    var body: some View {
        if let url {
            Link(destination: url) {
                content(opens: true)
            }
            .foregroundStyle(.primary)
        } else {
            content(opens: false)
        }
    }

    private func content(opens: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(verbatim: "#\(number)")
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .lineLimit(2)
                Group {
                    if labels.isEmpty {
                        Text(verbatim: author)
                    } else {
                        Text(verbatim: "\(author) · \(labels.formatted(.list(type: .and, width: .narrow)))")
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
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
        .accessibilityElement(children: .combine)
    }
}

/// A commit since the release before: its message, short SHA, who and when; opening it on GitHub
/// when it can.
struct ChangedCommitRow: View {
    let sha: String
    let message: String
    let author: String
    let committedAt: Date
    let url: URL?

    var body: some View {
        if let url {
            Link(destination: url) {
                content(opens: true)
            }
            .foregroundStyle(.primary)
        } else {
            content(opens: false)
        }
    }

    private func content(opens: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(message)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    Text(verbatim: sha)
                        .monospaced()
                    ByLine(author: author, at: committedAt)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
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
        .accessibilityElement(children: .combine)
    }
}

/// An app's build in App Store Connect: its version and number, where it stands, when it was
/// uploaded, its TestFlight states, its phased release, and when it may be released at the
/// earliest, each when known.
struct StoreSection: View {
    let store: StoreBuild

    var body: some View {
        Section {
            LabeledContent {
                Text(verbatim: "\(store.version) (\(store.buildNumber))")
                    .monospacedDigit()
            } label: {
                Text("Build", bundle: #bundle, comment: "An app build's version and build number.")
            }
            LabeledContent {
                Text(verbatim: storeStageWords(store.stage, appStoreState: store.appStoreState, phased: nil))
            } label: {
                Text("Stage", bundle: #bundle, comment: "Where an app's build stands in App Store Connect.")
            }
            if let phased = store.phasedRelease {
                LabeledContent {
                    PhasedReleaseText(state: phased.state, startedAt: phased.startedAt, day: phased.day)
                } label: {
                    Text("Phased release", bundle: #bundle, comment: "An App Store version's 7-day phased release.")
                }
            }
            LabeledContent {
                Text(store.uploadedAt, format: .dateTime.month(.abbreviated).day().hour().minute())
            } label: {
                Text("Uploaded", bundle: #bundle, comment: "When an app's build was uploaded to App Store Connect.")
            }
            if let internalTesting = store.internalTesting {
                LabeledContent {
                    Text(verbatim: appleWords(internalTesting))
                } label: {
                    Text(
                        "TestFlight, internal",
                        bundle: #bundle,
                        comment: "A build's state for the team's own testers. TestFlight is a name."
                    )
                }
            }
            if let externalTesting = store.externalTesting {
                LabeledContent {
                    Text(verbatim: appleWords(externalTesting))
                } label: {
                    Text(
                        "TestFlight, external",
                        bundle: #bundle,
                        comment: "A build's state for testers outside the team. TestFlight is a name."
                    )
                }
            }
            if let appStoreState = store.appStoreState {
                LabeledContent {
                    Text(verbatim: appleWords(appStoreState))
                } label: {
                    Text(
                        "App Store version", bundle: #bundle, comment: "Apple's state of the version shipping a build.")
                }
            }
            if let earliestReleaseAt = store.earliestReleaseAt {
                LabeledContent {
                    Text(earliestReleaseAt, format: .dateTime.month(.abbreviated).day().hour().minute())
                } label: {
                    Text("Released no earlier than", bundle: #bundle, comment: "When a version may first be released.")
                }
            }
        } header: {
            Text("App Store Connect", bundle: #bundle, comment: "Section of a release's app build. A name, as is.")
        }
    }
}

/// A phased release's progress: `Day 3 of 7`, `Paused on day 3 of 7`, with when it started.
struct PhasedReleaseText: View {
    let state: String
    let startedAt: Date?
    let day: Int?

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            if let day {
                if state == "PAUSED" {
                    Text(
                        "Paused on day \(day) of 7", bundle: #bundle,
                        comment: "A paused phased release. The variable is its day.")
                } else {
                    Text(
                        "Day \(day) of 7", bundle: #bundle,
                        comment: "A phased release's progress. The variable is its day.")
                }
            } else {
                Text(verbatim: appleWords(state))
            }
            if let startedAt {
                Text(
                    "started \(startedAt, format: .dateTime.month(.abbreviated).day())",
                    bundle: #bundle,
                    comment: "When a phased release started. The variable is a date."
                )
                .font(.caption)
                .foregroundStyle(.secondary)
            }
        }
    }
}
