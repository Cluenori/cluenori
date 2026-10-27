import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// Every error group of a project in one environment over the period, or of one of its releases over
/// its span, the most frequent first.
struct ErrorsScreen: View {
    let errors: ErrorsModel
    let environments: EnvironmentChoice
    @Bindable var navigation: Navigation

    var body: some View {
        List {
            CoverageSections(
                telemetry: errors.telemetry,
                release: errors.release,
                environments: environments,
                route: .errors(of: errors.telemetry),
                navigation: navigation
            )
            if let table = errors.table.value {
                ForEach(table.groups, id: \.id) { group in
                    NavigationLink(value: Route.error(of: errors.telemetry, id: group.id)) {
                        ErrorGroupRow(title: group.title, culprit: group.culprit, occurrences: group.occurrences)
                    }
                }
            }
        }
        .overlay {
            if let table = errors.table.value {
                if table.groups.isEmpty {
                    NothingShown(
                        title: Text("No errors", bundle: #bundle, comment: "A project had no errors."),
                        systemImage: "checkmark.circle",
                        narrowed: errors.release != nil,
                        period: $navigation.period
                    )
                }
            } else {
                AnswerPlaceholder(problem: errors.table.problem)
            }
        }
        .navigationTitle(Text("Errors", bundle: #bundle, comment: "Title of every error of a project."))
        .refreshable { await errors.table.load() }
        .task { await errors.table.load() }
        .answerBanner(problem: errors.table.problem, receivedAt: errors.table.receivedAt)
    }
}

struct ErrorGroupRow: View {
    let title: String
    let culprit: String
    let occurrences: Int

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .lineLimit(2)
                Text(culprit)
                    .font(.subheadline.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            Spacer(minLength: 12)
            Text(occurrences, format: .number)
                .font(.body.monospacedDigit().weight(.semibold))
        }
        .accessibilityElement(children: .combine)
    }
}

/// One error group, in a project's environment over the period, or in one of its releases over its
/// span: what it said, where it happens, how often, and its latest occurrences.
struct ErrorScreen: View {
    let error: ErrorModel
    /// The project's monitors, to which "Monitor this" adds one.
    let monitors: MonitorsModel
    let environments: EnvironmentChoice
    @Bindable var navigation: Navigation
    @State private var monitoring: MonitorTarget? = nil

    var body: some View {
        List {
            CoverageSections(
                telemetry: error.telemetry,
                release: error.release,
                environments: environments,
                route: .error(of: error.telemetry, id: error.id),
                navigation: navigation
            )
            if let detail = error.detail.value {
                Section {
                    ErrorSummary(
                        title: detail.group.title,
                        culprit: detail.group.culprit,
                        occurrences: detail.group.occurrences,
                        firstSeen: detail.group.firstSeen,
                        lastSeen: detail.group.lastSeen,
                        lastComponent: detail.group.lastComponent,
                        lastRelease: detail.group.lastRelease
                    )
                }
                Section {
                    if detail.latest.isEmpty {
                        // The error is found whatever the period; only its occurrences are the period's.
                        Text(
                            "None in this period. Last seen \(detail.group.lastSeen, format: .relative(presentation: .named)).",
                            bundle: #bundle,
                            comment: "An error none of whose occurrences are in the period, and when it last happened."
                        )
                        .foregroundStyle(.secondary)
                    }
                    ForEach(detail.latest, id: \.id) { line in
                        NavigationLink(value: Route.logLine(project: error.telemetry.project, id: line.id)) {
                            LogLineRow(
                                time: line.time, level: line.level, component: line.component, message: line.message)
                        }
                    }
                } header: {
                    Text("Latest", bundle: #bundle, comment: "Section of an error's latest occurrences.")
                }
            }
        }
        .overlay {
            if error.detail.value == nil {
                if error.detail.problem == .missing {
                    NothingShown(
                        title: Text(
                            "No such error",
                            bundle: #bundle,
                            comment: "An error the project doesn't have, or forgot 15 months after it was last seen."
                        ),
                        systemImage: "checkmark.circle",
                        narrowed: error.release != nil,
                        period: $navigation.period
                    )
                } else {
                    AnswerPlaceholder(problem: error.detail.problem)
                }
            }
        }
        .navigationTitle(Text("Error", bundle: #bundle, comment: "Title of one error."))
        .toolbar {
            // More than N of it in a window, of the component it happened in where the screen looks.
            if let detail = error.detail.value,
                let component = MonitorDraft.component(
                    release: error.telemetry.release?.component, newest: detail.latest.first?.component,
                    lastComponent: detail.group.lastComponent, lastEnvironment: detail.group.lastEnvironment,
                    environment: error.telemetry.environment)
            {
                let group = detail.group
                ToolbarItem(placement: .primaryAction) {
                    MonitorThisButton {
                        monitoring = MonitorTarget(
                            project: error.telemetry.project,
                            component: component,
                            environment: error.telemetry.environment, name: group.title,
                            draft: .first(.error(error.id)))
                    }
                }
            }
        }
        .monitorSheet($monitoring, monitors: monitors, navigation: navigation)
        .refreshable { await error.detail.load() }
        .task { await error.detail.load() }
        .answerBanner(problem: error.detail.problem, receivedAt: error.detail.receivedAt)
    }
}

struct ErrorSummary: View {
    let title: String
    let culprit: String
    let occurrences: Int
    let firstSeen: Date
    let lastSeen: Date
    let lastComponent: String
    let lastRelease: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)
                .textSelection(.enabled)
            Text(culprit)
                .font(.footnote.monospaced())
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
                GridRow {
                    Text("In the period", bundle: #bundle, comment: "How many times an error happened in the period.")
                        .foregroundStyle(.secondary)
                    Text(occurrences, format: .number)
                }
                GridRow {
                    Text("First seen", bundle: #bundle, comment: "When an error first happened.")
                        .foregroundStyle(.secondary)
                    Text(firstSeen, format: .dateTime.month().day().hour().minute())
                }
                GridRow {
                    Text("Last seen", bundle: #bundle, comment: "When an error last happened.")
                        .foregroundStyle(.secondary)
                    Text(lastSeen, format: .dateTime.month().day().hour().minute())
                }
                GridRow {
                    Text("In", bundle: #bundle, comment: "The component, and its release, an error last happened in.")
                        .foregroundStyle(.secondary)
                    Text(verbatim: lastRelease.map { "\(lastComponent) \($0)" } ?? lastComponent)
                }
            }
            .font(.subheadline)
        }
        .padding(.vertical, 4)
    }
}
