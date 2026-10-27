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

/// Uptime's answer in a sentence: `All 3 monitors are up`, `1 of 3 monitors is down`; with a
/// monitor of counts among them, `All 3 monitors are fine`, `1 of 3 monitors is firing`.
struct UptimeAnswerText: View {
    let answer: UptimeAnswer
    /// Says fine or firing rather than up or down (`UptimeAnswer.saysFine`).
    var fine = false

    var body: some View {
        if fine {
            fineText
        } else {
            upText
        }
    }

    private var fineText: Text {
        switch answer {
        case .noMonitors:
            Text("No monitors", bundle: #bundle, comment: "Uptime's answer: the project has no monitor.")
        case .noneChecked:
            Text(
                "No monitor has been looked at yet", bundle: #bundle,
                comment: "Uptime's answer: no monitor was looked at yet.")
        case .down(_, of: 1):
            Text("The monitor is firing", bundle: #bundle, comment: "Uptime's answer: the one monitor fires.")
        case .down(1, let total):
            Text(
                "1 of \(total) monitors is firing", bundle: #bundle,
                comment: "Uptime's answer: one monitor fires. The variable is how many there are.")
        case .down(let down, let total):
            Text(
                "\(down) of \(total) monitors are firing", bundle: #bundle,
                comment: "Uptime's answer: several monitors fire. The variables are counts.")
        case .up(1, unchecked: 0):
            Text("The monitor is fine", bundle: #bundle, comment: "Uptime's answer: the one monitor doesn't fire.")
        case .up(let up, unchecked: 0):
            Text(
                "All \(up) monitors are fine", bundle: #bundle,
                comment: "Uptime's answer: no monitor fires. The variable is a count.")
        case .up(let up, let unchecked):
            Text(
                "^[\(up) monitor](inflect: true) fine; \(unchecked) not looked at yet", bundle: #bundle,
                comment: "Uptime's answer: those looked at don't fire, some weren't yet. The variables are counts.")
        }
    }

    private var upText: Text {
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

/// A monitor's window, as its owner set it: `30 minutes`, `12 hours`, `1 day`.
private func window(_ minutes: Int) -> Text {
    Text(
        Duration.seconds(minutes * 60),
        format: .units(allowed: [.days, .hours, .minutes], width: .wide, maximumUnitCount: 2))
}

private func milliseconds(_ ms: Double) -> Text {
    Text(Duration.milliseconds(ms), format: DurationText.style(ms))
}

private func percent(_ percent: Double) -> Text {
    Text(percent / 100, format: .percent.precision(.fractionLength(0...1)))
}

/// What a monitor watches: its URL or operation, `Event user.registered`, `Error 3f9c…`, `Log
/// message 12`.
struct MonitorSubjectText: View {
    let subject: MonitorSubject

    var body: some View {
        text
    }

    var text: Text {
        switch subject {
        case .url(let url): Text(verbatim: url)
        case .operation(let operation): Text(verbatim: operation)
        case .event(let event):
            Text("Event \(event)", bundle: #bundle, comment: "A monitor's subject: an event. The variable is its name.")
        case .error(let error):
            Text(
                "Error \(error)", bundle: #bundle,
                comment: "A monitor's subject: an error group. The variable is its ID.")
        case .message(let message):
            Text(
                "Log message \(message)", bundle: #bundle,
                comment: "A monitor's subject: a log message. The variable is its number.")
        case .unknown:
            Text("Update the app to see it", bundle: #bundle, comment: "A monitor's subject this app doesn't know.")
        }
    }
}

/// When a monitor fires: `Doesn't answer two checks in a row`, `Nothing for 30 minutes`, `p95 above
/// 500 ms over 15 minutes`.
struct MonitorConditionText: View {
    let condition: MonitorCondition

    var body: some View {
        text
    }

    var text: Text {
        switch condition {
        case .noAnswer:
            Text(
                "Doesn't answer two checks in a row", bundle: #bundle,
                comment: "A URL monitor's condition: two failed checks in a row.")
        case .nothingFor(let nothing):
            Text(
                "Nothing for \(window(nothing.minutes))", bundle: #bundle,
                comment: "A monitor's condition: no run or event for a while. The variable is a duration.")
        case .moreThan(let more):
            Text(
                "More than \(more.count) in \(window(more.minutes))", bundle: #bundle,
                comment: "A monitor's condition: too many in a window. The variables are a count and a duration.")
        case .latencyAbove(let latency):
            Text(
                "\(latency.percentileName) above \(milliseconds(latency.ms)) over \(window(latency.minutes))",
                bundle: #bundle,
                comment:
                    "A monitor's condition: an operation's latency too slow. The variables are a percentile, such as p95, and durations."
            )
        case .errorRateAbove(let rate):
            Text(
                "More than \(percent(rate.percent)) failed over \(window(rate.minutes))", bundle: #bundle,
                comment:
                    "A monitor's condition: too many of an operation's runs failed. The variables are a share and a duration."
            )
        case .unknown:
            Text("Update the app to see it", bundle: #bundle, comment: "A monitor's condition this app doesn't know.")
        }
    }
}

/// What a monitor of counts measured at its last look: `0 in 30 minutes`, `p95 820 ms`, `12%
/// failed`, or that there were too few runs to judge.
private func measured(_ condition: MonitorCondition, _ value: Double?) -> Text {
    guard let value else {
        return Text("too few runs to judge", bundle: #bundle, comment: "A monitor of an operation that ran too little.")
    }
    switch condition {
    case .nothingFor(let nothing):
        return Text(
            "\(Int(value)) in \(window(nothing.minutes))", bundle: #bundle,
            comment: "What a monitor counted. The variables are a count and a duration.")
    case .moreThan(let more):
        return Text(
            "\(Int(value)) in \(window(more.minutes))", bundle: #bundle,
            comment: "What a monitor counted. The variables are a count and a duration.")
    case .latencyAbove(let latency):
        return Text(
            "\(latency.percentileName) \(milliseconds(value))", bundle: #bundle,
            comment: "An operation's latency. The variables are a percentile, such as p95, and a duration.")
    case .errorRateAbove:
        return Text(
            "\(percent(value)) failed", bundle: #bundle, comment: "The share of an operation's runs that failed.")
    case .noAnswer, .unknown:
        return Text(value, format: .number)
    }
}

/// What a monitor of counts measured: `0 in 30 minutes`, `p95 820 ms`, `12% failed`.
struct MonitorMeasuredText: View {
    let condition: MonitorCondition
    let value: Double?

    var body: some View {
        measured(condition, value)
    }
}

/// A monitor in a line: its URL, or its subject and condition, `cleanup.run: Nothing for 30 minutes`.
struct MonitorNameText: View {
    let monitor: Monitor

    var body: some View {
        text
    }

    var text: Text {
        if let url = monitor.url {
            return Text(verbatim: url)
        }
        return Text(
            "\(MonitorSubjectText(subject: monitor.condition.subject).text): \(MonitorConditionText(condition: monitor.condition).text)",
            bundle: #bundle, comment: "A monitor in a line. The variables are its subject and its condition.")
    }
}

/// How a monitor is now and for how long, up to its last check: `Up for 3 days`, `Down for 4 min:
/// HTTP 503`, `Up` when when it turned isn't known, `Not checked yet`; a monitor of counts's by what
/// it measured last: `Firing: p95 820 ms`, `Fine: 3 in 30 minutes`, `Not looked at yet`.
struct MonitorStandingText: View {
    let state: MonitorState

    var body: some View {
        if state.monitor.url == nil {
            if let measure = state.measured {
                let value = measured(state.monitor.condition, measure.value)
                if state.firing {
                    Text(
                        "Firing: \(value)", bundle: #bundle, comment: "A monitor that fires now, and what it measured.")
                } else {
                    Text(
                        "Fine: \(value)", bundle: #bundle, comment: "A monitor that doesn't fire, and what it measured."
                    )
                }
            } else {
                Text("Not looked at yet", bundle: #bundle, comment: "A monitor of counts that wasn't looked at yet.")
            }
        } else if let check = state.lastCheck {
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
                        UptimeAnswerText(answer: answer, fine: UptimeAnswer.saysFine(list.monitors))
                            .font(.title3.weight(.semibold))
                    }
                    .accessibilityElement(children: .combine)
                    Text(
                        "Every monitor is looked at each minute. A URL passes with a status below 400 within 10 seconds, and two failed checks in a row open an incident; a monitor of an operation, an error, a log message or an event opens one when its condition holds.",
                        bundle: #bundle, comment: "How Uptime looks at its monitors."
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
                                Text(verbatim: "./cluenori monitor add \(monitors.project) <component> --url <url>")
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
        .answerBanner(problem: monitors.monitors.problem, receivedAt: monitors.monitors.receivedAt)
    }
}

/// One monitor on Uptime: its URL, its component and how it is now, its last 30 days and its uptime
/// over them; a monitor of counts, which has no checks, without the days.
private struct MonitorRow: View {
    let state: MonitorState
    @Environment(\.dynamicTypeSize) private var size

    var body: some View {
        let now = Date.now
        let checked = state.monitor.url != nil
        let share = PassedShareText(
            share: UptimeFacts.passedShare(UptimeFacts.lastDays(of: state, now: now, days: listedDays))
        )
        .font(.subheadline)
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                BaselineDot(color: state.status.color, textStyle: .subheadline)
                VStack(alignment: .leading, spacing: 3) {
                    MonitorNameText(monitor: state.monitor).text
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
                        if size.isAccessibilitySize && checked {
                            share
                        }
                    }
                    .font(.footnote)
                }
                if !size.isAccessibilitySize && checked {
                    Spacer(minLength: 8)
                    share
                }
            }
            if checked {
                UptimeStrip(days: UptimeFacts.strip(of: state, now: now, length: listedDays))
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }
}

/// One monitor, by its ID, an item (`concept/Experience.md`): no period, its whole history. How it
/// is now and since when first; then its last 24 hours by five minutes, its last 90 days, its
/// incidents, each opening its own screen, and its failed checks; and "Ask an agent".
///
/// A monitor of counts has no checks: what it watches, when it fires and how its alerts come take
/// their place. Removing it, after a confirmation, is in the toolbar's menu.
struct MonitorScreen: View {
    let monitor: MonitorModel
    /// The project's monitors, which removing it changes.
    let monitors: MonitorsModel
    @Environment(\.dismiss) private var dismiss
    @State private var confirming = false
    @State private var notRemoved: MonitorsModel.Problem? = nil

    var body: some View {
        Group {
            if let detail = monitor.detail.value {
                PanelScreen(spacing: 24) {
                    MonitorHeading(state: detail.state)
                    if let notRemoved {
                        Text(
                            notRemoved == .unreachable
                                ? String(
                                    localized: "Couldn't remove it: the deployment didn't answer.", bundle: #bundle,
                                    comment: "Removing a monitor failed: offline.")
                                : String(
                                    localized: "Couldn't remove it.", bundle: #bundle,
                                    comment: "Removing a monitor failed.")
                        )
                        .font(.footnote)
                        .foregroundStyle(Palette.red)
                    }
                    if detail.state.monitor.url == nil {
                        ConditionPanel(state: detail.state)
                    } else {
                        RecentPanel(recent: detail.recent)
                        DaysPanel(state: detail.state)
                    }
                    MonitorIncidents(
                        project: monitor.project, incidents: detail.incidents,
                        fetches: detail.state.monitor.url != nil)
                    if detail.state.monitor.url != nil {
                        FailuresPanel(failures: detail.failures)
                    }
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
                ToolbarItem(placement: .secondaryAction) {
                    Button(role: .destructive) {
                        confirming = true
                    } label: {
                        Label {
                            Text(
                                "Remove Monitor…", bundle: #bundle, comment: "Removes a monitor, after a confirmation.")
                        } icon: {
                            Image(systemName: "trash")
                        }
                    }
                    .disabled(monitors.removing != nil)
                }
            }
        }
        .confirmationDialog(
            String(
                localized: "Remove this monitor?", bundle: #bundle,
                comment: "Title of the confirmation before removing a monitor."),
            isPresented: $confirming,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task {
                    notRemoved = await monitors.remove(monitor.id)
                    if notRemoved == nil {
                        dismiss()
                    }
                }
            } label: {
                Text("Remove Monitor", bundle: #bundle, comment: "Confirms removing a monitor.")
            }
        } message: {
            Text(
                "It is no longer looked at, and its open incident resolves. Its incidents stay.", bundle: #bundle,
                comment: "What removing a monitor does.")
        }
        .refreshable { await monitor.detail.load() }
        .task { await monitor.detail.load() }
        .answerBanner(problem: monitor.detail.problem, receivedAt: monitor.detail.receivedAt)
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
            MonitorNameText(monitor: state.monitor).text
                .font(.title3.monospaced().bold())
                .unhyphenated()
            VStack(alignment: .leading, spacing: 2) {
                Text(
                    "\(state.monitor.environment.map { "\(state.monitor.component), \($0)" } ?? state.monitor.component), watched since \(state.monitor.addedAt, format: .dateTime.month(.abbreviated).day().year())",
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

/// What a monitor of counts watches, when it fires, how its alerts come, and what it measured last.
private struct ConditionPanel: View {
    let state: MonitorState

    var body: some View {
        let monitor = state.monitor
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(title: Text("Condition", bundle: #bundle, comment: "Title of when a monitor fires."))
            Panel {
                FactRow(label: Text("Watches", bundle: #bundle, comment: "What a monitor watches.")) {
                    MonitorSubjectText(subject: monitor.condition.subject)
                }
                PanelDivider()
                FactRow(label: Text("Fires on", bundle: #bundle, comment: "When a monitor fires.")) {
                    MonitorConditionText(condition: monitor.condition)
                }
                PanelDivider()
                FactRow(label: Text("Alerts", bundle: #bundle, comment: "How a monitor's alerts come.")) {
                    switch monitor.level {
                    case .alarm:
                        Text("Ring like an alarm", bundle: #bundle, comment: "A monitor's alerts ring like an alarm.")
                    case .timeSensitive:
                        Text("Time-sensitive", bundle: #bundle, comment: "A monitor's alerts come time-sensitive.")
                    case .quiet:
                        Text(
                            "Quiet: no push", bundle: #bundle,
                            comment: "A monitor whose incidents send no push.")
                    default:
                        Text(verbatim: monitor.level.rawValue)
                    }
                }
                if let measure = state.measured {
                    PanelDivider()
                    FactRow(label: Text("Last looked", bundle: #bundle, comment: "When a monitor was last looked at."))
                    {
                        Text(measure.at, format: .dateTime.hour().minute())
                    }
                }
            }
        }
    }
}

/// The incidents of a monitor, the latest opened first, each opening its own screen.
private struct MonitorIncidents: View {
    let project: String
    let incidents: [Incident]
    /// Whether it fetches a URL, whose incidents open on two failed checks in a row.
    let fetches: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(title: Text("Incidents", bundle: #bundle, comment: "Title of a project's incidents."))
            Panel {
                if incidents.isEmpty {
                    EmptyRow(
                        text: fetches
                            ? Text(
                                "It never was down two checks in a row.", bundle: #bundle,
                                comment: "A monitor that never opened an incident.")
                            : Text("It never fired.", bundle: #bundle, comment: "A monitor of counts that never fired.")
                    )
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

/// "Monitor this", a form in a sheet, of what a screen shows: when it fires (for an operation,
/// nothing for, latency above or error rate above; for an error or a log message, more than N), its
/// number and window, and the level of its alerts; below, the monitor in words, or what is wrong with
/// it. Added, or already there, its monitor's screen opens.
struct MonitorSheet: View {
    /// What the screen calls its subject: an operation's name, an error's or a log message's title.
    let name: String
    let component: String
    /// Its environment; nil for any.
    let environment: String?
    let monitors: MonitorsModel
    /// Opens the monitor of this ID, once the sheet is closed.
    let open: (String) -> Void
    @State var draft: MonitorDraft
    @State private var problem: MonitorsModel.Added? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(\.locale) private var locale

    private var checked: Result<AddMonitor, MonitorDraft.Refusal> {
        draft.monitor(component: component, environment: environment, locale: locale)
    }

    var body: some View {
        NavigationStack {
            Form {
                if draft.subject.kinds.count > 1 {
                    Section {
                        Picker(selection: $draft.kind) {
                            ForEach(draft.subject.kinds, id: \.self) { kind in
                                kindLabel(kind).tag(kind)
                            }
                        } label: {
                            Text("When it fires", bundle: #bundle, comment: "The choice of a monitor's condition.")
                        }
                        .pickerStyle(.segmented)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                    }
                }
                if draft.kind == .latencyAbove {
                    Section {
                        Picker(selection: $draft.percentile) {
                            ForEach(MonitorDraft.Percentile.allCases, id: \.self) { percentile in
                                Text(verbatim: "p\(Int(percentile.rawValue))").tag(percentile)
                            }
                        } label: {
                            Text("Percentile", bundle: #bundle, comment: "The choice of the latency a monitor judges.")
                        }
                        .pickerStyle(.segmented)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                    } footer: {
                        Text(
                            "Judged of at least \(draft.percentile.runsJudged) runs in its window; fewer are unknown, never an alert.",
                            bundle: #bundle,
                            comment: "How many runs a latency monitor needs. The variable is a count.")
                    }
                }
                Section {
                    if draft.kind != .nothingFor {
                        LabeledContent {
                            TextField(text: $draft.threshold, prompt: Text(verbatim: "")) { thresholdLabel }
                                .multilineTextAlignment(.trailing)
                                .monospacedDigit()
                                #if os(iOS)
                                    .keyboardType(.decimalPad)
                                #endif
                        } label: {
                            thresholdLabel
                        }
                    }
                    LabeledContent {
                        TextField(text: $draft.amount, prompt: Text(verbatim: "")) { windowLabel }
                            .multilineTextAlignment(.trailing)
                            .monospacedDigit()
                            #if os(iOS)
                                .keyboardType(.numberPad)
                            #endif
                    } label: {
                        windowLabel
                    }
                    Picker(selection: $draft.unit) {
                        Text("Minutes", bundle: #bundle, comment: "The unit of a monitor's window.")
                            .tag(MonitorDraft.Unit.minutes)
                        Text("Hours", bundle: #bundle, comment: "The unit of a monitor's window.")
                            .tag(MonitorDraft.Unit.hours)
                        Text("Days", bundle: #bundle, comment: "The unit of a monitor's window.")
                            .tag(MonitorDraft.Unit.days)
                    } label: {
                        Text("Unit", bundle: #bundle, comment: "The choice of the unit of a monitor's window.")
                    }
                } footer: {
                    summary
                }
                Section {
                    Picker(selection: $draft.level) {
                        Text("Ring like an alarm", bundle: #bundle, comment: "A monitor's alerts ring like an alarm.")
                            .tag(AlertLevel.alarm)
                        Text("Time-sensitive", bundle: #bundle, comment: "A monitor's alerts come time-sensitive.")
                            .tag(AlertLevel.timeSensitive)
                        Text("Quiet: no push", bundle: #bundle, comment: "A monitor whose incidents send no push.")
                            .tag(AlertLevel.quiet)
                    } label: {
                        Text("Alerts", bundle: #bundle, comment: "How a monitor's alerts come.")
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                } header: {
                    Text("Alerts", bundle: #bundle, comment: "How a monitor's alerts come.")
                } footer: {
                    levelWords
                }
                if let problem {
                    Section {
                        problemText(problem)
                            .foregroundStyle(Palette.red)
                    }
                }
            }
            .navigationTitle(Text(verbatim: name))
            #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .cancel) {
                        dismiss()
                    } label: {
                        Text("Cancel", bundle: #bundle, comment: "Closes a sheet without acting.")
                    }
                    .disabled(monitors.adding)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        guard case .success(let monitor) = checked else { return }
                        Task {
                            let added = await monitors.add(monitor)
                            switch added {
                            case .added(let id), .exists(let id):
                                dismiss()
                                open(id)
                            default:
                                problem = added
                            }
                        }
                    } label: {
                        if monitors.adding {
                            ProgressView()
                                .accessibilityLabel(
                                    Text("Adding", bundle: #bundle, comment: "The add-monitor button while it sends."))
                        } else {
                            Text("Add", bundle: #bundle, comment: "Adds a monitor.")
                        }
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(monitors.adding || !checked.isSuccess)
                }
            }
        }
    }

    private func kindLabel(_ kind: MonitorDraft.Kind) -> Text {
        switch kind {
        case .nothingFor:
            Text("Nothing for", bundle: #bundle, comment: "A monitor that fires when an operation doesn't run.")
        case .moreThan:
            Text("More than", bundle: #bundle, comment: "A monitor that fires when something comes too often.")
        case .latencyAbove:
            Text("Latency above", bundle: #bundle, comment: "A monitor that fires when an operation is slow.")
        case .errorRateAbove:
            Text("Errors above", bundle: #bundle, comment: "A monitor that fires when too many runs fail.")
        }
    }

    private var thresholdLabel: Text {
        switch draft.kind {
        case .latencyAbove:
            Text("Milliseconds", bundle: #bundle, comment: "The field for a monitor's p95 threshold.")
        case .moreThan:
            Text("Times", bundle: #bundle, comment: "The field for how many times something may come.")
        default:
            Text("Percent failed", bundle: #bundle, comment: "The field for a monitor's error-rate threshold.")
        }
    }

    private var windowLabel: Text {
        draft.kind == .nothingFor
            ? Text("For", bundle: #bundle, comment: "The field for how long nothing may run.")
            : Text("Over", bundle: #bundle, comment: "The field for the window a monitor looks over.")
    }

    // The monitor in words, of the component and environment; or what is wrong with the form.
    @ViewBuilder private var summary: some View {
        switch checked {
        case .success(let monitor):
            if let environment {
                Text(
                    "\(MonitorConditionText(condition: monitor.condition).text), of \(component) in \(environment). Looked at every minute; when it holds, an incident opens.",
                    bundle: #bundle,
                    comment:
                        "What a monitor being added does. The variables are its condition, a component and an environment."
                )
            } else {
                Text(
                    "\(MonitorConditionText(condition: monitor.condition).text), of \(component) in any environment. Looked at every minute; when it holds, an incident opens.",
                    bundle: #bundle,
                    comment: "What a monitor being added does. The variables are its condition and a component.")
            }
        case .failure(.window(let kind)):
            (kind == .nothingFor
                ? Text(
                    "For: whole minutes, 1 minute to 7 days.", bundle: #bundle,
                    comment: "A nothing-for window out of range.")
                : Text(
                    "Over: whole minutes, 1 minute to 1 day.", bundle: #bundle,
                    comment: "A monitor's window out of range."))
                .foregroundStyle(Palette.red)
        case .failure(.threshold(let kind)):
            Group {
                switch kind {
                case .latencyAbove:
                    Text("Milliseconds: 1 to 600,000.", bundle: #bundle, comment: "A p95 threshold out of range.")
                case .moreThan:
                    Text(
                        "Times: a whole number, 0 to 1,000,000.", bundle: #bundle,
                        comment: "A count threshold out of range.")
                default:
                    Text(
                        "Percent failed: more than 0, less than 100.", bundle: #bundle,
                        comment: "An error-rate threshold out of range.")
                }
            }
            .foregroundStyle(Palette.red)
        }
    }

    private var levelWords: Text {
        switch draft.level {
        case .alarm:
            Text(
                "Rings through silent mode and Do Not Disturb.", bundle: #bundle,
                comment: "What an alarm-level alert does.")
        case .quiet:
            Text("Opens an incident without a push.", bundle: #bundle, comment: "What a quiet monitor does.")
        default:
            Text(
                "Breaks through a Focus that allows it.", bundle: #bundle, comment: "What a time-sensitive alert does.")
        }
    }

    private func problemText(_ problem: MonitorsModel.Added) -> Text {
        switch problem {
        case .limitReached(let limit):
            Text(
                "Couldn't add it: a project has at most \(limit) monitors. Remove one on Uptime first.",
                bundle: #bundle,
                comment: "Adding a monitor refused: the project has too many. The variable is the limit.")
        case .unreachable:
            Text(
                "Couldn't add it: the deployment didn't answer.", bundle: #bundle,
                comment: "Adding a monitor failed: offline.")
        default:
            Text("Couldn't add it.", bundle: #bundle, comment: "Adding a monitor failed.")
        }
    }
}

extension Result {
    fileprivate var isSuccess: Bool {
        if case .success = self { true } else { false }
    }
}

/// What a screen's "Monitor this" opens the form on: its project, component and environment (nil for
/// any), what the screen calls its subject, and the draft to start from.
struct MonitorTarget {
    let project: String
    let component: String
    let environment: String?
    let name: String
    let draft: MonitorDraft
}

/// The "Monitor this" button for a screen's toolbar, which opens its form on `target`.
struct MonitorThisButton: View {
    let action: () -> Void

    var body: some View {
        Button {
            action()
        } label: {
            Label {
                Text(
                    "Monitor this", bundle: #bundle,
                    comment: "Opens the form that adds a monitor of what a screen shows.")
            } icon: {
                Image(systemName: "dot.radiowaves.left.and.right")
            }
        }
    }
}

extension View {
    /// Presents the "Monitor this" form while `target` is set, adding to `monitors`; once added, or
    /// already there, the monitor's screen opens over this one.
    func monitorSheet(_ target: Binding<MonitorTarget?>, monitors: MonitorsModel, navigation: Navigation)
        -> some View
    {
        sheet(
            isPresented: Binding {
                target.wrappedValue != nil
            } set: {
                if !$0 { target.wrappedValue = nil }
            }
        ) {
            if let shown = target.wrappedValue {
                MonitorSheet(
                    name: shown.name, component: shown.component, environment: shown.environment,
                    monitors: monitors,
                    open: { id in navigation.push(.monitor(project: shown.project, id: id)) },
                    draft: shown.draft)
            }
        }
    }
}
