import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// How a project's apps are used and how healthy each release is, of every component or one, in the
/// environment it shows, over the analytics period of UTC days: people by day, totals, each
/// release's people, weekly retention, each release's app health beside the release before it,
/// features, finding one person, and, for one component, its version policy and SDK keys. With no
/// app sending yet, it says how to start.
struct AnalyticsScreen: View {
    let analytics: AnalyticsModel
    let environments: EnvironmentChoice
    let policies: VersionPolicyModel
    /// The screen's route, which choosing another component replaces.
    let route: Route
    @Bindable var navigation: Navigation

    var body: some View {
        let ref = analytics.analytics
        List {
            AnalyticsFilterSections(
                analytics: ref, components: components, environments: environments, route: route,
                navigation: navigation)
            if analytics.sentNothing {
                NoAppSignalsSection(
                    environment: ref.environment, period: analytics.period, oneComponent: ref.component != nil,
                    lookFurther: analytics.period == .quarter ? nil : { navigation.analyticsPeriod = .quarter })
            } else {
                PeopleSection(
                    usage: analytics.usage.value, problem: analytics.usage.problem,
                    series: analytics.usageSeries, days: analytics.usageDays)
                if let releases = analytics.usage.value?.releases, !releases.isEmpty {
                    ReleaseUsageSection(releases: releases)
                }
                RetentionSection(
                    rows: analytics.retentionRows, answered: analytics.retention.value != nil,
                    problem: analytics.retention.problem)
                AppHealthSection(
                    project: ref.project, releases: analytics.appHealth.value?.releases,
                    problem: analytics.appHealth.problem)
                FeaturesSection(
                    features: analytics.featureUse.value?.features, problem: analytics.featureUse.problem,
                    shownAtMost: 5, all: .features(ref))
                FindPersonSection(project: ref.project, navigation: navigation)
            }
            AppSetupSection(project: ref.project, component: ref.component, policy: componentPolicy)
        }
        .navigationTitle(Text("Analytics", bundle: #bundle, comment: "Title of a project's app analytics."))
        .navigationSubtitle(ifAny: subtitle)
        .refreshable {
            async let analytics: Void = analytics.refresh()
            async let policies: Void = policies.load()
            _ = await (analytics, policies)
        }
        .task(id: navigation.analyticsPeriod) {
            async let analytics: Void = analytics.choose(navigation.analyticsPeriod)
            async let policies: Void = policies.load()
            _ = await (analytics, policies)
        }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: analytics.usage.problem, receivedAt: analytics.usage.receivedAt)
        }
    }

    // Every component of the project, to choose from: the API doesn't say which are apps.
    private var components: [(key: String, name: String)] {
        (environments.detail.value?.components ?? []).map { ($0.key, $0.name) }
    }

    private var subtitle: Text? {
        guard let component = analytics.analytics.component else { return nil }
        return Text(verbatim: components.first { $0.key == component }?.name ?? component)
    }

    // The chosen component's policy, as a row says it; nil for none, or every component.
    private var componentPolicy: PolicySummary {
        guard let component = analytics.analytics.component else { return .notAsked }
        guard policies.policies.value != nil else { return .notAsked }
        guard let policy = policies.policy(of: component) else { return .none }
        return .set(minimum: policy.minimum, recommended: policy.recommended)
    }
}

/// What a project's analytics cover: which component, every one or one, the environment, and the
/// period of UTC days.
struct AnalyticsFilterSections: View {
    let analytics: AnalyticsRef
    let components: [(key: String, name: String)]
    let environments: EnvironmentChoice
    let route: Route
    @Bindable var navigation: Navigation

    var body: some View {
        Section {
            AnalyticsPeriodPicker(period: $navigation.analyticsPeriod)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())
        }
        Section {
            ComponentPicker(
                chosen: analytics.component, components: components,
                choose: { navigation.showAnalytics(of: $0, inPlaceOf: route) })
            EnvironmentRow(choice: environments, shown: analytics.environment, navigation: navigation)
        } footer: {
            if let environment = analytics.environment {
                Text(
                    "What apps sent from \(environment) over \(analyticsPeriodPhrase(navigation.analyticsPeriod)), counted by UTC day.",
                    bundle: #bundle,
                    comment: "Below the choices of an analytics screen. The variables are an environment and a period."
                )
            } else {
                Text(
                    "What apps sent over \(analyticsPeriodPhrase(navigation.analyticsPeriod)), counted by UTC day.",
                    bundle: #bundle,
                    comment: "Below the choices of an analytics screen. The variable is a period."
                )
            }
        }
    }
}

/// Which component a screen shows, every one or one, in a menu: `Component  All`.
struct ComponentPicker: View {
    let chosen: String?
    let components: [(key: String, name: String)]
    let choose: (String?) -> Void

    var body: some View {
        Picker(selection: Binding(get: { chosen }, set: { choose($0) })) {
            Text("All", bundle: #bundle, comment: "The choice of every component in a menu.")
                .tag(String?.none)
            // A link may name a component the project doesn't list yet: it is offered too.
            ForEach(offered, id: \.key) { component in
                Text(verbatim: component.name).tag(String?.some(component.key))
            }
        } label: {
            Label {
                Text("Component", bundle: #bundle, comment: "Label of the component a screen shows.")
            } icon: {
                Image(systemName: "square.stack.3d.up")
            }
        }
        .pickerStyle(.menu)
    }

    private var offered: [(key: String, name: String)] {
        guard let chosen, !components.contains(where: { $0.key == chosen }) else { return components }
        return components + [(chosen, chosen)]
    }
}

/// No app sent anything over the period: what to do so one does, which reads as a first step, not
/// as a failure.
struct NoAppSignalsSection: View {
    /// Nil for every environment.
    let environment: String?
    let period: AnalyticsPeriod
    let oneComponent: Bool
    /// Looks over the longest period; nil when it is the longest.
    let lookFurther: (() -> Void)?

    var body: some View {
        Section {
            ContentUnavailableView {
                Label {
                    Text("No app signals", bundle: #bundle, comment: "Title when no app sent anything to a project.")
                } icon: {
                    Image(systemName: "iphone.gen3.radiowaves.left.and.right")
                }
            } description: {
                VStack(spacing: 8) {
                    if let environment {
                        Text(
                            "No app sent anything from \(environment) over \(analyticsPeriodPhrase(period)).",
                            bundle: #bundle,
                            comment: "Why analytics are empty. The variables are an environment and a period."
                        )
                    } else {
                        Text(
                            "No app sent anything over \(analyticsPeriodPhrase(period)).",
                            bundle: #bundle,
                            comment: "Why analytics are empty. The variable is a period."
                        )
                    }
                    if oneComponent {
                        Text(
                            "To start, issue an SDK key below, add the Cluenori Swift SDK to the app, start it with the key, and run the app:",
                            bundle: #bundle,
                            comment: "How to make an app send to Cluenori, with one component chosen. Code follows it."
                        )
                    } else {
                        Text(
                            "To start, choose the app's component above and issue it an SDK key, add the Cluenori Swift SDK to the app, start it with the key, and run the app:",
                            bundle: #bundle,
                            comment: "How to make an app send to Cluenori. Code follows it."
                        )
                    }
                    StartCode()
                }
            } actions: {
                if let lookFurther {
                    Button(action: lookFurther) {
                        Text(
                            "Show \(analyticsPeriodPhrase(.quarter))", bundle: #bundle,
                            comment: "Widens the analytics period. The variable is a period, such as the last 90 days.")
                    }
                    .buttonStyle(.glass)
                }
            }
        }
    }
}

/// The SDK's call that starts it, as code: on one line where it fits, else broken after its first
/// argument's label.
struct StartCode: View {
    var body: some View {
        ViewThatFits(in: .horizontal) {
            Text(verbatim: "Cluenori.start(key:environment:deployment:)")
            Text(verbatim: "Cluenori.start(key:\n  environment:\n  deployment:)")
                .multilineTextAlignment(.leading)
        }
        .font(.footnote.monospaced())
        .foregroundStyle(.primary)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.fill.tertiary, in: .rect(cornerRadius: 6))
        .textSelection(.enabled)
    }
}

/// People over the period: DAU, WAU, MAU and sessions by UTC day, each with its latest day's count;
/// then the period's people, installations, sessions, and sessions per person.
struct PeopleSection: View {
    let usage: AppUsage?
    let problem: AnswerProblem?
    let series: [UsageSeries]
    let days: ClosedRange<Date>

    var body: some View {
        Section {
            if let usage {
                ForEach(series) { series in
                    UsageChartRow(series: series, days: days)
                }
                CountRow(
                    title: Text("People", bundle: #bundle, comment: "How many people used the apps in the period."),
                    value: usage.people)
                CountRow(
                    title: Text(
                        "Installations", bundle: #bundle, comment: "How many installations sent in the period."),
                    value: usage.installations)
                CountRow(
                    title: Text("Sessions", bundle: #bundle, comment: "How many sessions started in the period."),
                    value: usage.sessions)
                if let perPerson = usage.sessionsPerPerson {
                    LabeledContent {
                        Text(perPerson, format: .number.precision(.fractionLength(0...1)))
                            .monospacedDigit()
                            .foregroundStyle(.primary)
                    } label: {
                        Text(
                            "Sessions per person", bundle: #bundle,
                            comment: "Sessions per person over the period.")
                    }
                }
            } else {
                AnswerPlaceholder(problem: problem)
            }
        } header: {
            Text("People", bundle: #bundle, comment: "Section of how many people used a project's apps.")
        } footer: {
            if let since = coveredSince {
                Text(
                    "Counted from \(since, format: utcDayStyle()): the apps sent nothing before, so earlier days are unknown.",
                    bundle: #bundle,
                    comment: "Below usage that starts within the period. The variable is a day."
                )
            }
        }
    }

    // The first day counted, when it is after the period's first: before it, unknown.
    private var coveredSince: Date? {
        guard let covered = usage?.covered, covered.from >= days.lowerBound.addingTimeInterval(86_400) else {
            return nil
        }
        return covered.from
    }
}

/// Each release's people and sessions over the period, the most people first.
struct ReleaseUsageSection: View {
    let releases: [ReleaseUsage]

    var body: some View {
        Section {
            ForEach(releases, id: \.self) { release in
                ReleaseUsageRow(
                    release: release.release, component: release.component, environment: release.environment,
                    people: release.people, sessions: release.sessions)
            }
        } header: {
            Text("By release", bundle: #bundle, comment: "Section of each release's people and sessions.")
        }
    }
}

/// Weekly cohorts of the people first seen in the period, and the share of each active each week
/// since.
struct RetentionSection: View {
    let rows: [RetentionRow]
    let answered: Bool
    let problem: AnswerProblem?

    var body: some View {
        Section {
            if !answered {
                AnswerPlaceholder(problem: problem)
            } else if rows.isEmpty {
                Text(
                    "No one was first seen in this period.", bundle: #bundle,
                    comment: "Retention without any cohort."
                )
                .foregroundStyle(.secondary)
            } else {
                ForEach(rows.reversed()) { row in
                    RetentionCohortRow(row: row)
                }
            }
        } header: {
            Text("Retention", bundle: #bundle, comment: "Section of weekly cohorts and how many came back.")
        } footer: {
            if !rows.isEmpty {
                Text(
                    "People by the UTC week they were first seen, and the share active each week after. The current week is so far.",
                    bundle: #bundle,
                    comment: "Below retention: what its numbers are."
                )
            }
        }
    }
}

/// Each release that sent anything in the period, the latest first, with its app health verdict
/// against the release before it.
struct AppHealthSection: View {
    let project: String
    let releases: [ReleaseHealth]?
    let problem: AnswerProblem?

    var body: some View {
        Section {
            if let releases {
                if releases.isEmpty {
                    Text(
                        "No release sent anything in this period.", bundle: #bundle,
                        comment: "App health without any release."
                    )
                    .foregroundStyle(.secondary)
                }
                ForEach(releases, id: \.self) { health in
                    NavigationLink(value: Route.appHealth(health.ref(in: project))) {
                        ReleaseHealthRow(
                            release: health.release.release, component: health.release.component,
                            environment: health.release.environment, previous: health.release.previous,
                            sessions: health.health.sessions, verdict: health.verdict, worse: health.worse,
                            better: health.better)
                    }
                }
            } else {
                AnswerPlaceholder(problem: problem)
            }
        } header: {
            Text(
                "App health", bundle: #bundle, comment: "Section of each release's launches, memory, crashes and hangs."
            )
        }
    }
}

/// Each feature's use, the most people first: the first few, leading to all of them, or all.
struct FeaturesSection: View {
    let features: [FeatureUse]?
    let problem: AnswerProblem?
    /// How many it shows; nil for all.
    let shownAtMost: Int?
    /// The screen of all of them, when it shows a few.
    let all: Route?

    var body: some View {
        Section {
            if let features {
                if features.isEmpty {
                    Text(
                        "No features used in this period.", bundle: #bundle,
                        comment: "Feature use without any feature."
                    )
                    .foregroundStyle(.secondary)
                }
                ForEach(features.prefix(shownAtMost ?? features.count), id: \.self) { use in
                    FeatureRow(
                        feature: use.feature, people: use.people, events: use.events, screens: use.screens,
                        peakMemoryP95Bytes: use.memory?.peakP95Bytes)
                }
                if let all, let shownAtMost, features.count > shownAtMost {
                    NavigationLink(value: all) {
                        Text("All features", bundle: #bundle, comment: "Opens every feature's use.")
                    }
                }
            } else {
                AnswerPlaceholder(problem: problem)
            }
        } header: {
            Text("Features", bundle: #bundle, comment: "Section of how each feature was used.")
        } footer: {
            if features?.contains(where: { $0.feature == nil }) == true {
                Text(
                    "(no feature) is what the app marked with no feature.", bundle: #bundle,
                    comment: "Below feature use: what its row without a key is. (no feature) as the row says it.")
            }
        }
    }
}

/// Finds one person by the app's own user ID for them, and opens what they did.
struct FindPersonSection: View {
    let project: String
    let navigation: Navigation
    @State private var user = ""

    var body: some View {
        let found = PersonModel.userID(user)
        Section {
            HStack {
                TextField(text: $user, prompt: Text(verbatim: "user-1842")) {
                    Text("User ID", bundle: #bundle, comment: "The field for the app's own ID of a person.")
                }
                .monospaced()
                .autocorrectionDisabled()
                #if os(iOS)
                    .textInputAutocapitalization(.never)
                #endif
                .submitLabel(.search)
                .onSubmit { open(found) }
                Button {
                    open(found)
                } label: {
                    Text("Find", bundle: #bundle, comment: "Opens the person a user ID names.")
                }
                .buttonStyle(.glass)
                .disabled(found == nil)
            }
        } header: {
            Text("One person", bundle: #bundle, comment: "Section that finds one person by their user ID.")
        } footer: {
            if !user.isEmpty, found == nil {
                Text(
                    "A user ID is up to 128 letters, digits and symbols, without spaces.", bundle: #bundle,
                    comment: "Below a user ID typed that isn't one.")
            } else {
                Text(
                    "The ID the app gave Cluenori for its user.", bundle: #bundle,
                    comment: "Below the user ID field: which ID it takes.")
            }
        }
    }

    private func open(_ user: String?) {
        guard let user else { return }
        navigation.push(.person(project: project, user: user))
    }
}

/// What a row says of a component's version policy.
enum PolicySummary: Equatable {
    case notAsked
    case none
    case set(minimum: String?, recommended: String?)
}

/// For one component, its version policy and its SDK keys; for every component, how to get to them.
struct AppSetupSection: View {
    let project: String
    let component: String?
    let policy: PolicySummary

    var body: some View {
        Section {
            if let component {
                NavigationLink(value: Route.versionPolicy(project: project, component: component)) {
                    LabeledContent {
                        PolicySummaryText(policy: policy)
                    } label: {
                        Text("Version policy", bundle: #bundle, comment: "Opens a component's version policy.")
                    }
                }
                NavigationLink(value: Route.sdkKeys(project: project, component: component)) {
                    Text("SDK keys", bundle: #bundle, comment: "Opens a component's SDK keys.")
                }
            }
        } header: {
            Text("App setup", bundle: #bundle, comment: "Section of a component's version policy and SDK keys.")
        } footer: {
            if component == nil {
                Text(
                    "Choose a component above for its version policy and SDK keys.", bundle: #bundle,
                    comment: "Below app setup while every component shows.")
            }
        }
    }
}

/// A version policy in a few words: `min 0.2.0 · rec 0.3.1`, `None`.
struct PolicySummaryText: View {
    let policy: PolicySummary

    var body: some View {
        switch policy {
        case .notAsked: EmptyView()
        case .none: Text("None", bundle: #bundle, comment: "A component without a version policy.")
        case .set(let minimum, let recommended):
            VStack(alignment: .trailing, spacing: 2) {
                if let minimum {
                    Text(
                        "minimum \(minimum)", bundle: #bundle,
                        comment: "A version policy's minimum version, in a row. The variable is a version.")
                }
                if let recommended {
                    Text(
                        "recommended \(recommended)", bundle: #bundle,
                        comment: "A version policy's recommended version, in a row. The variable is a version.")
                }
            }
            .font(.subheadline.monospacedDigit())
            .multilineTextAlignment(.trailing)
        }
    }
}

/// Every feature's use over the analytics period, the most people first.
struct FeaturesScreen: View {
    let analytics: AnalyticsModel
    let environments: EnvironmentChoice
    let route: Route
    @Bindable var navigation: Navigation

    var body: some View {
        let ref = analytics.analytics
        List {
            AnalyticsFilterSections(
                analytics: ref,
                components: (environments.detail.value?.components ?? []).map { ($0.key, $0.name) },
                environments: environments, route: route, navigation: navigation)
            FeaturesSection(
                features: analytics.featureUse.value?.features, problem: analytics.featureUse.problem,
                shownAtMost: nil, all: nil)
        }
        .navigationTitle(Text("Features", bundle: #bundle, comment: "Title of every feature's use."))
        .refreshable { await analytics.featureUse.load() }
        .task(id: navigation.analyticsPeriod) { await analytics.choose(navigation.analyticsPeriod) }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: analytics.featureUse.problem, receivedAt: analytics.featureUse.receivedAt)
        }
    }
}

/// One release's app health beside the release before it: its verdict and what made it so, then
/// each measure it sent, with the same of the release before; a measure it didn't send isn't shown.
struct AppHealthScreen: View {
    let analytics: AnalyticsModel
    let release: ReleaseRef
    let period: AnalyticsPeriod

    var body: some View {
        List {
            if let health = analytics.health(of: release) {
                AppHealthContent(health: health)
            }
        }
        .overlay {
            if analytics.health(of: release) == nil {
                if analytics.appHealth.value != nil {
                    ContentUnavailableView {
                        Label {
                            Text(
                                "Release not found", bundle: #bundle, comment: "A release the project doesn't know.")
                        } icon: {
                            Image(systemName: "shippingbox")
                        }
                    } description: {
                        Text(
                            "\(release.version) of \(release.component) sent nothing over \(analyticsPeriodPhrase(period)).",
                            bundle: #bundle,
                            comment:
                                "Why a release's app health isn't found. The variables are its version, its component and a period."
                        )
                    }
                } else {
                    AnswerPlaceholder(problem: analytics.appHealth.problem)
                }
            }
        }
        .navigationTitle(Text(verbatim: release.version))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
        .refreshable { await analytics.appHealth.load() }
        .task { await analytics.appHealth.load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: analytics.appHealth.problem, receivedAt: analytics.appHealth.receivedAt)
        }
    }
}

/// A release's app health, as its screen's sections: what it is and its verdict, then its measures.
struct AppHealthContent: View {
    let health: ReleaseHealth

    var body: some View {
        let verdict = health.verdict.asVerdict
        Section {
            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: "\(health.release.component) · \(health.release.environment)")
                        .unhyphenated()
                        .font(.subheadline.weight(.medium))
                        .fixedSize(horizontal: false, vertical: true)
                        .foregroundStyle(.secondary)
                    Text(verbatim: health.release.release)
                        .unhyphenated()
                        .font(.title.monospaced().weight(.bold))
                        .lineLimit(2)
                        .minimumScaleFactor(0.6)
                        .textSelection(.enabled)
                }
                Label {
                    HealthVerdictText(verdict: health.verdict, worse: health.worse, better: health.better)
                } icon: {
                    Image(systemName: verdict.symbol)
                        .symbolRenderingMode(.hierarchical)
                }
                .foregroundStyle(verdict.tint)
                .font(.headline)
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .combine)
            SpanRow(
                span: ReleaseSpan(
                    from: min(health.release.firstSeen, health.release.lastSeen),
                    to: max(health.release.firstSeen, health.release.lastSeen)))
        } footer: {
            if let previous = health.release.previous {
                Text(
                    "Compared with \(Text(verbatim: previous).monospaced()), the release before it, over all that is kept of each.",
                    bundle: #bundle,
                    comment: "Which release app health is compared with. The variable is a version."
                )
            } else {
                Text(
                    "No release before it to compare with.", bundle: #bundle,
                    comment: "App health of the first release counted.")
            }
        }
        ForEach(health.groups) { group in
            Section {
                ForEach(group.lines) { line in
                    HealthLineRow(line: line)
                }
            } header: {
                HealthGroupTitle(kind: group.kind)
            } footer: {
                if group.kind == .use {
                    Text(
                        "Prewarmed launches are counted, not timed: iOS started them ahead.", bundle: #bundle,
                        comment: "Below a release's use: why prewarmed launches aren't in the times.")
                }
            }
        }
        if !health.groups.contains(where: { $0.kind == .metricKit }) {
            Section {
                Text(
                    "MetricKit hasn't reported of this release yet: crashes and hangs are unknown.", bundle: #bundle,
                    comment: "Below crashes and hangs a release has no MetricKit report of."
                )
                .foregroundStyle(.secondary)
            } header: {
                HealthGroupTitle(kind: .metricKit)
            }
        }
    }
}

// MARK: - Previews, on made-up values

#if DEBUG
    #Preview("Analytics, loading") {
        NavigationStack {
            List {
                PeopleSection(
                    usage: nil, problem: nil, series: [],
                    days: UsageSeries.days(of: .month, endingWith: AnalyticsPreviewData.now))
                RetentionSection(rows: [], answered: false, problem: nil)
                AppHealthSection(project: "notesapp", releases: nil, problem: nil)
            }
            .navigationTitle("Analytics")
        }
    }

    #Preview("Analytics, offline before any answer") {
        NavigationStack {
            List {
                PeopleSection(
                    usage: nil, problem: .unreachable, series: [],
                    days: UsageSeries.days(of: .month, endingWith: AnalyticsPreviewData.now))
                FeaturesSection(features: nil, problem: .unreachable, shownAtMost: 5, all: nil)
            }
            .safeAreaInset(edge: .bottom) { AnswerBanner(problem: .unreachable, receivedAt: nil) }
            .navigationTitle("Analytics")
        }
    }

    #Preview("Analytics, no app yet") {
        NavigationStack {
            List {
                NoAppSignalsSection(environment: "production", period: .month, oneComponent: false, lookFurther: {})
                AppSetupSection(project: "notesapp", component: nil, policy: .notAsked)
            }
            .navigationTitle("Analytics")
        }
    }

    #Preview("Analytics") {
        NavigationStack {
            List {
                PeopleSection(
                    usage: AnalyticsPreviewData.usage, problem: nil,
                    series: UsageSeries.of(AnalyticsPreviewData.usage),
                    days: UsageSeries.days(of: .month, endingWith: AnalyticsPreviewData.now))
                ReleaseUsageSection(releases: AnalyticsPreviewData.usage.releases)
                RetentionSection(rows: RetentionRow.of(AnalyticsPreviewData.retention), answered: true, problem: nil)
                AppHealthSection(
                    project: "notesapp",
                    releases: [AnalyticsPreviewData.partial, AnalyticsPreviewData.worse, AnalyticsPreviewData.first],
                    problem: nil)
                FeaturesSection(
                    features: AnalyticsPreviewData.features.features, problem: nil, shownAtMost: 2,
                    all: .features(AnalyticsRef(project: "notesapp")))
                AppSetupSection(
                    project: "notesapp", component: "notes-ios", policy: .set(minimum: "0.2.0", recommended: "0.3.1"))
            }
            .navigationTitle("Analytics")
        }
    }

    #Preview("Analytics, five days counted") {
        NavigationStack {
            List {
                PeopleSection(
                    usage: AnalyticsPreviewData.partialUsage, problem: nil,
                    series: UsageSeries.of(AnalyticsPreviewData.partialUsage),
                    days: UsageSeries.days(of: .month, endingWith: AnalyticsPreviewData.now))
                RetentionSection(rows: [], answered: true, problem: nil)
                AppHealthSection(project: "notesapp", releases: [], problem: nil)
                FeaturesSection(features: [], problem: nil, shownAtMost: 5, all: nil)
            }
            .navigationTitle("Analytics")
        }
    }

    #Preview("App health, worse") {
        NavigationStack {
            List { AppHealthContent(health: AnalyticsPreviewData.worse) }
                .navigationTitle("0.3.0+20")
        }
    }

    #Preview("App health, some measures absent") {
        NavigationStack {
            List { AppHealthContent(health: AnalyticsPreviewData.partial) }
                .navigationTitle("0.3.1+21")
        }
    }

    #Preview("App health, first release") {
        NavigationStack {
            List { AppHealthContent(health: AnalyticsPreviewData.first) }
                .navigationTitle("0.4.0+25")
        }
    }
#endif
