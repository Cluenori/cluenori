import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// A project's warnings and errors in one environment over the period, or one of its releases' over
/// its span, as log messages, the most lines first: lines that say the same but for their values.
/// Of one level or all, searched by what the lines say; each opens its message.
struct LogsScreen: View {
    let logs: LogsModel
    let environments: EnvironmentChoice
    @Bindable var navigation: Navigation
    @State private var level: IndexedLevel?
    @State private var search: String

    init(logs: LogsModel, environments: EnvironmentChoice, navigation: Navigation) {
        self.logs = logs
        self.environments = environments
        self.navigation = navigation
        level = logs.level
        search = logs.search
    }

    var body: some View {
        List {
            CoverageSections(
                telemetry: logs.telemetry,
                release: logs.release,
                environments: environments,
                route: .logs(of: logs.telemetry),
                navigation: navigation
            )
            Section {
                LevelPicker(level: $level)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
            }
            if let table = logs.messages.value {
                // Under the screen's filters, which the empty state would cover in the middle.
                if table.messages.isEmpty {
                    Section {
                        NothingShown(
                            title: logs.search.isEmpty && logs.level == nil
                                ? Text("No warnings or errors", bundle: #bundle, comment: "No log lines in the period.")
                                : Text("Nothing matches", bundle: #bundle, comment: "No log lines matched the filter."),
                            systemImage: "text.page.slash",
                            narrowed: logs.release != nil,
                            period: $navigation.period
                        )
                        .listRowBackground(Color.clear)
                    }
                } else {
                    Section {
                        ForEach(table.messages, id: \.id) { message in
                            NavigationLink(value: Route.logMessage(of: logs.telemetry, id: message.id)) {
                                LogMessageRow(message: message)
                            }
                        }
                    } footer: {
                        LinesFooter(lines: table.lines, unshown: table.unshown)
                    }
                }
            }
        }
        .overlay {
            if logs.messages.value == nil {
                AnswerPlaceholder(problem: logs.messages.problem)
            }
        }
        .navigationTitle(Text("Logs", bundle: #bundle, comment: "Title of a project's warnings and errors."))
        .searchable(text: $search, prompt: Text("Search", bundle: #bundle, comment: "Prompt of the log search."))
        .refreshable { await logs.refresh() }
        .task(id: level) { await logs.filter(level: level, search: search) }
        .onSubmit(of: .search) {
            Task { await logs.filter(level: level, search: search) }
        }
        .onChange(of: search) { _, text in
            // Clearing the search shows every line again.
            if text.isEmpty { Task { await logs.filter(level: level, search: "") } }
        }
        .task { await logs.refresh() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: logs.messages.problem, receivedAt: logs.messages.receivedAt)
        }
    }
}

/// How many lines the messages hold, and how many messages aren't listed.
private struct LinesFooter: View {
    let lines: Int
    let unshown: Int

    var body: some View {
        if unshown > 0 {
            Text(
                "\(lines) lines. \(unshown) more messages match; search to narrow them.", bundle: #bundle,
                comment: "Below the log messages: every matching line, and how many messages aren't listed.")
        } else {
            Text("\(lines) lines.", bundle: #bundle, comment: "Below the log messages: how many lines they hold.")
        }
    }
}

/// Which level of lines to count: warnings and errors, or errors only.
struct LevelPicker: View {
    @Binding var level: IndexedLevel?

    var body: some View {
        Picker(selection: $level) {
            Text("All", bundle: #bundle, comment: "Warnings and errors alike.").tag(IndexedLevel?.none)
            Text("Errors", bundle: #bundle, comment: "Log lines at error level and above.").tag(
                IndexedLevel?.some(.error))
        } label: {
            Text("Level", bundle: #bundle, comment: "The picker of which log levels show.")
        }
        .pickerStyle(.segmented)
    }
}

/// One log message in a list: its level, what it says with its values left out, its logger, and how
/// many lines it had.
struct LogMessageRow: View {
    let message: LogMessage

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    LevelMark(level: message.level)
                    Text(message.lastSeen, format: .relative(presentation: .named))
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                Text(message.title)
                    .lineLimit(3)
                Text(message.category)
                    .font(.footnote.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            Spacer(minLength: 12)
            Text(message.lines, format: .number)
                .font(.body.monospacedDigit().weight(.semibold))
        }
        .accessibilityElement(children: .combine)
    }
}

struct LogLineRow: View {
    let time: Date
    let level: LogLevel
    let component: String
    let message: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                LevelMark(level: level)
                Text(time, format: .dateTime.month().day().hour().minute().second())
                    .monospacedDigit()
                Text(component)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            Text(message)
                .font(.subheadline)
                .lineLimit(3)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A log line's level, as a word in its color: red for errors, orange for warnings.
struct LevelMark: View {
    let level: LogLevel

    var body: some View {
        Text(verbatim: level.rawValue.uppercased())
            .font(.caption2.weight(.semibold).monospaced())
            .foregroundStyle(color)
    }

    private var color: Color {
        switch level {
        case .error, .fatal: .red
        case .warn: .orange
        default: .secondary
        }
    }
}

/// One log message over the period, or over a release's span: what it says, when it was first and
/// last seen, how many lines it had, the errors those are occurrences of, and its newest lines,
/// each opening its own screen.
struct LogMessageScreen: View {
    let message: LogMessageModel
    let environments: EnvironmentChoice
    @Bindable var navigation: Navigation

    var body: some View {
        List {
            CoverageSections(
                telemetry: message.telemetry,
                release: message.release,
                environments: environments,
                route: .logMessage(of: message.telemetry, id: message.id),
                navigation: navigation
            )
            if let detail = message.detail.value {
                Section {
                    LogMessageSummary(message: detail.message)
                }
                if !detail.errors.isEmpty {
                    Section {
                        ForEach(detail.errors, id: \.id) { group in
                            NavigationLink(value: Route.error(of: message.telemetry, id: group.id)) {
                                ErrorGroupRow(
                                    title: group.title, culprit: group.culprit, occurrences: group.occurrences)
                            }
                        }
                    } header: {
                        Text("Errors", bundle: #bundle, comment: "Section of the errors a log message's lines are.")
                    }
                }
                Section {
                    if detail.message.lines == 0 {
                        // The message is found whatever the period; only its lines are the period's.
                        Text(
                            "None in this period. Last seen \(detail.message.lastSeen, format: .relative(presentation: .named)).",
                            bundle: #bundle,
                            comment: "A log message none of whose lines are in the period, and when it was last seen."
                        )
                        .foregroundStyle(.secondary)
                    } else if let page = message.lines.value {
                        ForEach(page.lines, id: \.id) { line in
                            NavigationLink(value: Route.logLine(project: message.telemetry.project, id: line.id)) {
                                LogLineRow(
                                    time: line.time, level: line.level, component: line.component,
                                    message: line.message)
                            }
                        }
                    }
                } header: {
                    Text("Latest lines", bundle: #bundle, comment: "Section of a log message's newest lines.")
                }
            }
        }
        .overlay {
            if message.detail.value == nil {
                if message.detail.problem == .missing {
                    NothingShown(
                        title: Text(
                            "No such message",
                            bundle: #bundle,
                            comment:
                                "A log message the project doesn't have, or forgot 15 months after it was last seen."
                        ),
                        systemImage: "text.page.slash",
                        narrowed: message.release != nil,
                        period: $navigation.period
                    )
                } else {
                    AnswerPlaceholder(problem: message.detail.problem)
                }
            }
        }
        .navigationTitle(Text("Message", bundle: #bundle, comment: "Title of one log message."))
        .toolbar {
            if let detail = message.detail.value {
                ToolbarItem(placement: .primaryAction) {
                    AskAnAgent(brief: messageBrief(message.telemetry.project, detail.message))
                }
            }
        }
        .refreshable { await message.refresh() }
        .task { await message.refresh() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: message.detail.problem, receivedAt: message.detail.receivedAt)
        }
    }
}

struct LogMessageSummary: View {
    let message: LogMessage

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            LevelMark(level: message.level)
            Text(message.title)
                .font(.headline)
                .textSelection(.enabled)
            Text(message.category)
                .font(.footnote.monospaced())
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 4) {
                GridRow {
                    Text("In the period", bundle: #bundle, comment: "How many lines of a log message the period holds.")
                        .foregroundStyle(.secondary)
                    Text(message.lines, format: .number)
                }
                GridRow {
                    Text("First seen", bundle: #bundle, comment: "When a log message was first logged.")
                        .foregroundStyle(.secondary)
                    Text(message.firstSeen, format: .dateTime.month().day().hour().minute())
                }
                GridRow {
                    Text("Last seen", bundle: #bundle, comment: "When a log message was last logged.")
                        .foregroundStyle(.secondary)
                    Text(message.lastSeen, format: .dateTime.month().day().hour().minute())
                }
                GridRow {
                    Text(
                        "In", bundle: #bundle, comment: "The component, and its release, a message was last logged in."
                    )
                    .foregroundStyle(.secondary)
                    Text(
                        verbatim: message.lastRelease.map { "\(message.lastComponent) \($0)" } ?? message.lastComponent)
                }
            }
            .font(.subheadline)
        }
        .padding(.vertical, 4)
    }
}

// What an agent needs to look into one message: what it is, and how to read its lines. In English,
// as the CLI and the API it names speak.
private func messageBrief(_ project: String, _ message: LogMessage) -> String {
    let since = message.firstSeen.formatted(.iso8601)
    let last = message.lastSeen.formatted(.iso8601)
    return [
        "Look into this log message in Cluenori project \(project): \(message.level.rawValue) \"\(message.title)\" from \(message.category).",
        "Message \(message.id): first seen \(since)\(message.firstRelease.map { " in \($0)" } ?? ""), last \(last) in \(message.lastComponent)\(message.lastRelease.map { " \($0)" } ?? "").",
        "Read its lines with ./cluenori logs \(project) --message \(message.id) --last 90d, or GET /api/projects/\(project)/logs?message=\(message.id); each line by its ID with GET /api/projects/\(project)/logs/lines/<ID>.",
    ].joined(separator: "\n")
}

// What an agent needs to look into one line: where it is, and how to read it, its message and its trace.
private func lineBrief(_ project: String, _ line: LogLine) -> String {
    let said = line.exception.map { "\(line.message)\n\($0.type): \($0.message)" } ?? line.message
    return [
        "Look into this \(line.level.rawValue) in Cluenori project \(project).",
        "Log line \(line.id), at \(line.time.formatted(.iso8601)), in \(line.component)\(line.release.map { " \($0)" } ?? "")\(line.environment.map { " (\($0))" } ?? ""), from \(line.category).",
        said,
        "Read it with the API: GET /api/projects/\(project)/logs/lines/\(line.id); the other lines of its message with ./cluenori logs \(project) --message \(line.messageId) --last 90d"
            + (line.error.map { "; its error with ./cluenori error \(project) \($0)" } ?? "")
            + (line.trace.map { "; its trace with ./cluenori trace \(project) \($0)." } ?? "."),
    ].joined(separator: "\n")
}

/// One log line, by its ID, with no period: kept 90 days.
struct LogLineByIDScreen: View {
    let line: LogLineModel

    var body: some View {
        Group {
            if let shown = line.line.value {
                LogLineScreen(project: line.project, line: shown)
            } else if line.line.problem == .missing {
                ContentUnavailableView {
                    Label {
                        Text(
                            "No longer kept", bundle: #bundle,
                            comment: "A log line older than the 90 days lines are kept.")
                    } icon: {
                        Image(systemName: "text.page.slash")
                    }
                } description: {
                    Text(
                        "Warnings and errors are kept 90 days.", bundle: #bundle,
                        comment: "Why a log line can't be shown.")
                }
            } else {
                AnswerPlaceholder(problem: line.line.problem)
            }
        }
        .navigationTitle(Text("Log line", bundle: #bundle, comment: "Title of one log line."))
        .task { await line.line.load() }
    }
}

/// One log line in full: what it said, its exception with its stack, and what else it carried; the
/// way to every line of its message, and to its error when it is an occurrence of one.
struct LogLineScreen: View {
    let project: String
    let line: LogLine

    var body: some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        LevelMark(level: line.level)
                        Text(line.time, format: .dateTime.month().day().hour().minute().second())
                            .monospacedDigit()
                        Text(line.component)
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    Text(line.message)
                        .textSelection(.enabled)
                }
            }
            Section {
                NavigationLink(value: Route.logMessage(of: .project(project), id: line.messageId)) {
                    Text("Every line of its message", bundle: #bundle, comment: "Opens a log line's message.")
                }
                if let error = line.error {
                    NavigationLink(value: Route.error(of: .project(project), id: error)) {
                        Text("Its error", bundle: #bundle, comment: "Opens the error a log line is an occurrence of.")
                    }
                }
            }
            if let exception = line.exception {
                Section {
                    Text(verbatim: "\(exception.type): \(exception.message)")
                        .font(.subheadline.weight(.semibold))
                        .textSelection(.enabled)
                    if let stack = exception.stack {
                        ScrollView(.horizontal) {
                            Text(stack)
                                .font(.caption.monospaced())
                                .textSelection(.enabled)
                                .fixedSize(horizontal: true, vertical: false)
                        }
                    }
                } header: {
                    Text("Exception", bundle: #bundle, comment: "Section of a log line's exception and stack.")
                }
            }
            Section {
                LabeledContent {
                    Text(line.category)
                } label: {
                    Text("Logger", bundle: #bundle, comment: "The logger that wrote a line.")
                }
                if let environment = line.environment {
                    LabeledContent {
                        Text(environment)
                    } label: {
                        Text("Environment", bundle: #bundle, comment: "Where a component runs.")
                    }
                }
                if let release = line.release {
                    LabeledContent {
                        Text(release)
                    } label: {
                        Text("Release", bundle: #bundle, comment: "The release a line came from.")
                    }
                }
                if let trace = line.trace {
                    LabeledContent {
                        Text(trace).font(.caption.monospaced()).textSelection(.enabled)
                    } label: {
                        Text("Trace", bundle: #bundle, comment: "The trace a line was written in.")
                    }
                }
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                AskAnAgent(brief: lineBrief(project, line))
            }
        }
    }
}
