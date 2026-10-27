import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// A project's tech, in the environment its screens show, over the period: its load and busiest
/// operations, its errors, its latest warnings and errors, and its open incidents, each the latest
/// few and the way to all of them.
struct TechScreen: View {
    let project: ProjectModel
    let incidents: IncidentsModel
    let environments: EnvironmentChoice
    @Bindable var navigation: Navigation

    var body: some View {
        // What the panels lead to: this project's screens in this environment.
        let shown = Telemetry.project(project.key, environment: project.environment)
        PanelScreen(spacing: 22) {
            OperationsPanel(telemetry: shown, load: project.load, operations: project.operations)
            ErrorsPanel(telemetry: shown, errors: project.errors, period: project.period)
            LogsPanel(telemetry: shown, logs: project.logs, period: project.period)
            IncidentsPanel(project: project.key, incidents: incidents.incidents)
        }
        .navigationTitle(
            Text("Tech", bundle: #bundle, comment: "Title of a project's operations, errors, logs and incidents.")
        )
        .navigationSubtitle(TechCoverage(environment: project.environment, period: project.period).text)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                EnvironmentMenu(choice: environments, shown: project.environment, navigation: navigation)
            }
        }
        .refreshable {
            async let tech: Void = project.refresh()
            async let open: Void = incidents.load()
            async let choice: Void = environments.refresh()
            _ = await (tech, open, choice)
        }
        .task(id: navigation.period) {
            // A new period asks everything again; the same one, shown again, does too.
            async let open: Void = incidents.load()
            if project.period == navigation.period {
                await project.refresh()
            } else {
                await project.choose(navigation.period)
            }
            await open
        }
        .answerBanner(problem: project.load.problem, receivedAt: project.load.receivedAt)
    }
}

/// Below Tech's title, what it covers: `prod · the last 24 hours`; the period alone for a deployment
/// that doesn't tell environments apart.
struct TechCoverage {
    let environment: String?
    let period: PeriodKey

    var text: Text {
        if let environment {
            Text(
                "\(environment) · \(periodPhrase(period))", bundle: #bundle,
                comment: "What a project's tech shows: an environment and a period, such as prod · the last 24 hours.")
        } else {
            periodPhrase(period)
        }
    }
}

/// The environment a project's tech shows, chosen from a menu in the toolbar: the project's
/// environments, its production ones marked; nothing for a deployment that doesn't tell them apart,
/// or a project with one.
struct EnvironmentMenu: View {
    let choice: EnvironmentChoice
    let shown: String?
    let navigation: Navigation

    var body: some View {
        let environments = choice.environments
        if let shown, environments.count > 1 || !environments.contains(shown) {
            Menu {
                Picker(selection: Binding(get: { shown }, set: { navigation.show($0, of: choice) })) {
                    // A link may name an environment not offered: it is offered too, to show which is.
                    ForEach(environments.contains(shown) ? environments : environments + [shown], id: \.self) {
                        environment in
                        EnvironmentOption(environment: environment, isProduction: choice.isProduction(environment))
                            .tag(environment)
                    }
                } label: {
                    Text("Showing", bundle: #bundle, comment: "Label of the environment whose numbers a screen shows.")
                }
                .pickerStyle(.inline)
            } label: {
                Label {
                    Text(
                        "Showing \(shown)", bundle: #bundle,
                        comment: "The menu of the environment a screen shows. The variable is an environment.")
                } icon: {
                    Image(systemName: "eye")
                }
            }
        }
    }
}

/// The load over the period and the busiest operations, each opening its own screen.
struct OperationsPanel: View {
    let telemetry: Telemetry
    let load: Answer<LoadSeries>
    let operations: Answer<OperationTable>

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(
                title: Text("Operations", bundle: #bundle, comment: "Title of a project's busiest operations."),
                trailing: operations.value.flatMap { table in
                    table.count > 0
                        ? Text(
                            "\(table.count, format: .number) · \(Double(table.errors) / Double(table.count), format: .percent.precision(.fractionLength(0...1))) failed",
                            bundle: #bundle,
                            comment:
                                "How many operations ran, and the share that failed. The variables are a count and a percentage."
                        ) : nil
                }
            )
            Panel {
                if let series = load.value, !series.points.isEmpty {
                    LoadChart(points: series.points, step: series.step, height: 96)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                    PanelDivider()
                }
                if let table = operations.value {
                    if table.rows.isEmpty {
                        EmptyRow(
                            text: Text(
                                "No operations ran.", bundle: #bundle, comment: "A project ran nothing in the period."))
                    }
                    ForEach(table.rows.prefix(2), id: \.self) { row in
                        NavigationLink(
                            value: Route.operation(
                                OperationRef(
                                    project: telemetry.project, component: row.component, environment: row.environment,
                                    name: row.operation))
                        ) {
                            HubRow(color: Palette.sky) {
                                Text(verbatim: row.operation)
                                    .unhyphenated()
                                    .lineLimit(1)
                            } value: {
                                Text(
                                    "p95 \(Duration.milliseconds(row.p95Ms), format: DurationText.style(row.p95Ms))",
                                    bundle: #bundle, comment: "An operation's p95. The variable is a duration.")
                            }
                        }
                        .buttonStyle(PanelRowStyle())
                        PanelDivider()
                    }
                } else {
                    PanelPlaceholder(problem: operations.problem)
                    PanelDivider()
                }
                AllRow(
                    title: Text("All operations", bundle: #bundle, comment: "Opens every operation of a project."),
                    route: .operations(of: telemetry))
            }
        }
    }
}

/// The period's most frequent errors, each opening its own screen.
struct ErrorsPanel: View {
    let telemetry: Telemetry
    let errors: Answer<ErrorTable>
    let period: PeriodKey

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(title: Text("Errors", bundle: #bundle, comment: "Title of a project's errors."))
            Panel {
                if let table = errors.value {
                    if table.groups.isEmpty {
                        EmptyRow(
                            text: Text(
                                "No errors in \(periodPhrase(period)).", bundle: #bundle,
                                comment: "A project had no errors. The variable is a period, such as the last hour."))
                        PanelDivider()
                    }
                    ForEach(table.groups.prefix(2), id: \.id) { group in
                        NavigationLink(value: Route.error(of: telemetry, id: group.id)) {
                            HubRow(color: Palette.pink) {
                                Text(verbatim: group.title)
                                    .lineLimit(2)
                            } value: {
                                Text(group.occurrences, format: .number)
                                    .foregroundStyle(Palette.pink)
                            }
                        }
                        .buttonStyle(PanelRowStyle())
                        PanelDivider()
                    }
                } else {
                    PanelPlaceholder(problem: errors.problem)
                    PanelDivider()
                }
                AllRow(
                    title: Text("All errors", bundle: #bundle, comment: "Opens every error of a project."),
                    route: .errors(of: telemetry))
            }
        }
    }
}

/// The latest warnings and errors logged, each opening in full.
struct LogsPanel: View {
    let telemetry: Telemetry
    let logs: Answer<LogPage>
    let period: PeriodKey

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(
                title: Text("Logs", bundle: #bundle, comment: "Title of a project's latest warnings and errors."))
            Panel {
                if let page = logs.value {
                    if page.lines.isEmpty {
                        EmptyRow(
                            text: Text(
                                "No warnings or errors in \(periodPhrase(period)).", bundle: #bundle,
                                comment: "A project logged no warnings or errors. The variable is a period."))
                        PanelDivider()
                    }
                    ForEach(page.lines.prefix(2), id: \.id) { line in
                        NavigationLink(value: Route.logLine(project: telemetry.project, id: line.id)) {
                            HubRow(color: line.level.color) {
                                Text(verbatim: line.message)
                                    .lineLimit(2)
                            } value: {
                                Text(line.time, format: .dateTime.hour().minute())
                                    .foregroundStyle(Palette.secondary)
                            }
                        }
                        .buttonStyle(PanelRowStyle())
                        PanelDivider()
                    }
                } else {
                    PanelPlaceholder(problem: logs.problem)
                    PanelDivider()
                }
                AllRow(
                    title: Text("All logs", bundle: #bundle, comment: "Opens every warning and error of a project."),
                    route: .logs(of: telemetry))
            }
        }
    }
}

/// The open incidents, every environment's, each opening its own screen.
struct IncidentsPanel: View {
    let project: String
    let incidents: Answer<IncidentList>

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(title: Text("Incidents", bundle: #bundle, comment: "Title of a project's incidents."))
            Panel {
                if let list = incidents.value {
                    if list.open.isEmpty {
                        EmptyRow(
                            text: Text(
                                "No open incidents.", bundle: #bundle, comment: "A project has no open incident."))
                        PanelDivider()
                    }
                    ForEach(list.open.prefix(2), id: \.id) { incident in
                        NavigationLink(value: Route.incident(project: project, id: incident.id)) {
                            HubRow(color: Palette.red) {
                                Text(verbatim: incident.title)
                                    .lineLimit(2)
                            } value: {
                                IncidentCauseText(cause: IncidentCause(incident.evidence))
                                    .foregroundStyle(Palette.red)
                            }
                        }
                        .buttonStyle(PanelRowStyle())
                        PanelDivider()
                    }
                } else {
                    PanelPlaceholder(problem: incidents.problem)
                    PanelDivider()
                }
                AllRow(
                    title: Text("All incidents", bundle: #bundle, comment: "Opens every incident of a project."),
                    route: .incidents(project: project))
            }
        }
    }
}

/// A row of the tech hub: a dot in its color, what it is, and its number at the end.
struct HubRow<Label: View, Value: View>: View {
    let color: Color
    @ViewBuilder let label: Label
    @ViewBuilder let value: Value

    var body: some View {
        HStack(spacing: 12) {
            Dot(color: color)
            label
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
            value
                .font(.subheadline.monospacedDigit())
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(minHeight: 52)
        .accessibilityElement(children: .combine)
    }
}

/// A panel's row when it has nothing to list.
struct EmptyRow: View {
    let text: Text

    var body: some View {
        text
            .font(.subheadline)
            .foregroundStyle(Palette.secondary)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
    }
}

/// A panel's row before its answer arrives: a spinner, or that it couldn't come.
struct PanelPlaceholder: View {
    let problem: AnswerProblem?

    var body: some View {
        Group {
            if problem != nil {
                Text(
                    "Couldn't load. Pull down to try again.", bundle: #bundle,
                    comment: "A panel whose answer never arrived."
                )
                .font(.subheadline)
                .foregroundStyle(Palette.secondary)
            } else {
                ProgressView()
            }
        }
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
    }
}

extension LogLevel {
    /// Its color: pink for errors, yellow for warnings, gray for the rest.
    var color: Color {
        switch self {
        case .error, .fatal: Palette.pink
        case .warn: Palette.yellow
        default: Palette.secondary
        }
    }
}

/// What an incident is about, in a word: `Down`, `Failing`, `Stopped`.
struct IncidentCauseText: View {
    let cause: IncidentCause

    var body: some View {
        text
    }

    /// The same, as text inside a sentence.
    var text: Text {
        switch cause {
        case .down: Text("Down", bundle: #bundle, comment: "An incident's kind: a monitor is down.")
        case .failing: Text("Failing", bundle: #bundle, comment: "An incident's kind: an operation fails.")
        case .stopped: Text("Stopped", bundle: #bundle, comment: "An incident's kind: an operation stopped running.")
        case .monitor: Text("Monitor", bundle: #bundle, comment: "An incident's kind: a monitor someone set up fired.")
        case .other: Text("Incident", bundle: #bundle, comment: "An incident of a kind this app doesn't know.")
        }
    }
}
