import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// One request and its trace, by its ID, with no period, since it is one thing
/// (`concept/Experience.md`, "Lists, groups and items"): what it was and how it ended, every step it
/// took as a waterfall, each opening what it was sent with, and every line it logged; and "Ask an
/// agent", which hands its brief to an agent.
struct TraceScreen: View {
    let trace: TraceModel

    var body: some View {
        List {
            if let view = trace.view.value {
                if let root = view.spans.first {
                    Section {
                        RequestSummary(root: root)
                        if let brief = TraceModel.agentBrief(project: trace.trace.project, view: view) {
                            AskAnAgent(brief: brief)
                        }
                    }
                    Section {
                        ForEach(TraceModel.waterfall(view)) { row in
                            NavigationLink {
                                StepScreen(span: row.span, root: root)
                            } label: {
                                WaterfallRow(row: row)
                            }
                        }
                    } header: {
                        Text("Steps", bundle: #bundle, comment: "Section of a trace's steps, as a waterfall.")
                    } footer: {
                        if view.files.unread > 0 {
                            Text(
                                "Some of the archive's files from around then weren't read, so some steps may be missing.",
                                bundle: #bundle,
                                comment: "A trace with more archive files than were read."
                            )
                        }
                    }
                    Section {
                        if view.logs.isEmpty {
                            Text("Nothing was logged in this trace.", bundle: #bundle, comment: "A trace with no logs.")
                                .foregroundStyle(.secondary)
                        }
                        ForEach(Array(view.logs.enumerated()), id: \.offset) { _, log in
                            LogLineRow(
                                time: log.time, level: log.level ?? .info, component: log.component,
                                message: log.message)
                        }
                    } header: {
                        Text("Log lines", bundle: #bundle, comment: "Section of everything a trace logged.")
                    }
                } else {
                    Text(
                        "The archive has none of this trace's steps. It may be older than 90 days, or from another project.",
                        bundle: #bundle,
                        comment: "A trace the archive has nothing of."
                    )
                    .foregroundStyle(.secondary)
                }
            }
        }
        .overlay {
            if trace.view.value == nil {
                AnswerPlaceholder(problem: trace.view.problem)
            }
        }
        .navigationTitle(Text("Request", bundle: #bundle, comment: "Title of one request and its trace."))
        .refreshable { await trace.view.load() }
        .task { await trace.view.load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: trace.view.problem, receivedAt: trace.view.receivedAt)
        }
    }
}

/// What a request was and how it ended: its operation, how long it took, its status, where and when.
struct RequestSummary: View {
    let root: TraceSpan

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Text(root.name)
                    .font(.headline)
                    .textSelection(.enabled)
                Spacer(minLength: 8)
                if root.failed {
                    Text("failed", bundle: #bundle, comment: "A request that failed.")
                        .font(.caption.monospaced())
                        .foregroundStyle(.red)
                }
            }
            HStack(spacing: 6) {
                DurationText(milliseconds: root.durationMs)
                if let status = TraceModel.status(of: root) {
                    Text(verbatim: "\(status)")
                        .monospacedDigit()
                        .foregroundStyle(status >= 500 ? .red : .secondary)
                }
            }
            .font(.subheadline)
            if let message = root.statusMessage {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(.red)
            }
            Text(
                "\(root.component), \(root.start, format: .dateTime.month(.abbreviated).day().hour().minute().second())",
                bundle: #bundle,
                comment: "Where and when a request ran. The variables are a component and a time."
            )
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }
}

/// One step on the waterfall: its name, under the one that started it, its bar where and how long
/// it ran, red when it failed, and how long it took.
struct WaterfallRow: View {
    let row: TraceModel.Row

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(row.span.name)
                    .lineLimit(1)
                    .foregroundStyle(row.span.failed ? .red : .primary)
                Spacer(minLength: 8)
                DurationText(milliseconds: row.span.durationMs)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .padding(.leading, CGFloat(min(row.span.depth, 6)) * 10)
            GeometryReader { geometry in
                Rectangle()
                    .fill(row.span.failed ? Color.red : color)
                    .frame(width: max(2, geometry.size.width * row.width))
                    .offset(x: geometry.size.width * row.offset)
            }
            .frame(height: 6)
            .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
    }

    // A step's kind, as the web colors it: a server's, a database's, a call's, or work.
    private var color: Color {
        switch row.span.kind {
        case .server, .consumer: Palette.sky
        case .client where row.span.attributes["db.system.name"] != nil: .purple
        case .client, .producer: .teal
        default: .mint
        }
    }
}

/// One step of a trace: when it started within it, how it ended, and everything it was sent with.
struct StepScreen: View {
    let span: TraceSpan
    let root: TraceSpan

    var body: some View {
        List {
            Section {
                RequestSummary(root: span)
                LabeledContent {
                    DurationText(milliseconds: span.start.timeIntervalSince(root.start) * 1_000)
                } label: {
                    Text("Started in", bundle: #bundle, comment: "How long into its trace a step started.")
                }
            }
            Section {
                if span.attributes.isEmpty {
                    Text("This step sent no details.", bundle: #bundle, comment: "A step with no attributes.")
                        .foregroundStyle(.secondary)
                }
                ForEach(span.attributes.keys.sorted(), id: \.self) { key in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(key)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                        Text(Self.text(span.attributes[key] ?? .null))
                            .font(.subheadline.monospaced())
                            .textSelection(.enabled)
                    }
                }
            } header: {
                Text("Sent with", bundle: #bundle, comment: "Section of what a step was sent with.")
            }
        }
        .navigationTitle(Text("Step", bundle: #bundle, comment: "Title of one step of a trace."))
    }

    // An attribute's value as it was sent: text as it is, numbers in an invariant format.
    private static func text(_ value: JSONValue) -> String {
        switch value {
        case .null: "null"
        case .bool(let bool): bool ? "true" : "false"
        case .number(let number): number.formatted(.number.grouping(.never).locale(Locale(identifier: "en_US_POSIX")))
        case .string(let string): string
        case .array(let values): "[\(values.map(text).joined(separator: ", "))]"
        case .object(let object):
            "{\(object.sorted { $0.key < $1.key }.map { "\($0.key): \(text($0.value))" }.joined(separator: ", "))}"
        }
    }
}
