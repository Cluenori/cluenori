import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// A project's incidents, every environment's, a list (`concept/Experience.md`): its answer first, how
/// many are open and whether someone is on each, and whether every monitor is up, which opens Uptime;
/// then those open, the newest first, and those resolved in the last 7 days, each opening its own
/// screen.
struct IncidentsScreen: View {
    let incidents: IncidentsModel
    let monitors: MonitorsModel

    var body: some View {
        List {
            if let list = incidents.incidents.value {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        IncidentsAnswer(
                            open: list.open.count, unacknowledged: list.open.filter { $0.acknowledgedAt == nil }.count,
                            resolved: list.resolved.count
                        )
                        .font(.headline)
                        Group {
                            if let checkedAt = list.checkedAt {
                                Text(
                                    "The detectors look every minute; last at \(checkedAt, format: .dateTime.hour().minute())",
                                    bundle: #bundle,
                                    comment: "When the detectors last looked for incidents. The variable is a time.")
                            } else {
                                Text(
                                    "The detectors haven't looked yet", bundle: #bundle,
                                    comment: "The detectors never looked for incidents yet.")
                            }
                        }
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            Section {
                NavigationLink(value: Route.uptime(project: incidents.project)) {
                    UptimeLine(monitors: monitors.monitors)
                }
            }
            if let list = incidents.incidents.value {
                Section {
                    if list.open.isEmpty {
                        Text("No incident is open.", bundle: #bundle, comment: "A project has no open incident.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(list.open, id: \.id) { incident in
                        IncidentLink(project: incidents.project, incident: incident)
                    }
                } header: {
                    Text("Open", bundle: #bundle, comment: "Section of a project's open incidents.")
                }
                Section {
                    if list.resolved.isEmpty {
                        Text(
                            "None resolved in the last 7 days.", bundle: #bundle,
                            comment: "A project with no incident resolved lately."
                        )
                        .foregroundStyle(.secondary)
                    }
                    ForEach(list.resolved, id: \.id) { incident in
                        IncidentLink(project: incidents.project, incident: incident)
                    }
                } header: {
                    Text(
                        "Resolved in the last 7 days", bundle: #bundle,
                        comment: "Section of a project's incidents resolved lately.")
                }
            }
        }
        .overlay {
            if incidents.incidents.value == nil {
                AnswerPlaceholder(problem: incidents.incidents.problem)
            }
        }
        .navigationTitle(Text("Incidents", bundle: #bundle, comment: "Title of a project's incidents."))
        .refreshable { await load() }
        .task { await load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: incidents.incidents.problem, receivedAt: incidents.incidents.receivedAt)
        }
    }

    private func load() async {
        async let open: Void = incidents.load()
        async let up: Void = monitors.monitors.load()
        _ = await (open, up)
    }
}

/// The incidents' answer in a sentence: `2 open, 1 no one is on yet`, `No open incidents; 3 resolved
/// in the last 7 days`, `No incidents in the last 7 days`.
struct IncidentsAnswer: View {
    let open: Int
    let unacknowledged: Int
    let resolved: Int

    var body: some View {
        if open > 0 && unacknowledged == 0 {
            Text(
                "\(open) open, someone is on each", bundle: #bundle,
                comment: "How many incidents are open, all acknowledged. The variable is a count.")
        } else if open > 0 {
            Text(
                "\(open) open, \(unacknowledged) no one is on yet", bundle: #bundle,
                comment: "How many incidents are open, and how many no one acknowledged. The variables are counts.")
        } else if resolved == 0 {
            Text(
                "No incidents in the last 7 days", bundle: #bundle,
                comment: "A project with no incident open or resolved lately.")
        } else {
            Text(
                "No open incidents; \(resolved) resolved in the last 7 days", bundle: #bundle,
                comment: "A project with no open incident, and how many resolved lately. The variable is a count.")
        }
    }
}

/// Uptime in a line, under the incidents' answer: whether every monitor is up.
private struct UptimeLine: View {
    let monitors: Answer<MonitorList>
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        // At accessibility sizes, the answer under the product's name.
        let layout =
            size.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
        layout {
            Text("Uptime", bundle: #bundle, comment: "A product: open incidents and the monitors.")
                .foregroundStyle(.secondary)
            if let list = monitors.value {
                let answer = UptimeAnswer(list.monitors)
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    BaselineDot(color: answer.color, textStyle: .body)
                    UptimeAnswerText(answer: answer, fine: UptimeAnswer.saysFine(list.monitors))
                }
            } else if monitors.problem != nil {
                Text("Couldn't load", bundle: #bundle, comment: "Uptime's line when the monitors didn't arrive.")
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
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
                            "acknowledged, open \(agoText(openedAt))",
                            bundle: #bundle,
                            comment: "An incident someone is on. The variable is how long it has been open."
                        )
                    } else {
                        Text(
                            "open \(agoText(openedAt))",
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

/// One incident, by its ID, an item (`concept/Experience.md`): no period, its whole life. Where it
/// stands first, and Acknowledge while it is open and no one is on it; then what it is about, which
/// opens its monitor or operation, its life from opening to now, and the release that ran when it
/// opened; and "Ask an agent".
struct IncidentScreen: View {
    let incident: IncidentModel
    /// The project's incidents, which acknowledges it.
    let incidents: IncidentsModel
    /// Now, which shows the incident too, asked again once it is acknowledged.
    let today: TodayModel

    var body: some View {
        Group {
            if let detail = incident.detail.value {
                let shown = detail.incident
                PanelScreen(spacing: 24) {
                    IncidentHeading(incident: shown)
                    if shown.resolvedAt == nil && shown.acknowledgedAt == nil {
                        AcknowledgeButton(
                            isAcknowledging: incidents.acknowledging == shown.id,
                            problem: incidents.notAcknowledged?.incident == shown.id
                                ? incidents.notAcknowledged?.problem : nil
                        ) {
                            await incidents.acknowledge(shown.id)
                            if incidents.notAcknowledged == nil {
                                async let detail: Void = incident.detail.load()
                                async let now: Void = today.load()
                                _ = await (detail, now)
                            }
                        }
                    }
                    IncidentAbout(project: incident.project, incident: shown)
                    IncidentLife(detail: detail)
                    IncidentReleases(project: incident.project, detail: detail)
                }
            } else {
                AnswerPlaceholder(problem: incident.detail.problem)
            }
        }
        .navigationTitle(Text("Incident", bundle: #bundle, comment: "Title of one incident."))
        // The views also build for macOS, for the package's tests on a Mac; this is iOS's alone.
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            if let detail = incident.detail.value {
                ToolbarItem(placement: .primaryAction) {
                    AskAnAgent(brief: UptimeBriefs.incident(project: incident.project, detail: detail))
                }
            }
        }
        .refreshable { await incident.detail.load() }
        .task { await incident.detail.load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: incident.detail.problem, receivedAt: incident.detail.receivedAt)
        }
    }
}

/// An incident's kind and where it stands, in its color, over its title: `Down · open for 4 min, no
/// one is on it yet` in red, yellow once acknowledged, mint once resolved.
private struct IncidentHeading: View {
    let incident: Incident

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Group {
                let kind = IncidentCauseText(cause: IncidentCause(incident.evidence)).text
                if let resolvedAt = incident.resolvedAt {
                    Text(
                        "\(kind) · resolved after \(lasting(resolvedAt.timeIntervalSince(incident.openedAt)))",
                        bundle: #bundle,
                        comment:
                            "A resolved incident's kind and how long it was open, such as Down · resolved after 14 min."
                    )
                    .foregroundStyle(Palette.mint)
                } else if incident.acknowledgedAt != nil {
                    Text(
                        "\(kind) · open for \(agoText(incident.openedAt)), acknowledged", bundle: #bundle,
                        comment: "An open incident someone is on, such as Down · open for 4 min, acknowledged."
                    )
                    .foregroundStyle(Palette.yellow)
                } else {
                    Text(
                        "\(kind) · open for \(agoText(incident.openedAt)), no one is on it yet", bundle: #bundle,
                        comment: "An open incident no one is on, such as Down · open for 4 min, no one is on it yet."
                    )
                    .foregroundStyle(Palette.red)
                }
            }
            .font(.footnote.weight(.semibold))
            Text(verbatim: incident.title)
                .font(.title2.bold())
                .unhyphenated()
        }
        .accessibilityElement(children: .combine)
    }

    private func lasting(_ seconds: TimeInterval) -> Text {
        Text(
            Duration.seconds(max(seconds, 0)),
            format: .units(allowed: [.days, .hours, .minutes], width: .abbreviated, maximumUnitCount: 2))
    }
}

/// What an incident is about: its monitor or its operation, each opening its own screen, what its
/// detector saw when it opened or last got worse, and where.
private struct IncidentAbout: View {
    let project: String
    let incident: Incident

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(title: Text("What it is about", bundle: #bundle, comment: "Title of what an incident is about."))
            Panel {
                switch incident.evidence {
                case .down(let down):
                    SubjectRow(
                        label: Text("Monitor", bundle: #bundle, comment: "The URL a down incident's monitor fetches."),
                        name: down.url, route: .monitor(project: project, id: down.monitor))
                    PanelDivider()
                    FactRow(label: Text("Failed checks", bundle: #bundle, comment: "How many checks in a row failed."))
                    {
                        Text(down.failures, format: .number)
                    }
                    PanelDivider()
                    FactRow(label: Text("Problem", bundle: #bundle, comment: "Why a monitor's check failed.")) {
                        Text(verbatim: down.problem)
                    }
                case .failing(let failing):
                    SubjectRow(
                        label: Text("Operation", bundle: #bundle, comment: "The operation an incident is about."),
                        name: failing.operation, route: operation(failing.operation))
                    PanelDivider()
                    FactRow(label: Text("Failed", bundle: #bundle, comment: "How many runs of an operation failed.")) {
                        Text(
                            "\(failing.failed) of \(failing.count) in 15 min", bundle: #bundle,
                            comment: "How many runs failed of how many over 15 minutes. The variables are counts.")
                    }
                    PanelDivider()
                    FactRow(label: Text("Usually", bundle: #bundle, comment: "An operation's usual share failed.")) {
                        Text(failing.usualRate, format: .percent.precision(.fractionLength(0...1)))
                    }
                case .stopped(let stopped):
                    SubjectRow(
                        label: Text("Operation", bundle: #bundle, comment: "The operation an incident is about."),
                        name: stopped.operation, route: operation(stopped.operation))
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
                case .monitor(let fired):
                    SubjectRow(
                        label: Text("Monitor", bundle: #bundle, comment: "The monitor an incident is about."),
                        name: MonitorConditionText(condition: fired.condition).text,
                        route: .monitor(project: project, id: fired.monitor))
                    if let route = subject(fired.condition.subject) {
                        PanelDivider()
                        SubjectRow(
                            label: Text("Watches", bundle: #bundle, comment: "What a monitor watches."),
                            name: fired.name, route: route)
                    }
                    PanelDivider()
                    FactRow(label: Text("Measured", bundle: #bundle, comment: "What a monitor measured when it fired."))
                    {
                        MonitorMeasuredText(condition: fired.condition, value: fired.value)
                    }
                case .unknown:
                    FactRow(label: Text("Evidence", bundle: #bundle, comment: "What opened an incident.")) {
                        Text(
                            "Update the app to see it.", bundle: #bundle,
                            comment: "Evidence of a kind this app doesn't know.")
                    }
                }
                PanelDivider()
                FactRow(
                    label: Text("Where", bundle: #bundle, comment: "The component, and environment, an incident is in.")
                ) {
                    Text(verbatim: incident.environment.map { "\(incident.component), \($0)" } ?? incident.component)
                }
            }
        }
    }

    // The screen of what a monitor watches, when it has one here: its operation, error or log
    // message, in the incident's component and environment.
    private func subject(_ subject: MonitorSubject) -> Route? {
        let telemetry = Telemetry.project(project, environment: incident.environment)
        switch subject {
        case .operation(let name): return operation(name)
        case .error(let id): return .error(of: telemetry, id: id)
        case .message(let id): return .logMessage(of: telemetry, id: id)
        case .url, .event, .unknown: return nil
        }
    }

    // The operation's screen, in the incident's component and environment.
    private func operation(_ name: String) -> Route {
        .operation(
            OperationRef(project: project, component: incident.component, environment: incident.environment, name: name)
        )
    }
}

/// The monitor or operation an incident is about, opening its screen.
private struct SubjectRow: View {
    let label: Text
    let name: Text
    let route: Route

    init(label: Text, name: String, route: Route) {
        self.init(label: label, name: Text(verbatim: name), route: route)
    }

    init(label: Text, name: Text, route: Route) {
        self.label = label
        self.name = name
        self.route = route
    }

    var body: some View {
        NavigationLink(value: route) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                label
                    .foregroundStyle(Palette.secondary)
                Spacer(minLength: 8)
                name
                    .unhyphenated()
                    .font(.subheadline.monospaced())
                    .foregroundStyle(Palette.blue)
                    .multilineTextAlignment(.trailing)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Palette.secondary)
                    .accessibilityHidden(true)
            }
            .font(.subheadline)
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(minHeight: 48)
        }
        .buttonStyle(PanelRowStyle())
    }
}

/// An incident's life, the oldest first: each change, when, and what it said then; `Still open` last
/// while it is.
private struct IncidentLife: View {
    let detail: IncidentDetail

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(
                title: Text("Its life", bundle: #bundle, comment: "Title of every change of an incident."),
                trailing: Text("Oldest first", bundle: #bundle, comment: "The order of an incident's changes."))
            Panel {
                ForEach(Array(detail.updates.enumerated()), id: \.offset) { index, update in
                    if index > 0 {
                        PanelDivider()
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            ChangeText(change: update.change)
                            Spacer(minLength: 8)
                            Text(update.at, format: .dateTime.month(.abbreviated).day().hour().minute())
                                .foregroundStyle(Palette.secondary)
                                .monospacedDigit()
                        }
                        if let title = update.title {
                            Text(verbatim: title)
                                .font(.footnote)
                                .foregroundStyle(Palette.secondary)
                                .unhyphenated()
                        }
                    }
                    .font(.subheadline)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .accessibilityElement(children: .combine)
                }
                if detail.incident.resolvedAt == nil {
                    PanelDivider()
                    EmptyRow(text: Text("Still open", bundle: #bundle, comment: "The last of an open incident's life."))
                }
            }
        }
    }
}

/// A change in an incident's life, in a word or two.
private struct ChangeText: View {
    let change: IncidentUpdateChange

    var body: some View {
        switch change {
        case .opened: Text("Opened", bundle: #bundle, comment: "An incident's change: it opened.")
        case .reopened: Text("Came back", bundle: #bundle, comment: "An incident's change: it opened again.")
        case .worsened: Text("Got worse", bundle: #bundle, comment: "An incident's change: what it saw got worse.")
        case .acknowledged:
            Text("Acknowledged", bundle: #bundle, comment: "An incident's change: someone is on it.")
        case .resolved:
            Text("Resolved", bundle: #bundle, comment: "An incident's change: it resolved.")
                .foregroundStyle(Palette.mint)
        default: Text(verbatim: change.rawValue)
        }
    }
}

/// The releases of an incident's component that ran when it opened, each opening its screen.
private struct IncidentReleases: View {
    let project: String
    let detail: IncidentDetail

    var body: some View {
        let component = detail.incident.component
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(
                title: Text(
                    "Running when it opened", bundle: #bundle,
                    comment: "Title of the releases that ran when an incident opened."))
            Panel {
                if detail.releases.isEmpty {
                    EmptyRow(
                        text: Text(
                            "\(component) reported no release running in the hour before it opened.", bundle: #bundle,
                            comment: "No release ran when an incident opened. The variable is a component."))
                }
                ForEach(Array(detail.releases.enumerated()), id: \.offset) { index, ran in
                    if index > 0 {
                        PanelDivider()
                    }
                    NavigationLink(
                        value: Route.release(
                            ReleaseRef(
                                project: project, component: component, environment: ran.environment,
                                version: ran.release))
                    ) {
                        HubRow(color: Palette.purple) {
                            Text(verbatim: ran.release)
                                .monospaced()
                        } value: {
                            Text(verbatim: ran.environment.map { "\(component), \($0)" } ?? component)
                                .foregroundStyle(Palette.secondary)
                        }
                    }
                    .buttonStyle(PanelRowStyle())
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
