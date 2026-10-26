import Charts
import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

// How many days each monitor's strip shows on Uptime, and on its own screen.
private let listedDays = 30
private let shownDays = 90

extension UptimeAnswer {
    /// Its color: red when a monitor is down, mint when every checked one is up, gray otherwise.
    var color: Color {
        switch self {
        case .down: Palette.red
        case .up: Palette.mint
        case .noMonitors, .noneChecked: Palette.secondary
        }
    }
}

extension MonitorStatus {
    var color: Color {
        switch self {
        case .up: Palette.mint
        case .down: Palette.red
        case .unchecked: Palette.secondary
        }
    }
}

/// Uptime's answer in a sentence: `All 3 monitors are up`, `1 of 3 monitors is down`.
struct UptimeAnswerText: View {
    let answer: UptimeAnswer

    var body: some View {
        switch answer {
        case .noMonitors:
            Text("No monitors", bundle: #bundle, comment: "Uptime's answer: the project has no monitor.")
        case .noneChecked:
            Text(
                "No monitor has been checked yet", bundle: #bundle,
                comment: "Uptime's answer: no monitor had a check yet.")
        case .down(_, of: 1):
            Text("The monitor is down", bundle: #bundle, comment: "Uptime's answer: the one monitor fails.")
        case .down(1, let total):
            Text(
                "1 of \(total) monitors is down", bundle: #bundle,
                comment: "Uptime's answer: one monitor fails. The variable is how many there are.")
        case .down(let down, let total):
            Text(
                "\(down) of \(total) monitors are down", bundle: #bundle,
                comment: "Uptime's answer: several monitors fail. The variables are counts.")
        case .up(1, unchecked: 0):
            Text("The monitor is up", bundle: #bundle, comment: "Uptime's answer: the one monitor passes.")
        case .up(let up, unchecked: 0):
            Text(
                "All \(up) monitors are up", bundle: #bundle,
                comment: "Uptime's answer: every monitor passes. The variable is a count.")
        case .up(let up, let unchecked):
            Text(
                "^[\(up) monitor](inflect: true) up; \(unchecked) not checked yet", bundle: #bundle,
                comment: "Uptime's answer: those checked pass, some aren't checked yet. The variables are counts.")
        }
    }
}

/// How a monitor is now and for how long, up to its last check: `Up for 3 days`, `Down for 4 min:
/// HTTP 503`, `Up` when when it turned isn't known, `Not checked yet`.
struct MonitorStandingText: View {
    let state: MonitorState

    var body: some View {
        if let check = state.lastCheck {
            let lasted = state.since.map { since in
                Text(
                    Duration.seconds(max(check.at.timeIntervalSince(since), 0)),
                    format: .units(allowed: [.days, .hours, .minutes], width: .abbreviated, maximumUnitCount: 1))
            }
            switch (check.problem, lasted) {
            case (nil, nil): Text("Up", bundle: #bundle, comment: "A monitor passes now.")
            case (nil, let lasted?):
                Text(
                    "Up for \(lasted)", bundle: #bundle,
                    comment: "How long a monitor has passed. The variable is a duration.")
            case (let problem?, nil):
                Text(
                    "Down: \(problem)", bundle: #bundle,
                    comment: "A monitor fails now, and why. The variable is its problem, such as HTTP 503.")
            case (let problem?, let lasted?):
                Text(
                    "Down for \(lasted): \(problem)", bundle: #bundle,
                    comment: "How long a monitor has failed, and why. The variables are a duration and its problem.")
            }
        } else {
            Text("Not checked yet", bundle: #bundle, comment: "A monitor that had no check yet.")
        }
    }
}

/// A monitor's days as a strip of cells, the oldest first: mint when every check passed, yellow when
/// some failed, red when all did, gray when it wasn't checked while watched (unknown, never up), and
/// faint before it was added. Said in a sentence to VoiceOver.
struct UptimeStrip: View {
    let days: [StripDay]
    var height: CGFloat = 22

    var body: some View {
        HStack(spacing: 1) {
            ForEach(days, id: \.day) { day in
                Rectangle()
                    .fill(color(day.tone))
            }
        }
        .frame(height: height)
        .clipShape(.rect(cornerRadius: 3))
        .accessibilityElement()
        .accessibilityLabel(label)
    }

    private func color(_ tone: StripDay.Tone) -> Color {
        switch tone {
        case .up: Palette.mint
        case .some: Palette.yellow
        case .down: Palette.red
        case .unchecked: Palette.secondary.opacity(0.35)
        case .before: Palette.divider
        }
    }

    private var label: Text {
        let checked = days.filter { $0.checks > 0 }
        let failing = checked.filter { $0.failed > 0 }.count
        let share = UptimeFacts.passedShare(
            checks: checked.reduce(0) { $0 + $1.checks }, failed: checked.reduce(0) { $0 + $1.failed })
        guard let share else {
            return Text(
                "Last \(days.count) days: not checked", bundle: #bundle,
                comment: "A monitor's strip of days with no check. The variable is how many days.")
        }
        return Text(
            "Last \(days.count) days: \(share, format: .percent.precision(.fractionLength(0...2))) up, ^[\(failing) day](inflect: true) with failed checks",
            bundle: #bundle,
            comment:
                "A monitor's strip of days. The variables are how many days, the share up, and how many days failed.")
    }
}

/// A share of checks that passed, `99.86%`, or a dash when there were none.
struct PassedShareText: View {
    let share: Double?

    var body: some View {
        if let share {
            Text(share, format: .percent.precision(.fractionLength(0...2)))
                .monospacedDigit()
        } else {
            Text(verbatim: "–")
                .foregroundStyle(Palette.secondary)
        }
    }
}

/// Uptime, every monitor of a project, a list (`concept/Experience.md`): first whether every monitor
/// is up; then each, with how it is now and since when, its last 30 days, a cell each, and its
/// uptime over them, each opening its own screen. Without monitors, how to add one.
struct UptimeScreen: View {
    let monitors: MonitorsModel

    var body: some View {
        PanelScreen(spacing: 24) {
            if let list = monitors.monitors.value {
                let answer = UptimeAnswer(list.monitors)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        BaselineDot(color: answer.color, textStyle: .title3)
                        UptimeAnswerText(answer: answer)
                            .font(.title3.weight(.semibold))
                    }
                    .accessibilityElement(children: .combine)
                    Text(
                        "Each monitor is fetched every minute, and passes with a status below 400 within 10 seconds. Two failed checks in a row open an incident.",
                        bundle: #bundle, comment: "How Uptime checks its monitors."
                    )
                    .font(.footnote)
                    .foregroundStyle(Palette.secondary)
                }
                VStack(alignment: .leading, spacing: 0) {
                    PanelTitle(
                        title: Text("Monitors", bundle: #bundle, comment: "Title of a project's monitors."),
                        trailing: Text(
                            "Last \(listedDays) days", bundle: #bundle,
                            comment: "How many days each monitor's strip shows. The variable is a count."))
                    Panel {
                        if list.monitors.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(
                                    "No monitors. Add one for each component, such as its health endpoint:",
                                    bundle: #bundle, comment: "A project without monitors, and how to add one.")
                                Text(verbatim: "./cluenori monitor add \(monitors.project) <component> <url>")
                                    .font(.footnote.monospaced())
                                    .foregroundStyle(Palette.secondary)
                                    .textSelection(.enabled)
                            }
                            .font(.subheadline)
                            .padding(14)
                        }
                        ForEach(Array(list.monitors.enumerated()), id: \.element.monitor.id) { index, state in
                            if index > 0 {
                                PanelDivider()
                            }
                            NavigationLink(value: Route.monitor(project: monitors.project, id: state.monitor.id)) {
                                MonitorRow(state: state)
                            }
                            .buttonStyle(PanelRowStyle())
                        }
                    }
                }
            } else {
                AnswerPlaceholder(problem: monitors.monitors.problem)
                    .frame(maxWidth: .infinity, minHeight: 300)
            }
        }
        .navigationTitle(Text("Uptime", bundle: #bundle, comment: "Title of a project's monitors."))
        .refreshable { await monitors.monitors.load() }
        .task { await monitors.monitors.load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: monitors.monitors.problem, receivedAt: monitors.monitors.receivedAt)
        }
    }
}

/// One monitor on Uptime: its URL, its component and how it is now, its last 30 days and its uptime
/// over them.
private struct MonitorRow: View {
    let state: MonitorState
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        let now = Date.now
        let share = PassedShareText(
            share: UptimeFacts.passedShare(UptimeFacts.lastDays(of: state, now: now, days: listedDays))
        )
        .font(.subheadline)
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                BaselineDot(color: state.status.color, textStyle: .subheadline)
                VStack(alignment: .leading, spacing: 3) {
                    Text(verbatim: state.monitor.url)
                        .unhyphenated()
                        .font(.subheadline.monospaced())
                    // At accessibility sizes, each on its own line, and the share under them.
                    let layout =
                        size.isAccessibilitySize
                        ? AnyLayout(VStackLayout(alignment: .leading, spacing: 3))
                        : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 6))
                    layout {
                        Text(verbatim: state.monitor.component)
                            .foregroundStyle(Palette.secondary)
                        MonitorStandingText(state: state)
                            .foregroundStyle(state.status == .unchecked ? Palette.secondary : state.status.color)
                        if size.isAccessibilitySize {
                            share
                        }
                    }
                    .font(.footnote)
                }
                if !size.isAccessibilitySize {
                    Spacer(minLength: 8)
                    share
                }
            }
            UptimeStrip(days: UptimeFacts.strip(of: state, now: now, length: listedDays))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }
}

/// One monitor, by its ID, an item (`concept/Experience.md`): no period, its whole history. How it
/// is now and since when first; then its last 24 hours by five minutes, its last 90 days, its
/// incidents, each opening its own screen, and its failed checks; and "Ask an agent".
struct MonitorScreen: View {
    let monitor: MonitorModel

    var body: some View {
        Group {
            if let detail = monitor.detail.value {
                PanelScreen(spacing: 24) {
                    MonitorHeading(state: detail.state)
                    RecentPanel(recent: detail.recent)
                    DaysPanel(state: detail.state)
                    MonitorIncidents(project: monitor.project, incidents: detail.incidents)
                    FailuresPanel(failures: detail.failures)
                }
            } else {
                AnswerPlaceholder(problem: monitor.detail.problem)
            }
        }
        .navigationTitle(Text("Monitor", bundle: #bundle, comment: "Title of one monitor."))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            if let detail = monitor.detail.value {
                ToolbarItem(placement: .primaryAction) {
                    AskAnAgent(brief: UptimeBriefs.monitor(project: monitor.project, detail: detail, now: .now))
                }
            }
        }
        .refreshable { await monitor.detail.load() }
        .task { await monitor.detail.load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: monitor.detail.problem, receivedAt: monitor.detail.receivedAt)
        }
    }
}

/// How a monitor is now, in its color, over its URL; its component, since when it is watched, and
/// its last check.
private struct MonitorHeading: View {
    let state: MonitorState

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                BaselineDot(color: state.status.color, textStyle: .footnote)
                MonitorStandingText(state: state)
                    .foregroundStyle(state.status == .unchecked ? Palette.secondary : state.status.color)
            }
            .font(.footnote.weight(.semibold))
            Text(verbatim: state.monitor.url)
                .font(.title3.monospaced().bold())
                .unhyphenated()
            VStack(alignment: .leading, spacing: 2) {
                Text(
                    "\(state.monitor.component), watched since \(state.monitor.addedAt, format: .dateTime.month(.abbreviated).day().year())",
                    bundle: #bundle,
                    comment:
                        "A monitor's component, and since when it is fetched. The variables are a component and a date."
                )
                if let check = state.lastCheck {
                    Group {
                        switch (check.status, check.ms) {
                        case (let status?, let ms?):
                            Text(
                                "Last checked \(check.at, format: .dateTime.hour().minute()): HTTP \(status, format: .number.grouping(.never)) in \(Duration.milliseconds(ms), format: DurationText.style(ms))",
                                bundle: #bundle,
                                comment:
                                    "A monitor's last check. The variables are a time, a status code and a duration.")
                        case (let status?, nil):
                            Text(
                                "Last checked \(check.at, format: .dateTime.hour().minute()): HTTP \(status, format: .number.grouping(.never))",
                                bundle: #bundle,
                                comment: "A monitor's last check. The variables are a time and a status code.")
                        default:
                            Text(
                                "Last checked \(check.at, format: .dateTime.hour().minute()), no answer",
                                bundle: #bundle,
                                comment: "A monitor's last check, which got no answer. The variable is a time.")
                        }
                    }
                }
            }
            .font(.footnote)
            .foregroundStyle(Palette.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Numbers side by side in a panel's last row, each over its label.
private struct PanelNumbers: View {
    let numbers: [(label: Text, value: AnyView)]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(numbers.enumerated()), id: \.offset) { index, number in
                if index > 0 {
                    Rectangle().fill(Palette.divider).frame(width: 1).accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 4) {
                    number.label
                        .font(.caption)
                        .foregroundStyle(Palette.secondary)
                    number.value
                        .font(.headline.monospacedDigit())
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .accessibilityElement(children: .combine)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

/// A monitor's last 24 hours: how long its answers took on average, and its failed checks, every
/// five minutes; a step without checks shows nothing, unknown rather than 0.
private struct RecentPanel: View {
    let recent: [MonitorStep]

    var body: some View {
        let checks = recent.reduce(0) { $0 + $1.checks }
        let failed = recent.reduce(0) { $0 + $1.failed }
        let slowest = recent.compactMap(\.slowestMs).max()
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(
                title: Text("Last 24 hours", bundle: #bundle, comment: "Title of a monitor's last day of checks."),
                trailing: Text("Every 5 min", bundle: #bundle, comment: "How a monitor's last day is shown."))
            Panel {
                if checks == 0 {
                    EmptyRow(
                        text: Text(
                            "Not checked in the last 24 hours.", bundle: #bundle,
                            comment: "A monitor with no check in the last day."))
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Answer time", bundle: #bundle, comment: "How long a monitor's answers took.")
                            .font(.caption)
                            .foregroundStyle(Palette.secondary)
                        Chart {
                            ForEach(recent, id: \.start) { step in
                                if let average = step.averageMs {
                                    BarMark(
                                        x: .value(
                                            String(localized: "Time", bundle: #bundle), step.start, unit: .minute),
                                        y: .value(String(localized: "Answer time", bundle: #bundle), average),
                                        width: .fixed(1.5)
                                    )
                                    .foregroundStyle(step.failed > 0 ? Palette.red : Palette.mint)
                                }
                            }
                        }
                        .chartXAxis {
                            AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                                AxisGridLine()
                                AxisValueLabel(format: .dateTime.hour().minute())
                            }
                        }
                        .chartYAxis {
                            AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                                AxisGridLine()
                                AxisValueLabel {
                                    if let ms = value.as(Double.self) {
                                        DurationText(milliseconds: ms)
                                    }
                                }
                            }
                        }
                        .frame(height: 120)
                        .accessibilityLabel(
                            Text(
                                "How long the monitor's answers took on average, every five minutes; red where a check failed.",
                                bundle: #bundle, comment: "What a monitor's chart of its last day shows."))
                    }
                    .padding(14)
                }
                PanelDivider()
                PanelNumbers(numbers: [
                    (
                        Text("Up", bundle: #bundle, comment: "The share of a monitor's checks that passed."),
                        AnyView(
                            PassedShareText(
                                share: UptimeFacts.passedShare(checks: checks, failed: failed)))
                    ),
                    (
                        Text("Checks", bundle: #bundle, comment: "How many checks a monitor had."),
                        AnyView(Text(checks, format: .number))
                    ),
                    (
                        Text("Failed", bundle: #bundle, comment: "How many of a monitor's checks failed."),
                        AnyView(Text(failed, format: .number).foregroundStyle(failed > 0 ? Palette.red : Palette.text))
                    ),
                    (
                        Text("Slowest", bundle: #bundle, comment: "A monitor's slowest answer."),
                        AnyView(DurationOrDash(ms: slowest))
                    ),
                ])
            }
        }
    }
}

// A duration, or a dash when there is none.
private struct DurationOrDash: View {
    let ms: Double?

    var body: some View {
        if let ms {
            DurationText(milliseconds: ms)
        } else {
            Text(verbatim: "–").foregroundStyle(Palette.secondary)
        }
    }
}

/// A monitor's last 90 days, a cell each, and its uptime over the last 7, 30 and 90.
private struct DaysPanel: View {
    let state: MonitorState

    var body: some View {
        let now = Date.now
        let days = UptimeFacts.strip(of: state, now: now, length: shownDays)
        let over = { (span: Int) in
            AnyView(
                PassedShareText(share: UptimeFacts.passedShare(UptimeFacts.lastDays(of: state, now: now, days: span))))
        }
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(
                title: Text("Last 90 days", bundle: #bundle, comment: "Title of a monitor's last 90 days."),
                trailing: Text("A cell a UTC day", bundle: #bundle, comment: "What each cell of a monitor's strip is."))
            Panel {
                VStack(alignment: .leading, spacing: 6) {
                    UptimeStrip(days: days, height: 36)
                    HStack {
                        Text(verbatim: days.first?.day ?? "")
                        Spacer()
                        Text(verbatim: days.last?.day ?? "")
                    }
                    .font(.caption.monospaced())
                    .foregroundStyle(Palette.secondary)
                    .accessibilityHidden(true)
                }
                .padding(14)
                PanelDivider()
                PanelNumbers(numbers: [
                    (Text("7 days", bundle: #bundle, comment: "A monitor's uptime over the last 7 days."), over(7)),
                    (Text("30 days", bundle: #bundle, comment: "A monitor's uptime over the last 30 days."), over(30)),
                    (Text("90 days", bundle: #bundle, comment: "A monitor's uptime over the last 90 days."), over(90)),
                ])
            }
        }
    }
}

/// The incidents of a monitor's URL, the latest opened first, each opening its own screen.
private struct MonitorIncidents: View {
    let project: String
    let incidents: [Incident]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(title: Text("Incidents", bundle: #bundle, comment: "Title of a project's incidents."))
            Panel {
                if incidents.isEmpty {
                    EmptyRow(
                        text: Text(
                            "It never was down two checks in a row.", bundle: #bundle,
                            comment: "A monitor that never opened an incident."))
                }
                ForEach(Array(incidents.enumerated()), id: \.element.id) { index, incident in
                    if index > 0 {
                        PanelDivider()
                    }
                    NavigationLink(value: Route.incident(project: project, id: incident.id)) {
                        IncidentRow(
                            title: incident.title, openedAt: incident.openedAt,
                            acknowledged: incident.acknowledgedAt != nil, resolvedAt: incident.resolvedAt
                        )
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                    }
                    .buttonStyle(PanelRowStyle())
                }
            }
        }
    }
}

/// A monitor's latest failed checks: when, what was wrong, and how long it took to say so.
private struct FailuresPanel: View {
    let failures: [MonitorCheck]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(
                title: Text("Failed checks", bundle: #bundle, comment: "Title of a monitor's failed checks."),
                trailing: Text("Last 7 days", bundle: #bundle, comment: "How long every check of a monitor is kept."))
            Panel {
                if failures.isEmpty {
                    EmptyRow(
                        text: Text(
                            "No check failed in the last 7 days.", bundle: #bundle,
                            comment: "A monitor with no failed check lately."))
                }
                ForEach(Array(failures.enumerated()), id: \.offset) { index, check in
                    if index > 0 {
                        PanelDivider()
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(check.at, format: .dateTime.month(.abbreviated).day().hour().minute())
                            .foregroundStyle(Palette.secondary)
                            .monospacedDigit()
                        Text(verbatim: check.problem ?? "")
                            .foregroundStyle(Palette.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        if let ms = check.ms {
                            DurationText(milliseconds: ms)
                                .foregroundStyle(Palette.secondary)
                        }
                    }
                    .font(.subheadline)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}
