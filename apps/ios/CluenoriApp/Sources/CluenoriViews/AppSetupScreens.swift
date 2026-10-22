import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

// One app component's setup: its version policy, which says which releases must update, and its
// SDK keys, which its builds carry.

/// One component's version policy: its minimum and recommended versions, store page, minimum OS,
/// and the project's words; or none. Set and cleared from its menu, each sent once.
struct VersionPolicyScreen: View {
    let policies: VersionPolicyModel
    let component: String
    /// What people call the component.
    let name: String
    @State private var setting = false
    @State private var clearing = false

    var body: some View {
        let change = policies.changes[component]
        List {
            if policies.policies.value != nil {
                if let policy = policies.policy(of: component) {
                    VersionPolicySections(
                        minimum: policy.minimum, recommended: policy.recommended, storeUrl: policy.storeUrl,
                        minimumOsVersion: policy.minimumOsVersion, words: policy.words, setAt: policy.setAt)
                } else {
                    Section {
                        NoVersionPolicy()
                    }
                }
                if case .failed(let problem) = change, !setting {
                    Section {
                        VersionPolicyProblemText(problem: problem)
                            .foregroundStyle(.red)
                    }
                }
            }
        }
        .overlay {
            if policies.policies.value == nil {
                AnswerPlaceholder(problem: policies.policies.problem)
            }
        }
        .navigationTitle(Text("Version policy", bundle: #bundle, comment: "Title of a component's version policy."))
        .navigationSubtitle(Text(verbatim: name))
        .toolbar {
            if policies.policies.value != nil {
                ToolbarItem(placement: .primaryAction) {
                    if change == .sending {
                        ProgressView()
                    } else {
                        Menu {
                            Button {
                                policies.dismissProblem(of: component)
                                setting = true
                            } label: {
                                Label {
                                    Text(
                                        "Set Policy…", bundle: #bundle,
                                        comment: "Opens the sheet that sets a version policy.")
                                } icon: {
                                    Image(systemName: "pencil")
                                }
                            }
                            if policies.policy(of: component) != nil {
                                Button(role: .destructive) {
                                    clearing = true
                                } label: {
                                    Label {
                                        Text(
                                            "Clear Policy…", bundle: #bundle,
                                            comment: "Removes a version policy, after a confirmation.")
                                    } icon: {
                                        Image(systemName: "trash")
                                    }
                                }
                            }
                        } label: {
                            Label {
                                Text(
                                    "Change", bundle: #bundle, comment: "The menu that sets or clears a version policy."
                                )
                            } icon: {
                                Image(systemName: "ellipsis")
                            }
                        }
                    }
                }
            }
        }
        .confirmationDialog(
            String(
                localized: "Clear the version policy?", bundle: #bundle,
                comment: "Title of the confirmation before clearing a version policy."),
            isPresented: $clearing,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { _ = await policies.clear(component) }
            } label: {
                Text("Clear Policy", bundle: #bundle, comment: "Confirms clearing a version policy.")
            }
        } message: {
            Text(
                "No release of \(name) is asked to update any more, once apps read it again, within five minutes.",
                bundle: #bundle,
                comment: "What clearing a version policy does. The variable is a component."
            )
        }
        .sheet(isPresented: $setting) {
            SetVersionPolicySheet(
                policies: policies, component: component, name: name, current: policies.policy(of: component))
        }
        .refreshable { await policies.load() }
        .task { await policies.load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: policies.policies.problem, receivedAt: policies.policies.receivedAt)
        }
    }
}

/// A component without a version policy.
struct NoVersionPolicy: View {
    var body: some View {
        Label {
            Text(
                "No version policy: no release is asked to update.", bundle: #bundle,
                comment: "A component without a version policy.")
        } icon: {
            Image(systemName: "checkmark.shield")
                .foregroundStyle(.secondary)
        }
    }
}

/// A version policy's sections: its versions and what each makes a release do, where to update,
/// and the project's words.
struct VersionPolicySections: View {
    let minimum: String?
    let recommended: String?
    let storeUrl: String
    let minimumOsVersion: String?
    let words: [UpdateWords]
    let setAt: Date

    var body: some View {
        Section {
            if let minimum {
                PolicyVersionRow(
                    title: Text("Minimum", bundle: #bundle, comment: "A version policy's minimum version."),
                    version: minimum,
                    meaning: Text(
                        "Releases below it must update", bundle: #bundle,
                        comment: "What a version policy's minimum does."))
            }
            if let recommended {
                PolicyVersionRow(
                    title: Text("Recommended", bundle: #bundle, comment: "A version policy's recommended version."),
                    version: recommended,
                    meaning: Text(
                        "Releases below it are offered it, in a sheet people can close", bundle: #bundle,
                        comment: "What a version policy's recommended version does."))
            }
        } footer: {
            Text(
                "In the project's production environments. Apps read it within five minutes. Set \(setAt, format: .dateTime.month(.abbreviated).day().hour().minute()).",
                bundle: #bundle,
                comment:
                    "Below a version policy: where it applies, how soon, and when it was set. The variable is a date and time."
            )
        }
        Section {
            if let url = URL(webPage: storeUrl) {
                Link(destination: url) {
                    LabeledContent {
                        Text(verbatim: url.host() ?? storeUrl)
                            .unhyphenated()
                    } label: {
                        Text("Store page", bundle: #bundle, comment: "Where a version policy sends people to update.")
                    }
                }
            } else {
                LabeledContent {
                    Text(verbatim: storeUrl)
                        .unhyphenated()
                        .textSelection(.enabled)
                } label: {
                    Text("Store page", bundle: #bundle, comment: "Where a version policy sends people to update.")
                }
            }
            if let minimumOsVersion {
                LabeledContent {
                    Text(verbatim: minimumOsVersion)
                        .monospacedDigit()
                } label: {
                    Text(
                        "Minimum OS", bundle: #bundle,
                        comment: "The oldest OS the release to update to runs on.")
                }
            }
        } footer: {
            if minimumOsVersion != nil {
                Text(
                    "A device on an older OS isn't asked to update: it can't install the update.", bundle: #bundle,
                    comment: "Below a version policy's minimum OS: what it does.")
            }
        }
        Section {
            if words.isEmpty {
                Text(
                    "The SDK's own words.", bundle: #bundle,
                    comment: "A version policy without the project's words: the app shows the SDK's."
                )
                .foregroundStyle(.secondary)
            }
            ForEach(words, id: \.self) { words in
                UpdateWordsRow(
                    locale: words.locale, decision: words.decision, title: words.text.title,
                    message: words.text.message)
            }
        } header: {
            Text("Words", bundle: #bundle, comment: "Section of what the app says when it asks to update.")
        }
    }
}

/// One version of a policy, with what it makes a release do.
struct PolicyVersionRow: View {
    let title: Text
    let version: String
    let meaning: Text

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            TitleAndValue {
                title
            } value: {
                Text(verbatim: version)
                    .unhyphenated()
                    .font(.body.monospacedDigit().weight(.semibold))
            }
            meaning
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The project's words for one decision in one language: `en-US · Must update`, its title and
/// message.
struct UpdateWordsRow: View {
    let locale: String
    let decision: UpdateWordsDecision
    let title: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Group {
                switch decision {
                case .require:
                    Text(
                        "\(locale) · must update", bundle: #bundle,
                        comment: "Words shown when a release must update. The variable is a language, such as en-US.")
                case .recommend:
                    Text(
                        "\(locale) · offered an update", bundle: #bundle,
                        comment: "Words shown when a release is offered an update. The variable is a language.")
                default:
                    Text(verbatim: "\(locale) · \(decision.rawValue)")
                }
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
            Text(message)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

/// Why a version policy wasn't set or cleared, in words.
struct VersionPolicyProblemText: View {
    let problem: VersionPolicyProblem

    var body: some View {
        switch problem {
        case .noVersion:
            Text(
                "Give a minimum version, a recommended one, or both.", bundle: #bundle,
                comment: "A version policy sent without either version.")
        case .notAVersion:
            Text(
                "A version is one to four numbers, such as 0.4.0.", bundle: #bundle,
                comment: "A version typed in a version policy that isn't one.")
        case .notAStorePage:
            Text(
                "A store page is an https link, such as https://apps.apple.com/app/id….", bundle: #bundle,
                comment: "A store page typed that isn't one. The link is an example, as is.")
        case .refused(let reason):
            Text(reason)
        case .unreachable:
            Text(
                "Offline. Not changed: try again once online.", bundle: #bundle,
                comment: "A version policy couldn't be changed: the deployment didn't answer.")
        case .missing:
            Text(
                "Cluenori doesn't know this project any more.", bundle: #bundle,
                comment: "A version policy couldn't be changed: the project is gone.")
        case .unreadable:
            Text(
                "Cluenori answered in a way this version doesn't understand. Update the app.", bundle: #bundle,
                comment: "The deployment's answer couldn't be read.")
        }
    }
}

/// Setting a component's version policy, in a sheet: its versions, store page and minimum OS; its
/// words stay as they are.
struct SetVersionPolicySheet: View {
    let policies: VersionPolicyModel
    let component: String
    let name: String
    @State private var minimum: String
    @State private var recommended: String
    @State private var storePage: String
    @State private var minimumOS: String
    @Environment(\.dismiss) private var dismiss

    init(policies: VersionPolicyModel, component: String, name: String, current: ComponentVersionPolicy?) {
        self.policies = policies
        self.component = component
        self.name = name
        _minimum = State(initialValue: current?.minimum ?? "")
        _recommended = State(initialValue: current?.recommended ?? "")
        _storePage = State(initialValue: current?.storeUrl ?? "")
        _minimumOS = State(initialValue: current?.minimumOsVersion ?? "")
    }

    var body: some View {
        let sending = policies.changes[component] == .sending
        NavigationStack {
            Form {
                Section {
                    versionField($minimum, prompt: "0.2.0") {
                        Text("Minimum", bundle: #bundle, comment: "A version policy's minimum version.")
                    }
                    versionField($recommended, prompt: "0.3.1") {
                        Text("Recommended", bundle: #bundle, comment: "A version policy's recommended version.")
                    }
                } footer: {
                    Text(
                        "Releases below the minimum must update; those below the recommended are offered it. Either may be empty.",
                        bundle: #bundle,
                        comment: "Below a version policy's versions: what they do."
                    )
                }
                Section {
                    TextField(text: $storePage, prompt: Text(verbatim: "https://apps.apple.com/app/id…")) {
                        Text("Store page", bundle: #bundle, comment: "Where a version policy sends people to update.")
                    }
                    .autocorrectionDisabled()
                    #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                    #endif
                    versionField($minimumOS, prompt: "26.0") {
                        Text(
                            "Minimum OS", bundle: #bundle, comment: "The oldest OS the release to update to runs on.")
                    }
                } footer: {
                    Text(
                        "Empty store page: the App Store page App Store Connect has for the app. Its words stay as they are; change them on the web.",
                        bundle: #bundle,
                        comment: "Below a version policy's store page and minimum OS."
                    )
                }
                if case .failed(let problem) = policies.changes[component] {
                    Section {
                        VersionPolicyProblemText(problem: problem)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle(Text(verbatim: name))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) {
                        policies.dismissProblem(of: component)
                        dismiss()
                    } label: {
                        Text("Cancel", bundle: #bundle, comment: "Closes a sheet without acting.")
                    }
                    .disabled(sending)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task {
                            if await policies.set(
                                component, minimum: minimum, recommended: recommended, storePage: storePage,
                                minimumOS: minimumOS)
                            {
                                dismiss()
                            }
                        }
                    } label: {
                        if sending {
                            ProgressView()
                                .accessibilityLabel(
                                    Text("Setting", bundle: #bundle, comment: "The set button while it sends."))
                        } else {
                            Text("Set", bundle: #bundle, comment: "Sets a version policy.")
                        }
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(sending)
                }
            }
        }
        .interactiveDismissDisabled(sending)
    }

    private func versionField(_ text: Binding<String>, prompt: String, label: () -> Text) -> some View {
        TextField(text: text, prompt: Text(verbatim: prompt), label: label)
            .monospacedDigit()
            .autocorrectionDisabled()
            #if os(iOS)
                .keyboardType(.decimalPad)
            #endif
    }
}

/// One component's SDK keys, the active first, each in full with a copy button; issuing a new one,
/// and revoking one after a confirmation, each sent once.
struct SdkKeysScreen: View {
    let keys: SdkKeysModel
    /// What people call the component.
    let name: String
    @State private var revoking: IssuedSdkKey? = nil

    var body: some View {
        List {
            if keys.list.value != nil {
                Section {
                    if keys.keys.isEmpty {
                        Text(
                            "No SDK keys yet. Issue one for the app's builds to carry.", bundle: #bundle,
                            comment: "A component without SDK keys."
                        )
                        .foregroundStyle(.secondary)
                    }
                    ForEach(keys.keys, id: \.key) { key in
                        SdkKeyRow(
                            key: key.key, issuedAt: key.issuedAt, revokedAt: key.revokedAt,
                            isNew: key.key == keys.lastIssued, revoking: keys.revoking[key.key] == .sending
                        ) {
                            revoking = key
                        }
                    }
                } footer: {
                    Text(
                        "Put a key in the app's SDK configuration. A key is public, as anything shipped in an app is: it lets the SDK send this component's signals and read its manifest, nothing else. Issuing a new one keeps the others working, so ship a build with it before revoking the old.",
                        bundle: #bundle,
                        comment: "Below a component's SDK keys: what they are and how to rotate them."
                    )
                }
                if let problem {
                    Section {
                        SdkKeyProblemText(problem: problem)
                            .foregroundStyle(.red)
                    }
                }
            }
        }
        .overlay {
            if keys.list.value == nil {
                AnswerPlaceholder(problem: keys.list.problem)
            }
        }
        .navigationTitle(Text("SDK keys", bundle: #bundle, comment: "Title of a component's SDK keys."))
        .navigationSubtitle(Text(verbatim: name))
        .toolbar {
            if keys.list.value != nil {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        keys.dismissProblems()
                        Task { _ = await keys.issue() }
                    } label: {
                        if keys.issuing == .sending {
                            ProgressView()
                                .accessibilityLabel(
                                    Text("Issuing", bundle: #bundle, comment: "The issue button while it sends."))
                        } else {
                            Label {
                                Text("Issue Key", bundle: #bundle, comment: "Issues a new SDK key for a component.")
                            } icon: {
                                Image(systemName: "plus")
                            }
                        }
                    }
                    .disabled(keys.issuing == .sending)
                }
            }
        }
        .confirmationDialog(
            String(
                localized: "Revoke this key?", bundle: #bundle,
                comment: "Title of the confirmation before revoking an SDK key."),
            item: $revoking,
            titleVisibility: .visible
        ) { key in
            Button(role: .destructive) {
                keys.dismissProblems()
                Task { _ = await keys.revoke(key.key) }
            } label: {
                Text("Revoke Key", bundle: #bundle, comment: "Confirms revoking an SDK key.")
            }
        } message: { _ in
            Text(
                "Builds that carry it are refused from then on. Ship a build with another key first.",
                bundle: #bundle,
                comment: "What revoking an SDK key does."
            )
        }
        .sensoryFeedback(.success, trigger: keys.lastIssued)
        .refreshable { await keys.load() }
        .task { await keys.load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: keys.list.problem, receivedAt: keys.list.receivedAt)
        }
    }

    // Why the last issue or revoke failed.
    private var problem: SdkKeyProblem? {
        if case .failed(let problem) = keys.issuing {
            return problem
        }
        for change in keys.revoking.values {
            if case .failed(let problem) = change {
                return problem
            }
        }
        return nil
    }
}

/// One SDK key, in full, with a copy button; when issued, and, revoked, since when; active, a
/// button that revokes it after a confirmation.
struct SdkKeyRow: View {
    let key: String
    let issuedAt: Date
    let revokedAt: Date?
    /// Just issued from this phone.
    let isNew: Bool
    let revoking: Bool
    let revoke: () -> Void
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: key)
                .unhyphenated()
                .font(.callout.monospaced())
                .foregroundStyle(revokedAt == nil ? .primary : .secondary)
                .strikethrough(revokedAt != nil)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            Group {
                if let revokedAt {
                    Text(
                        "\(Text("Revoked \(revokedAt, format: .dateTime.month(.abbreviated).day().year())", bundle: #bundle, comment: "When an SDK key was revoked. The variable is a date.").foregroundStyle(.red)) · issued \(issuedAt, format: .dateTime.month(.abbreviated).day().year())",
                        bundle: #bundle,
                        comment:
                            "When a revoked SDK key was revoked and issued. The variables are when it was revoked, in words, and a date."
                    )
                    .foregroundStyle(.secondary)
                } else if isNew {
                    Text(
                        "Just issued: active", bundle: #bundle, comment: "An SDK key this phone just issued."
                    )
                    .foregroundStyle(.green)
                } else {
                    Text(
                        "Active · issued \(issuedAt, format: .dateTime.month(.abbreviated).day().year())",
                        bundle: #bundle,
                        comment: "When an active SDK key was issued. The variable is a date."
                    )
                }
            }
            .font(.subheadline)
            // A revoked key is kept to say when it stopped working, not to be used again.
            if revokedAt == nil {
                HStack(spacing: 12) {
                    Button {
                        copyToPasteboard(key)
                        copied = true
                    } label: {
                        if copied {
                            Text("Copied", bundle: #bundle, comment: "An SDK key was copied.")
                        } else {
                            Text("Copy", bundle: #bundle, comment: "Copies an SDK key.")
                        }
                    }
                    .buttonStyle(.glass)
                    if revoking {
                        ProgressView()
                    } else {
                        Button(role: .destructive, action: revoke) {
                            Text("Revoke…", bundle: #bundle, comment: "Revokes an SDK key, after a confirmation.")
                                .foregroundStyle(.red)
                        }
                        .buttonStyle(.glass)
                    }
                }
                .font(.subheadline)
                .controlSize(.small)
                .sensoryFeedback(.success, trigger: copied) { _, now in now }
                .task(id: copied) {
                    guard copied else { return }
                    try? await Task.sleep(for: .seconds(2))
                    copied = false
                }
            }
        }
        .padding(.vertical, 4)
    }
}

/// Why an SDK key wasn't issued or revoked, in words.
struct SdkKeyProblemText: View {
    let problem: SdkKeyProblem

    var body: some View {
        switch problem {
        case .unreachable:
            Text(
                "Offline. Not changed: try again once online.", bundle: #bundle,
                comment: "An SDK key couldn't be issued or revoked: the deployment didn't answer.")
        case .missing:
            Text(
                "Cluenori doesn't know this component or key any more.", bundle: #bundle,
                comment: "An SDK key couldn't be issued or revoked: the component or key is gone.")
        case .unreadable:
            Text(
                "Cluenori answered in a way this version doesn't understand. Update the app.", bundle: #bundle,
                comment: "The deployment's answer couldn't be read.")
        }
    }
}

// MARK: - Previews, on made-up values

#if DEBUG
    #Preview("Version policy") {
        NavigationStack {
            List {
                VersionPolicySections(
                    minimum: "0.2.0", recommended: "0.3.1", storeUrl: "https://apps.apple.com/app/id0000000000",
                    minimumOsVersion: "26.0",
                    words: [
                        UpdateWords(
                            locale: "en-US", decision: .require,
                            text: UpdateText(
                                title: "Time to update",
                                message: "This version of Notes stopped syncing. Update to keep your notes."))
                    ], setAt: AnalyticsPreviewData.now)
            }
            .navigationTitle("Version policy")
        }
    }

    #Preview("Version policy, partial and none") {
        NavigationStack {
            List {
                VersionPolicySections(
                    minimum: nil, recommended: "0.3.1", storeUrl: "https://apps.apple.com/app/id0000000000",
                    minimumOsVersion: nil, words: [], setAt: AnalyticsPreviewData.now)
                Section { NoVersionPolicy() }
                Section { VersionPolicyProblemText(problem: .unreachable).foregroundStyle(.red) }
            }
            .navigationTitle("Version policy")
        }
    }

    #Preview("SDK keys") {
        NavigationStack {
            List {
                SdkKeyRow(
                    key: "cluenori-sdk.notesapp.notes-ios.tp9psYR4-dp1S732n6AAXg",
                    issuedAt: AnalyticsPreviewData.now,
                    revokedAt: nil, isNew: true, revoking: false, revoke: {})
                SdkKeyRow(
                    key: "cluenori-sdk.notesapp.notes-ios.4yZ0Tdfxt0SmwNFFTb-_oQ",
                    issuedAt: AnalyticsPreviewData.now.addingTimeInterval(-30 * 86_400),
                    revokedAt: AnalyticsPreviewData.now.addingTimeInterval(-86_400), isNew: false, revoking: false,
                    revoke: {})
                SdkKeyProblemText(problem: .missing).foregroundStyle(.red)
            }
            .navigationTitle("SDK keys")
        }
    }

    #Preview("SDK keys, loading and offline") {
        List {
            AnswerPlaceholder(problem: nil)
            AnswerPlaceholder(problem: .unreachable)
        }
    }
#endif
