import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// A project's overview in one environment over the period: its open incidents, its load, its
/// releases, its errors, and its latest warnings and errors, each leading to a screen with all of
/// them, in the same environment.
struct ProjectScreen: View {
    let project: ProjectModel
    let environments: EnvironmentChoice
    let name: String
    @Bindable var navigation: Navigation

    var body: some View {
        // What the sections lead to: this project's screens in this environment.
        let shown = Telemetry.project(project.key, environment: project.environment)
        List {
            PeriodSection(period: $navigation.period)
            EnvironmentSection(choice: environments, shown: project.environment, navigation: navigation)
            IncidentsSection(incidents: project.incidents)
            LoadSection(telemetry: shown, load: project.load, operations: project.operations)
            ReleasesSection(telemetry: shown, releases: project.releases, period: project.period)
            ErrorsSection(telemetry: shown, errors: project.errors, period: project.period)
            LogsSection(telemetry: shown, logs: project.logs, period: project.period)
        }
        .navigationTitle(name)
        .refreshable {
            async let project: Void = project.refresh()
            async let environments: Void = environments.refresh()
            _ = await (project, environments)
        }
        .task(id: navigation.period) {
            // A new period asks everything again; the same one, shown again, does too.
            if project.period == navigation.period {
                await project.refresh()
            } else {
                await project.choose(navigation.period)
            }
        }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: project.load.problem, receivedAt: project.load.receivedAt)
        }
    }
}

struct IncidentsSection: View {
    let incidents: Answer<IncidentList>

    var body: some View {
        if let open = incidents.value?.open, !open.isEmpty {
            Section {
                ForEach(open, id: \.id) { incident in
                    IncidentRow(
                        title: incident.title,
                        openedAt: incident.openedAt,
                        acknowledged: incident.acknowledgedAt != nil,
                        resolvedAt: incident.resolvedAt
                    )
                }
            } header: {
                Text("Open incidents", bundle: #bundle, comment: "Section of a project's open incidents.")
            }
        }
    }
}

struct IncidentRow: View {
    let title: String
    let openedAt: Date
    let acknowledged: Bool
    /// Nil while it's open.
    let resolvedAt: Date?

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                Group {
                    if let resolvedAt {
                        Text(
                            "opened \(openedAt, format: .dateTime.month().day().hour().minute()), resolved after \(Duration.seconds(max(resolvedAt.timeIntervalSince(openedAt), 0)), format: .units(allowed: [.days, .hours, .minutes], width: .abbreviated, maximumUnitCount: 2))",
                            bundle: #bundle,
                            comment:
                                "When a resolved incident opened, and how long it was open. The variables are a date and time, and a duration."
                        )
                    } else {
                        Text(
                            "open \(Text(openedAt, style: .relative))",
                            bundle: #bundle,
                            comment: "How long an incident has been open. The variable is a duration."
                        )
                    }
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
        } icon: {
            if resolvedAt != nil {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            } else {
                Image(systemName: acknowledged ? "bell.badge.slash.fill" : "bell.badge.fill")
                    .foregroundStyle(acknowledged ? .orange : .red)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

struct LoadSection: View {
    let telemetry: Telemetry
    let load: Answer<LoadSeries>
    let operations: Answer<OperationTable>

    var body: some View {
        Section {
            if let series = load.value {
                LoadChart(points: series.points, step: series.step)
                    .padding(.vertical, 8)
            } else {
                AnswerPlaceholder(problem: load.problem)
            }
            if let table = operations.value {
                LoadStats(
                    count: table.count,
                    errors: table.errors,
                    slowestP95Ms: table.rows.map(\.p95Ms).max()
                )
            }
            NavigationLink(value: Route.operations(of: telemetry)) {
                Text("All operations", bundle: #bundle, comment: "Opens every operation of a project.")
            }
        } header: {
            Text("Load", bundle: #bundle, comment: "Section of a project's operations over time.")
        }
    }
}

struct LoadStats: View {
    let count: Int
    let errors: Int
    let slowestP95Ms: Double?

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(count, format: .number)
                    .font(.title3.monospacedDigit().weight(.semibold))
                FailedShare(count: count, failed: errors)
                    .font(.subheadline)
            }
            Spacer()
            if let slowestP95Ms {
                VStack(alignment: .trailing, spacing: 2) {
                    DurationText(milliseconds: slowestP95Ms)
                        .font(.title3.weight(.semibold))
                    Text("slowest p95", bundle: #bundle, comment: "Below the slowest operation's p95.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The project's latest releases over the period, each with its verdict, leading to all of them;
/// and which of their sources couldn't be read lately.
struct ReleasesSection: View {
    let telemetry: Telemetry
    let releases: Answer<ReleaseList>
    let period: PeriodKey

    var body: some View {
        Section {
            if let list = releases.value {
                if list.releases.isEmpty {
                    Text(
                        "No releases in \(periodPhrase(period)). A release shows once a service reports its version in `service.version`, `cluenori-release` reports a deploy, or App Store Connect has a build.",
                        bundle: #bundle,
                        comment:
                            "A project had no releases. The variable is a period; service.version and cluenori-release are names, as is."
                    )
                    .foregroundStyle(.secondary)
                }
                ForEach(list.releases.prefix(3), id: \.self) { summary in
                    ReleaseLink(project: telemetry.project, summary: summary)
                }
                ForEach(list.problems, id: \.self) { problem in
                    Label {
                        Text(
                            "\(sourceName(problem.source)) couldn't be read for \(problem.component): commits or builds may be missing.",
                            bundle: #bundle,
                            comment:
                                "A release source that failed. The variables are a service, such as GitHub, and a component."
                        )
                        .font(.subheadline)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                    }
                }
            } else {
                AnswerPlaceholder(problem: releases.problem)
            }
            NavigationLink(value: Route.releases(project: telemetry.project, environment: telemetry.environment)) {
                Text("All releases", bundle: #bundle, comment: "Opens every release of a project.")
            }
        } header: {
            Text("Releases", bundle: #bundle, comment: "Section of a project's releases.")
        }
    }
}

struct ErrorsSection: View {
    let telemetry: Telemetry
    let errors: Answer<ErrorTable>
    let period: PeriodKey

    var body: some View {
        Section {
            if let table = errors.value {
                if table.groups.isEmpty {
                    Text(
                        "No errors in \(periodPhrase(period)).",
                        bundle: #bundle,
                        comment: "A project had no errors. The variable is a period, such as the last hour."
                    )
                    .foregroundStyle(.secondary)
                }
                ForEach(table.groups.prefix(4), id: \.id) { group in
                    NavigationLink(value: Route.error(of: telemetry, id: group.id)) {
                        ErrorGroupRow(title: group.title, culprit: group.culprit, occurrences: group.occurrences)
                    }
                }
            } else {
                AnswerPlaceholder(problem: errors.problem)
            }
            NavigationLink(value: Route.errors(of: telemetry)) {
                Text("All errors", bundle: #bundle, comment: "Opens every error of a project.")
            }
        } header: {
            Text("Errors", bundle: #bundle, comment: "Section of a project's errors.")
        }
    }
}

struct LogsSection: View {
    let telemetry: Telemetry
    let logs: Answer<LogPage>
    let period: PeriodKey

    var body: some View {
        Section {
            if let page = logs.value {
                if page.lines.isEmpty {
                    Text(
                        "No warnings or errors in \(periodPhrase(period)).",
                        bundle: #bundle,
                        comment: "A project logged no warnings or errors. The variable is a period."
                    )
                    .foregroundStyle(.secondary)
                }
                ForEach(page.lines.prefix(4), id: \.id) { line in
                    LogLineRow(time: line.time, level: line.level, component: line.component, message: line.message)
                }
            } else {
                AnswerPlaceholder(problem: logs.problem)
            }
            NavigationLink(value: Route.logs(of: telemetry)) {
                Text("All logs", bundle: #bundle, comment: "Opens every warning and error of a project.")
            }
        } header: {
            Text("Logs", bundle: #bundle, comment: "Section of a project's latest warnings and errors.")
        }
    }
}
