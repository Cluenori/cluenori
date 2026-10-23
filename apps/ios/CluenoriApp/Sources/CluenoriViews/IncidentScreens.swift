import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// A project's incidents, every environment's: those open, then those resolved lately, each opening
/// its own screen.
struct IncidentsScreen: View {
    let incidents: IncidentsModel

    var body: some View {
        List {
            if let list = incidents.incidents.value {
                Section {
                    if list.open.isEmpty {
                        Text("No open incidents.", bundle: #bundle, comment: "A project has no open incident.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(list.open, id: \.id) { incident in
                        IncidentLink(project: incidents.project, incident: incident)
                    }
                } header: {
                    Text("Open", bundle: #bundle, comment: "Section of a project's open incidents.")
                }
                if !list.resolved.isEmpty {
                    Section {
                        ForEach(list.resolved, id: \.id) { incident in
                            IncidentLink(project: incidents.project, incident: incident)
                        }
                    } header: {
                        Text("Resolved", bundle: #bundle, comment: "Section of a project's resolved incidents.")
                    }
                }
            }
        }
        .overlay {
            if incidents.incidents.value == nil {
                AnswerPlaceholder(problem: incidents.incidents.problem)
            }
        }
        .navigationTitle(Text("Incidents", bundle: #bundle, comment: "Title of a project's incidents."))
        .refreshable { await incidents.load() }
        .task { await incidents.load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: incidents.incidents.problem, receivedAt: incidents.incidents.receivedAt)
        }
    }
}

private struct IncidentLink: View {
    let project: String
    let incident: Incident

    var body: some View {
        NavigationLink(value: Route.incident(project: project, id: incident.id)) {
            IncidentRow(
                title: incident.title,
                openedAt: incident.openedAt,
                acknowledged: incident.acknowledgedAt != nil,
                resolvedAt: incident.resolvedAt
            )
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
                    } else if acknowledged {
                        Text(
                            "acknowledged, open \(Text(openedAt, style: .relative))",
                            bundle: #bundle,
                            comment: "An incident someone is on. The variable is how long it has been open."
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
                    .foregroundStyle(Palette.mint)
            } else {
                Image(systemName: acknowledged ? "bell.badge.slash.fill" : "bell.badge.fill")
                    .foregroundStyle(acknowledged ? Palette.yellow : Palette.red)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// One incident: what it is about and how long it has been open, its evidence, when it opened, was
/// acknowledged and resolved, and, while it's open and no one is on it, Acknowledge.
struct IncidentScreen: View {
    let incidents: IncidentsModel
    let id: String
    /// Now, which shows the incident too, asked again once it is acknowledged.
    let today: TodayModel

    var body: some View {
        Group {
            if let incident = incidents.incident(id) {
                PanelScreen(spacing: 16) {
                    IncidentHeading(
                        cause: IncidentCause(incident.evidence), title: incident.title, openedAt: incident.openedAt,
                        resolvedAt: incident.resolvedAt)
                    IncidentEvidence(
                        evidence: incident.evidence, component: incident.component, environment: incident.environment)
                    IncidentTimeline(
                        openedAt: incident.openedAt, acknowledgedAt: incident.acknowledgedAt,
                        resolvedAt: incident.resolvedAt)
                    if incident.resolvedAt == nil && incident.acknowledgedAt == nil {
                        AcknowledgeButton(
                            isAcknowledging: incidents.acknowledging == id,
                            problem: incidents.notAcknowledged?.incident == id
                                ? incidents.notAcknowledged?.problem : nil
                        ) {
                            await incidents.acknowledge(id)
                            if incidents.notAcknowledged == nil {
                                await today.load()
                            }
                        }
                    }
                }
            } else {
                AnswerPlaceholder(problem: incidents.incidents.value == nil ? incidents.incidents.problem : .missing)
            }
        }
        .navigationTitle(Text("Incident", bundle: #bundle, comment: "Title of one incident."))
        // The views also build for macOS, for the package's tests on a Mac; this is iOS's alone.
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
        .refreshable { await incidents.load() }
        .task { await incidents.load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: incidents.incidents.problem, receivedAt: incidents.incidents.receivedAt)
        }
    }
}

/// An incident's kind and how long it has been open, in red, over its title: `Down · open 4 min`.
private struct IncidentHeading: View {
    let cause: IncidentCause
    let title: String
    let openedAt: Date
    let resolvedAt: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Group {
                if resolvedAt != nil {
                    Text(
                        "\(IncidentCauseText(cause: cause).text) · resolved", bundle: #bundle,
                        comment: "A resolved incident's kind, such as Down · resolved."
                    )
                    .foregroundStyle(Palette.mint)
                } else {
                    Text(
                        "\(IncidentCauseText(cause: cause).text) · open \(agoText(openedAt))", bundle: #bundle,
                        comment: "An open incident's kind and how long it has been open, such as Down · open 4 min."
                    )
                    .foregroundStyle(Palette.red)
                }
            }
            .font(.footnote.weight(.semibold))
            Text(verbatim: title)
                .font(.title2.bold())
                .unhyphenated()
        }
        .accessibilityElement(children: .combine)
    }
}

/// What opened an incident: the monitor, its failed checks and why; the operation and its share
/// failed against its usual; or the operation that stopped, and when it last ran.
private struct IncidentEvidence: View {
    let evidence: Evidence
    let component: String
    let environment: String?

    var body: some View {
        Panel {
            switch evidence {
            case .down(let down):
                FactRow(label: Text("Monitor", bundle: #bundle, comment: "The URL a down incident's monitor fetches."))
                {
                    Text(verbatim: down.url).unhyphenated()
                }
                PanelDivider()
                FactRow(label: Text("Failed checks", bundle: #bundle, comment: "How many checks in a row failed.")) {
                    Text(down.failures, format: .number)
                }
                PanelDivider()
                FactRow(label: Text("Problem", bundle: #bundle, comment: "Why a monitor's check failed.")) {
                    Text(verbatim: down.problem)
                }
            case .failing(let failing):
                FactRow(label: Text("Operation", bundle: #bundle, comment: "The operation an incident is about.")) {
                    Text(verbatim: failing.operation).unhyphenated()
                }
                PanelDivider()
                FactRow(label: Text("Failed", bundle: #bundle, comment: "How many runs of an operation failed.")) {
                    Text(
                        "\(failing.failed) of \(failing.count)", bundle: #bundle,
                        comment: "How many runs failed of how many. The variables are counts.")
                }
                PanelDivider()
                FactRow(label: Text("Usually", bundle: #bundle, comment: "An operation's usual share failed.")) {
                    Text(failing.usualRate, format: .percent.precision(.fractionLength(0...1)))
                }
            case .stopped(let stopped):
                FactRow(label: Text("Operation", bundle: #bundle, comment: "The operation an incident is about.")) {
                    Text(verbatim: stopped.operation).unhyphenated()
                }
                PanelDivider()
                FactRow(label: Text("Last ran", bundle: #bundle, comment: "When a stopped operation last ran.")) {
                    Text(stopped.lastRanAt, format: .dateTime.month(.abbreviated).day().hour().minute())
                }
                PanelDivider()
                FactRow(
                    label: Text(
                        "Usually every", bundle: #bundle, comment: "How often a stopped operation usually runs.")
                ) {
                    Text(
                        Duration.milliseconds(stopped.usualGapMs),
                        format: .units(
                            allowed: [.days, .hours, .minutes, .seconds], width: .abbreviated, maximumUnitCount: 2))
                }
            case .unknown:
                FactRow(label: Text("Evidence", bundle: #bundle, comment: "What opened an incident.")) {
                    Text(
                        "Update the app to see it.", bundle: #bundle,
                        comment: "Evidence of a kind this app doesn't know.")
                }
            }
            PanelDivider()
            FactRow(label: Text("Component", bundle: #bundle, comment: "The component an incident is in.")) {
                Text(verbatim: component)
            }
            if let environment {
                PanelDivider()
                FactRow(label: Text("Environment", bundle: #bundle, comment: "Where an incident happens.")) {
                    Text(verbatim: environment)
                }
            }
        }
    }
}

/// When an incident opened, was acknowledged, and resolved.
private struct IncidentTimeline: View {
    let openedAt: Date
    let acknowledgedAt: Date?
    let resolvedAt: Date?

    var body: some View {
        Panel {
            FactRow(label: Text("Opened", bundle: #bundle, comment: "When an incident opened.")) {
                Text(openedAt, format: .dateTime.month(.abbreviated).day().hour().minute())
            }
            PanelDivider()
            FactRow(label: Text("Acknowledged", bundle: #bundle, comment: "When someone said they're on an incident."))
            {
                if let acknowledgedAt {
                    Text(acknowledgedAt, format: .dateTime.month(.abbreviated).day().hour().minute())
                } else {
                    Text("Not yet", bundle: #bundle, comment: "An incident no one acknowledged yet.")
                        .foregroundStyle(Palette.secondary)
                }
            }
            if let resolvedAt {
                PanelDivider()
                FactRow(label: Text("Resolved", bundle: #bundle, comment: "When an incident resolved.")) {
                    Text(resolvedAt, format: .dateTime.month(.abbreviated).day().hour().minute())
                }
            }
        }
    }
}

/// One fact in a panel: what it is on the left, its value on the right.
struct FactRow<Value: View>: View {
    let label: Text
    @ViewBuilder let value: Value

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            label
                .foregroundStyle(Palette.secondary)
            Spacer(minLength: 8)
            value
                .multilineTextAlignment(.trailing)
        }
        .font(.subheadline)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(minHeight: 48)
        .accessibilityElement(children: .combine)
    }
}

/// Acknowledge: says someone is on the incident; while it's sent, it waits; why it wasn't, below it.
private struct AcknowledgeButton: View {
    let isAcknowledging: Bool
    let problem: IncidentsModel.Problem?
    let acknowledge: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: { Task { await acknowledge() } }) {
                if isAcknowledging {
                    ProgressView()
                } else {
                    Text("Acknowledge", bundle: #bundle, comment: "Says someone is on an incident.")
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(isAcknowledging)
            if let problem {
                Group {
                    switch problem {
                    case .unreachable:
                        Text(
                            "Cluenori didn't answer, so it isn't acknowledged. Try again.", bundle: #bundle,
                            comment: "Acknowledging an incident failed: offline.")
                    case .missing:
                        Text(
                            "This incident is gone: it may have resolved.", bundle: #bundle,
                            comment: "Acknowledging an incident the deployment no longer has.")
                    case .unreadable:
                        Text(
                            "Cluenori answered in a way this version doesn't understand. Update the app.",
                            bundle: #bundle, comment: "Acknowledging an incident got an answer the app can't read.")
                    }
                }
                .font(.footnote)
                .foregroundStyle(Palette.red)
            }
        }
    }
}
