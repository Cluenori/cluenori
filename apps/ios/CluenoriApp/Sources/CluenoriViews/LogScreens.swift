import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// A project's warnings and errors in one environment over the period, or one of its releases' over
/// its span, newest first: of one level or all, searched by text, older ones added as the list
/// reaches its end.
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
            if let page = logs.page.value {
                // Under the screen's filters, which the empty state would cover in the middle.
                if page.lines.isEmpty {
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
                }
                ForEach(page.lines + logs.older, id: \.id) { line in
                    NavigationLink {
                        LogLineScreen(line: line)
                    } label: {
                        LogLineRow(time: line.time, level: line.level, component: line.component, message: line.message)
                    }
                }
                if logs.hasOlder {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .task { await logs.loadOlder() }
                }
            }
        }
        .overlay {
            if logs.page.value == nil {
                AnswerPlaceholder(problem: logs.page.problem)
            }
        }
        .navigationTitle(Text("Logs", bundle: #bundle, comment: "Title of a project's warnings and errors."))
        .searchable(text: $search, prompt: Text("Search", bundle: #bundle, comment: "Prompt of the log search."))
        .refreshable { await logs.refresh() }
        .task(id: level) { await logs.filter(level: level, search: search) }
        .onSubmit(of: .search) {
            Task { await logs.filter(level: level, search: search) }
        }
        .task { await logs.refresh() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: logs.page.problem, receivedAt: logs.page.receivedAt)
        }
    }
}

/// Which level of lines to show: every one of warnings and over, or one level.
struct LevelPicker: View {
    @Binding var level: IndexedLevel?

    var body: some View {
        Picker(selection: $level) {
            Text("All", bundle: #bundle, comment: "Every level of log line.").tag(IndexedLevel?.none)
            Text("Warnings", bundle: #bundle, comment: "Log lines at warning level.").tag(IndexedLevel?.some(.warn))
            Text("Errors", bundle: #bundle, comment: "Log lines at error level.").tag(IndexedLevel?.some(.error))
            Text("Fatal", bundle: #bundle, comment: "Log lines at fatal level.").tag(IndexedLevel?.some(.fatal))
        } label: {
            Text("Level", bundle: #bundle, comment: "The picker of which log levels show.")
        }
        .pickerStyle(.segmented)
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

/// One log line in full: what it said, its exception with its stack, and what else it carried.
struct LogLineScreen: View {
    let line: LogLine

    var body: some View {
        List {
            Section {
                LogLineRow(time: line.time, level: line.level, component: line.component, message: line.message)
                Text(line.message)
                    .textSelection(.enabled)
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
        .navigationTitle(Text("Log line", bundle: #bundle, comment: "Title of one log line."))
    }
}
