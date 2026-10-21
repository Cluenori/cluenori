import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// Every error group of a project over the period, the most frequent first.
struct ErrorsScreen: View {
    let errors: ErrorsModel

    var body: some View {
        Group {
            if let table = errors.table.value {
                if table.groups.isEmpty {
                    ContentUnavailableView {
                        Label {
                            Text("No errors", bundle: #bundle, comment: "A project had no errors.")
                        } icon: {
                            Image(systemName: "checkmark.circle")
                        }
                    }
                } else {
                    List(table.groups, id: \.id) { group in
                        NavigationLink(value: Route.error(project: errors.project, id: group.id)) {
                            ErrorGroupRow(title: group.title, culprit: group.culprit, occurrences: group.occurrences)
                        }
                    }
                }
            } else {
                AnswerPlaceholder(problem: errors.table.problem)
            }
        }
        .navigationTitle(Text("Errors", bundle: #bundle, comment: "Title of every error of a project."))
        .refreshable { await errors.table.load() }
        .task { await errors.table.load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: errors.table.problem, receivedAt: errors.table.receivedAt)
        }
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

/// One error group: what it said, where it happens, how often, and its latest occurrences.
struct ErrorScreen: View {
    let error: ErrorModel

    var body: some View {
        List {
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
                    ForEach(detail.latest, id: \.id) { line in
                        NavigationLink {
                            LogLineScreen(line: line)
                        } label: {
                            LogLineRow(
                                time: line.time, level: line.level, component: line.component, message: line.message)
                        }
                    }
                } header: {
                    Text("Latest", bundle: #bundle, comment: "Section of an error's latest occurrences.")
                }
            } else {
                AnswerPlaceholder(problem: error.detail.problem)
            }
        }
        .navigationTitle(Text("Error", bundle: #bundle, comment: "Title of one error."))
        .refreshable { await error.detail.load() }
        .task { await error.detail.load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: error.detail.problem, receivedAt: error.detail.receivedAt)
        }
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
                    Text("Occurrences", bundle: #bundle, comment: "How many times an error happened in the period.")
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
