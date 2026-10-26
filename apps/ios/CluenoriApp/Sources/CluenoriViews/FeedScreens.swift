import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// The deployment's feeds the phone's member sees: each with how many arrived in the last 24 hours
/// and 7 days, opening the feed. An owner makes them on the web.
struct FeedsScreen: View {
    let feeds: FeedsModel
    let name: (String) -> String

    var body: some View {
        Group {
            if let list = feeds.feeds.value {
                PanelScreen {
                    if list.feeds.isEmpty {
                        ContentUnavailableView {
                            Label {
                                Text("No feeds yet", bundle: #bundle, comment: "The deployment has no feeds.")
                            } icon: {
                                Image(systemName: "dot.radiowaves.up.forward")
                            }
                        } description: {
                            Text(
                                "A feed lists one moment from every project, such as each registration, and can alert this phone. An owner makes them on the web, under Feeds.",
                                bundle: #bundle,
                                comment: "What a feed is, and where to make one."
                            )
                        }
                    } else {
                        FeedsPanel(feeds: list.feeds, name: name)
                    }
                }
            } else {
                AnswerPlaceholder(problem: feeds.feeds.problem)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Palette.ground)
            }
        }
        .navigationTitle(Text("Feeds", bundle: #bundle, comment: "Title of the deployment's feeds."))
        .refreshable { await feeds.load() }
        .task { await feeds.load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: feeds.feeds.problem, receivedAt: feeds.feeds.receivedAt)
        }
    }
}

/// The feeds in a panel, one row each, opening the feed.
struct FeedsPanel: View {
    let feeds: [FeedSummary]
    let name: (String) -> String

    var body: some View {
        Panel {
            ForEach(feeds, id: \.feed.id) { summary in
                if summary.feed.id != feeds.first?.feed.id {
                    PanelDivider()
                }
                NavigationLink(value: Route.feed(id: summary.feed.id)) {
                    FeedRow(summary: summary, name: name)
                }
                .buttonStyle(PanelRowStyle())
            }
        }
    }
}

/// A feed: its name, its projects, and how many arrived in the last 24 hours.
struct FeedRow: View {
    let summary: FeedSummary
    let name: (String) -> String

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: summary.feed.name)
                    .font(.body.weight(.semibold))
                Text(verbatim: projects)
                    .font(.subheadline)
                    .foregroundStyle(Palette.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 2) {
                Text(summary.lastDay, format: .number)
                    .font(.title3.monospacedDigit())
                Text("24 hours", bundle: #bundle, comment: "Under how many entries a feed had in the last 24 hours.")
                    .font(.caption)
                    .foregroundStyle(Palette.secondary)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(minHeight: 60)
        .accessibilityElement(children: .combine)
    }

    // Its projects, by name, each once.
    private var projects: String {
        var seen: [String] = []
        for source in summary.feed.sources where !seen.contains(source.project) {
            seen.append(source.project)
        }
        return seen.map(name).formatted(.list(type: .and))
    }
}

/// One feed, live: how many arrived in the last 24 hours and 7 days and from which projects, then its
/// entries, newest first, by day, asked for again each minute while it shows, older ones added as the
/// list reaches its end. Each entry opens its person when the app knew them.
struct FeedScreen: View {
    let feed: FeedModel
    let name: (String) -> String

    var body: some View {
        Group {
            if let page = feed.page.value {
                PanelScreen {
                    FeedNumbers(summary: page.summary, name: name)
                    FeedEntriesPanel(feed: feed, name: name)
                }
            } else {
                AnswerPlaceholder(problem: feed.page.problem)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Palette.ground)
            }
        }
        .navigationTitle(
            feed.page.value.map { Text(verbatim: $0.summary.feed.name) }
                ?? Text("Feed", bundle: #bundle, comment: "Title of a feed before it loads.")
        )
        .navigationSubtitle(
            ifAny: feed.page.value.map { _ in
                Text("Live, from production", bundle: #bundle, comment: "Below a feed's title.")
            }
        )
        .refreshable { await feed.refresh() }
        // The deployment lists an entry within a minute, so the newest are asked for each minute.
        .task {
            while !Task.isCancelled {
                await feed.refresh()
                try? await Task.sleep(for: FeedModel.askEvery)
            }
        }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: feed.page.problem, receivedAt: feed.page.receivedAt)
        }
    }
}

/// How many arrived in the last 24 hours and 7 days, and the last 7 days' by project.
struct FeedNumbers: View {
    let summary: FeedSummary
    let name: (String) -> String

    var body: some View {
        Panel {
            HStack(spacing: 0) {
                number(summary.lastDay, Text("Last 24 hours", bundle: #bundle, comment: "A feed's count."))
                Rectangle().fill(Palette.divider).frame(width: 1).accessibilityHidden(true)
                number(summary.lastWeek, Text("Last 7 days", bundle: #bundle, comment: "A feed's count."))
            }
            .fixedSize(horizontal: false, vertical: true)
            ForEach(summary.byProject, id: \.project) { each in
                PanelDivider()
                HStack {
                    Text(verbatim: name(each.project))
                    Spacer(minLength: 8)
                    Text(each.lastWeek, format: .number)
                        .monospacedDigit()
                        .foregroundStyle(Palette.secondary)
                }
                .font(.subheadline)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .accessibilityElement(children: .combine)
            }
        }
    }

    private func number(_ value: Int, _ label: Text) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            label
                .font(.caption)
                .foregroundStyle(Palette.secondary)
            Text(value, format: .number)
                .font(.title2.monospacedDigit())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }
}

/// A feed's entries, newest first, by day in the phone's time zone.
struct FeedEntriesPanel: View {
    let feed: FeedModel
    let name: (String) -> String

    var body: some View {
        let days = Self.byDay(feed.entries)
        if days.isEmpty {
            Text(
                "Nothing yet. Each of these events the apps send from production shows here within a minute.",
                bundle: #bundle,
                comment: "A feed without entries."
            )
            .font(.subheadline)
            .foregroundStyle(Palette.secondary)
        }
        // A late event starts a run of its own day, so each run is known by its first entry.
        ForEach(days, id: \.entries.first?.id) { group in
            VStack(alignment: .leading, spacing: 0) {
                PanelTitle(title: Text(group.day, format: .dateTime.weekday(.wide).month().day()))
                Panel {
                    ForEach(group.entries, id: \.id) { entry in
                        if entry.id != group.entries.first?.id {
                            PanelDivider()
                        }
                        if let user = entry.user {
                            NavigationLink(value: Route.person(project: entry.project, user: user)) {
                                FeedEntryRow(entry: entry, project: name(entry.project))
                            }
                            .buttonStyle(PanelRowStyle())
                        } else {
                            FeedEntryRow(entry: entry, project: name(entry.project))
                        }
                    }
                }
            }
        }
        if feed.hasOlder {
            ProgressView()
                .frame(maxWidth: .infinity)
                // Once for each page: shown again after one loads, it asks for the next.
                .task(id: feed.entries.last?.id) { await feed.loadOlder() }
        }
    }

    // The entries grouped by the day they happened on, newest first.
    private static func byDay(_ entries: [FeedEntry]) -> [(day: Date, entries: [FeedEntry])] {
        var groups: [(day: Date, entries: [FeedEntry])] = []
        let calendar = Calendar.current
        for entry in entries {
            let day = calendar.startOfDay(for: entry.at)
            if let last = groups.last, last.day == day {
                groups[groups.count - 1].entries.append(entry)
            } else {
                groups.append((day, [entry]))
            }
        }
        return groups
    }
}

/// One entry: when, the project and its event, the person when the app knew them, where they were,
/// and the app's release.
struct FeedEntryRow: View {
    let entry: FeedEntry
    let project: String
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                // Too big for a column of times: the time over the rest, each part on its own line.
                VStack(alignment: .leading, spacing: 3) {
                    time
                    projectName
                    eventName
                    lines
                }
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    time
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            projectName
                            eventName
                                .lineLimit(1)
                        }
                        lines
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .accessibilityElement(children: .combine)
    }

    private var time: some View {
        Text(entry.at, format: .dateTime.hour().minute())
            .font(.subheadline.monospacedDigit())
            .foregroundStyle(Palette.secondary)
    }

    // The person and the country, and the app's release.
    @ViewBuilder private var lines: some View {
        if !details.isEmpty {
            Text(verbatim: details)
                .font(.subheadline)
                .foregroundStyle(Palette.secondary)
        }
        Text(verbatim: "\(entry.component) \(entry.release)")
            .font(.caption.monospaced())
            .foregroundStyle(Palette.secondary)
    }

    private var projectName: some View {
        Text(verbatim: project)
            .font(.body.weight(.semibold))
    }

    private var eventName: some View {
        Text(verbatim: entry.event)
            .font(.caption.monospaced())
            .foregroundStyle(Palette.secondary)
    }

    // The person, by the app's ID, and the country, each when known.
    private var details: String {
        [
            entry.user,
            entry.country.map { Locale.current.localizedString(forRegionCode: $0) ?? $0 },
        ]
        .compactMap(\.self)
        .joined(separator: " · ")
    }
}
