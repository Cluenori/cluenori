import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

// A project's components' versions, which Cluenori numbers every build in: bumped, or set.

/// A version bump waiting for its confirmation.
struct Bumping: Equatable {
    let line: VersionLine
    let bump: VersionBump
    let next: String
}

/// Each of a project's components with its version and next release; tapped, a menu bumps its
/// patch, minor or major, each behind a confirmation, since a version never goes lower, or sets it.
/// The screen presents the confirmation and the sheet (`versionChanges`), outside the lazy list.
struct VersionsSection: View {
    let versions: VersionsModel
    @Binding var bumping: Bumping?
    @Binding var setting: VersionLine?

    var body: some View {
        Section {
            if versions.list.value == nil {
                AnswerPlaceholder(problem: versions.list.problem)
            } else if versions.lines.isEmpty {
                Text("No components yet.", bundle: #bundle, comment: "A project without components, in its versions.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(versions.lines) { line in
                    VersionMenu(line: line, change: versions.changes[line.component]) { bump, next in
                        versions.dismissProblem(of: line.component)
                        bumping = Bumping(line: line, bump: bump, next: next)
                    } set: {
                        versions.dismissProblem(of: line.component)
                        setting = line
                    }
                }
            }
        } header: {
            Text("Versions", bundle: #bundle, comment: "Section of a project's components' versions.")
        } footer: {
            Text(
                "A commit built for the first time becomes the next release, for good. A version can't go lower.",
                bundle: #bundle,
                comment: "How Cluenori numbers releases, below the versions."
            )
        }
    }
}

extension View {
    /// Presents a version bump's confirmation, and the sheet that sets a version, for `versions`.
    func versionChanges(_ versions: VersionsModel, bumping: Binding<Bumping?>, setting: Binding<VersionLine?>)
        -> some View
    {
        modifier(VersionChanges(versions: versions, bumping: bumping, setting: setting))
    }
}

private struct VersionChanges: ViewModifier {
    let versions: VersionsModel
    @Binding var bumping: Bumping?
    @Binding var setting: VersionLine?

    func body(content: Content) -> some View {
        content
            .confirmationDialog(
                String(
                    localized: "Bump the version?", bundle: #bundle,
                    comment: "Title of the confirmation before a version bump."
                ),
                item: $bumping,
                titleVisibility: .visible
            ) { bumping in
                Button {
                    Task { _ = await versions.bump(bumping.line.component, bumping.bump) }
                } label: {
                    Text(
                        "Bump \(bumping.line.name) to \(bumping.next)",
                        bundle: #bundle,
                        comment: "Confirms a version bump. The variables are a component and its next version."
                    )
                }
            } message: { bumping in
                Text(
                    "Its next build becomes \(bumping.next)+\((bumping.line.lastBuild ?? 0) + 1). A version can't go lower again.",
                    bundle: #bundle,
                    comment: "What a version bump does. The variables are a version and a build number."
                )
            }
            .sheet(item: $setting) { line in
                SetVersionSheet(line: line, versions: versions)
            }
    }
}

/// One component's version line, leading to a menu that bumps or sets it: `notes-api`,
/// `1.4.0 · next 1.4.0+58`; while it changes, and why its last change failed.
struct VersionMenu: View {
    let line: VersionLine
    let change: VersionsModel.Change?
    let bump: (VersionBump, String) -> Void
    let set: () -> Void

    var body: some View {
        Menu {
            if let version = line.version {
                ForEach(VersionBump.allCases, id: \.self) { kind in
                    if let next = VersionsModel.next(after: version, kind) {
                        Button {
                            bump(kind, next)
                        } label: {
                            BumpLabel(bump: kind, next: next)
                        }
                    }
                }
                Divider()
            }
            Button(action: set) {
                Text("Set Version…", bundle: #bundle, comment: "Opens the sheet that sets a component's version.")
            }
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: line.name)
                        .foregroundStyle(.primary)
                    if let version = line.version, let next = line.nextRelease {
                        Text(
                            "\(Text(verbatim: version).monospaced()) · next \(Text(verbatim: next).monospaced())",
                            bundle: #bundle,
                            comment: "A component's version and its next release. The variables are as is."
                        )
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    } else {
                        Text(
                            "No version yet, so its builds can't be numbered.",
                            bundle: #bundle,
                            comment: "A component whose version was never set."
                        )
                        .font(.subheadline)
                        .foregroundStyle(.orange)
                    }
                    if case .failed(let problem) = change {
                        VersionProblemText(problem: problem)
                            .font(.subheadline)
                            .foregroundStyle(.red)
                    }
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 8)
                if change == .sending {
                    ProgressView()
                } else {
                    Image(systemName: "ellipsis.circle")
                        .foregroundStyle(Color.accentColor)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(.rect)
        }
        // The row reads as text, not as a tinted button; its symbol says it opens a menu.
        .tint(.primary)
        .disabled(change == .sending)
        .accessibilityElement(children: .combine)
        .accessibilityHint(
            Text("Bumps or sets the version.", bundle: #bundle, comment: "What a component's version row does."))
    }
}

/// A bump in a menu, with the version it makes: `Bump Minor to 1.5.0`.
struct BumpLabel: View {
    let bump: VersionBump
    let next: String

    var body: some View {
        switch bump {
        case .patch:
            Text("Bump Patch to \(next)", bundle: #bundle, comment: "Raises a version's patch. The variable is as is.")
        case .minor:
            Text("Bump Minor to \(next)", bundle: #bundle, comment: "Raises a version's minor. The variable is as is.")
        case .major:
            Text("Bump Major to \(next)", bundle: #bundle, comment: "Raises a version's major. The variable is as is.")
        }
    }
}

/// Why a component's version wasn't set, in words.
struct VersionProblemText: View {
    let problem: VersionProblem

    var body: some View {
        switch problem {
        case .notAVersion:
            Text(
                "A version is MAJOR.MINOR.PATCH, such as 1.4.0.",
                bundle: #bundle,
                comment: "A version typed that isn't one. MAJOR.MINOR.PATCH as is."
            )
        case .notABuildNumber:
            Text(
                "A first build is a whole number from 1.",
                bundle: #bundle,
                comment: "A first build number typed that isn't one."
            )
        case .refused(let reason):
            Text(reason)
        case .unreachable:
            Text(
                "Offline. Not set: try again once online.",
                bundle: #bundle,
                comment: "A version couldn't be set: the deployment didn't answer."
            )
        case .missing:
            Text(
                "Cluenori doesn't know this project any more.",
                bundle: #bundle,
                comment: "A version couldn't be set: the project is gone."
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

/// Setting a component's version, the same or higher than now, and, optionally, where its build
/// numbers continue from, such as above an app's builds numbered before Cluenori numbered them.
struct SetVersionSheet: View {
    let line: VersionLine
    let versions: VersionsModel
    @State private var version: String
    @State private var firstBuild = ""
    @Environment(\.dismiss) private var dismiss

    init(line: VersionLine, versions: VersionsModel) {
        self.line = line
        self.versions = versions
        _version = State(initialValue: line.version ?? "")
    }

    var body: some View {
        let sending = versions.changes[line.component] == .sending
        NavigationStack {
            Form {
                Section {
                    TextField(text: $version, prompt: Text(verbatim: "1.0.0")) {
                        Text("Version", bundle: #bundle, comment: "The field for a component's version.")
                    }
                    .monospaced()
                    .autocorrectionDisabled()
                    #if os(iOS)
                        .keyboardType(.numbersAndPunctuation)
                    #endif
                } header: {
                    Text("Version", bundle: #bundle, comment: "The field for a component's version.")
                } footer: {
                    Text(
                        "MAJOR.MINOR.PATCH, the same or higher than now.",
                        bundle: #bundle,
                        comment: "Below a component's version field. MAJOR.MINOR.PATCH as is."
                    )
                }
                Section {
                    TextField(text: $firstBuild, prompt: Text(verbatim: "\((line.lastBuild ?? 0) + 1)")) {
                        Text("First build", bundle: #bundle, comment: "The field for where build numbers continue.")
                    }
                    .monospacedDigit()
                    #if os(iOS)
                        .keyboardType(.numberPad)
                    #endif
                } header: {
                    Text("First build", bundle: #bundle, comment: "The field for where build numbers continue.")
                } footer: {
                    Text(
                        "Optional. Builds continue from \((line.lastBuild ?? 0) + 1); a higher number continues above an app's builds numbered before Cluenori.",
                        bundle: #bundle,
                        comment: "Below the first build field. The variable is the next build number."
                    )
                }
                if case .failed(let problem) = versions.changes[line.component] {
                    Section {
                        VersionProblemText(problem: problem)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(Text(verbatim: line.name))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) {
                        versions.dismissProblem(of: line.component)
                        dismiss()
                    } label: {
                        Text("Cancel", bundle: #bundle, comment: "Closes a sheet without acting.")
                    }
                    .disabled(sending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task {
                            if await versions.set(line.component, version: version, firstBuild: firstBuild) {
                                dismiss()
                            }
                        }
                    } label: {
                        if sending {
                            ProgressView()
                                .accessibilityLabel(
                                    Text("Setting", bundle: #bundle, comment: "The set button while it sends."))
                        } else {
                            Text("Set", bundle: #bundle, comment: "Sets a component's version.")
                        }
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(sending || version.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .interactiveDismissDisabled(sending)
    }
}
