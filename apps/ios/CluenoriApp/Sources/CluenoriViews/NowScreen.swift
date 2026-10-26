import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// Now, the app's root: what needs you across every project, the most urgent first, each opening the
/// item itself; then each project with its status, a line of what's going on, its load over the last
/// 24 hours and its daily people; and the feeds, when there are any. Refreshed by pulling down and
/// whenever the app comes back, with what was seen last shown at once.
struct NowScreen: View {
    let today: TodayModel
    let feeds: FeedsModel
    let pairing: PairingModel

    var body: some View {
        NowContent(today: today, feeds: feeds.feeds.value?.feeds ?? [])
            .navigationTitle(Text("Now", bundle: #bundle, comment: "Title of the app's first screen."))
            .navigationSubtitle(ifAny: today.rows.map { NowSummary(rows: $0).text })
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    PhoneMenu(pairing: pairing)
                }
            }
            .refreshable { await load() }
            .task { await load() }
            .refreshWhenActive { await load() }
            .safeAreaInset(edge: .bottom) {
                NowBanner(today: today, pairing: pairing)
            }
            .safeAreaInset(edge: .top) {
                if let alerts = pairing.models?.alerts {
                    AlertsCard(alerts: alerts)
                }
            }
    }

    private func load() async {
        async let today: Void = today.load()
        async let feeds: Void = feeds.load()
        _ = await (today, feeds)
    }
}

/// Below Now's title: how many things need you, and across how many projects.
struct NowSummary {
    let rows: [TodayRow]

    var text: Text {
        let projects = Set(rows.map(\.projectKey).filter { !$0.isEmpty })
        if rows.isEmpty {
            return Text("Nothing needs you", bundle: #bundle, comment: "Below Now's title: nothing needs attention.")
        }
        if projects.count == 1, let project = rows.first(where: { !$0.projectKey.isEmpty })?.project {
            return rows.count == 1
                ? Text(
                    "1 thing needs you, in \(project)", bundle: #bundle,
                    comment: "Below Now's title. The variable is a project's name.")
                : Text(
                    "\(rows.count) things need you, in \(project)", bundle: #bundle,
                    comment: "Below Now's title. The variables are a count and a project's name.")
        }
        return Text(
            "\(rows.count) things need you, across \(projects.count) projects", bundle: #bundle,
            comment: "Below Now's title. The variables are two counts.")
    }
}

struct NowContent: View {
    let today: TodayModel
    /// The feeds, by name; none hides their section.
    var feeds: [FeedSummary] = []

    var body: some View {
        if let rows = today.rows, let projects = today.projects {
            PanelScreen {
                NeedsYouSection(rows: rows, lookedAt: today.lookedAt, unanswered: today.unanswered)
                ProjectsSection(projects: projects)
                if !feeds.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        PanelTitle(
                            title: Text("Feeds", bundle: #bundle, comment: "Title of the feeds on Now."),
                            trailing: Text("In production", bundle: #bundle, comment: "What Now's feeds cover."))
                        FeedsPanel(feeds: feeds, name: { today.project($0)?.name ?? $0 })
                    }
                }
            }
        } else if today.problem != nil {
            ContentUnavailableView {
                Label {
                    Text("Now couldn't load", bundle: #bundle, comment: "Now never loaded.")
                } icon: {
                    Image(systemName: "wifi.exclamationmark")
                }
            } description: {
                Text("Pull down to try again.", bundle: #bundle, comment: "How to ask for Now again.")
            }
            .background(Palette.ground)
        } else {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Palette.ground)
        }
    }
}

/// What needs you, across every project, the most urgent first; or that nothing does.
struct NeedsYouSection: View {
    let rows: [TodayRow]
    let lookedAt: Date?
    /// The names of the projects that didn't answer.
    let unanswered: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(
                title: Text("Needs you", bundle: #bundle, comment: "Title of what needs attention now."),
                trailing: lookedAt.map { LookedAt(date: $0).text }
            )
            Panel {
                if rows.isEmpty {
                    NothingNeedsYou()
                }
                ForEach(rows) { row in
                    if row.id != rows.first?.id {
                        PanelDivider()
                    }
                    NeedsYouLink(row: row)
                }
            }
            if !unanswered.isEmpty {
                Text(
                    "\(unanswered.formatted()) didn't answer, so what they would show is missing.",
                    bundle: #bundle,
                    comment: "Projects that didn't answer Today. The variable is their names, as a list."
                )
                .font(.footnote)
                .foregroundStyle(Palette.secondary)
                .padding(.horizontal, 2)
                .padding(.top, 8)
            }
        }
    }
}

/// When the deployment last looked, as a panel's title ends: `Looked 3 min ago`.
struct LookedAt {
    let date: Date

    var text: Text {
        if Date.now.timeIntervalSince(date) < 60 {
            Text("Looked just now", bundle: #bundle, comment: "The deployment looked less than a minute ago.")
        } else {
            Text(
                "Looked \(agoText(date)) ago",
                bundle: #bundle,
                comment: "When the deployment last looked. The variable is a duration, such as 3 min."
            )
        }
    }
}

private struct NothingNeedsYou: View {
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            BaselineDot(color: Palette.mint, textStyle: .callout)
            VStack(alignment: .leading, spacing: 3) {
                Text("Nothing needs you", bundle: #bundle, comment: "Nothing needs attention now.")
                    .font(.callout.weight(.medium))
                Text(
                    "Every project is going as usual.", bundle: #bundle,
                    comment: "Below Nothing needs you."
                )
                .font(.subheadline)
                .foregroundStyle(Palette.secondary)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }
}

/// An item that opens the screen of what it is about, or, of a kind this version doesn't know, a row
/// that opens nothing.
private struct NeedsYouLink: View {
    let row: TodayRow

    var body: some View {
        if let route = row.route {
            NavigationLink(value: route) {
                NeedsYouRow(project: row.project, evidence: row.evidence, kind: row.kind)
            }
            .buttonStyle(PanelRowStyle())
        } else {
            NeedsYouRow(project: row.project, evidence: row.evidence, kind: row.kind)
        }
    }
}

/// One item: its kind and project in its color, since when, what it is, and one line of detail.
struct NeedsYouRow: View {
    let project: String
    let evidence: TodayRow.Evidence
    let kind: TodayRow.Kind

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            BaselineDot(color: kind.color, textStyle: .footnote)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Group {
                        if project.isEmpty {
                            ItemKind(evidence: evidence)
                        } else {
                            Text(
                                "\(ItemKind(evidence: evidence).text) · \(project)", bundle: #bundle,
                                comment: "An item's kind and its project, such as Down · Notes.")
                        }
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(kind.color)
                    Spacer(minLength: 4)
                    ItemSince(evidence: evidence)
                        .font(.footnote)
                        .foregroundStyle(Palette.secondary)
                }
                ItemTitle(evidence: evidence)
                    .font(.callout.weight(.medium))
                    .lineLimit(3)
                ItemDetail(evidence: evidence)
                    .font(.subheadline)
                    .foregroundStyle(Palette.secondary)
                    .lineLimit(2)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(minHeight: 64, alignment: .top)
        .accessibilityElement(children: .combine)
    }
}

/// What kind of item it is, in a word or two: `Down`, `New error`, `Slower`, `Release`.
struct ItemKind: View {
    let evidence: TodayRow.Evidence

    var body: some View {
        text
    }

    var text: Text {
        switch evidence {
        case .incident(_, let cause, _, _):
            IncidentCauseText(cause: cause).text
        case .error(_, _, _, _, let isNew, let ongoing):
            if isNew && ongoing {
                Text(
                    "New error, now", bundle: #bundle,
                    comment: "An item's kind: an error first seen today, happening now.")
            } else if ongoing {
                Text("Error, now", bundle: #bundle, comment: "An item's kind: an error happening now.")
            } else {
                Text("New error", bundle: #bundle, comment: "An item's kind: an error first seen today.")
            }
        case .slower:
            Text("Slower", bundle: #bundle, comment: "An item's kind: an operation got slower than its usual.")
        case .promotion:
            Text("Release", bundle: #bundle, comment: "An item's kind: a release that needs you.")
        case .silent:
            Text("No data", bundle: #bundle, comment: "An item's kind: a project sent nothing.")
        case .unknown:
            Text("Update the app", bundle: #bundle, comment: "An item's kind, of a kind this app doesn't know.")
        }
    }
}

/// What an item is about, in a line: the incident, the error, the operation, the release.
struct ItemTitle: View {
    let evidence: TodayRow.Evidence

    var body: some View {
        switch evidence {
        case .incident(let title, _, _, _), .error(let title, _, _, _, _, _):
            Text(verbatim: title)
        case .slower(let operation, _, _):
            Text(verbatim: operation)
        case .promotion(let release, _, let environment, let state, _):
            PromotionNeedTitle(release: release, environment: environment, state: state)
        case .silent:
            Text("Sent no data today", bundle: #bundle, comment: "A project sent nothing in the last day.")
        case .unknown:
            Text(
                "Something this version can't show. Update the app.",
                bundle: #bundle,
                comment: "An item of a kind this app doesn't know."
            )
        }
    }
}

/// A promotion that needs you, in a sentence: `1.2.0+12 passed App Store review`.
struct PromotionNeedTitle: View {
    let release: String
    let environment: String
    let state: PromotionItemState

    var body: some View {
        let version = Text(verbatim: release)
        switch state {
        case .approved:
            Text(
                "\(version) passed App Store review", bundle: #bundle,
                comment: "A release App Store review approved, waiting to be released. The variable is a release.")
        case .waiting:
            Text(
                "\(version) waits for approval to reach \(environment)", bundle: #bundle,
                comment:
                    "A promotion waiting for someone to approve its environment on GitHub. The variables are a release and an environment."
            )
        case .rejected:
            Text(
                "\(version) was rejected in App Store review", bundle: #bundle,
                comment: "App Review rejected a promotion. The variable is a release.")
        case .failed:
            Text(
                "Promoting \(version) to \(environment) failed", bundle: #bundle,
                comment: "A promotion's run or build failed. The variables are a release and an environment.")
        case .lost:
            Text(
                "Promoting \(version) to \(environment) wasn't followed to its end", bundle: #bundle,
                comment:
                    "A promotion's run or build wasn't found, or didn't end in time. The variables are a release and an environment."
            )
        default:
            Text(
                "\(version) needs you in \(environment)", bundle: #bundle,
                comment:
                    "A promotion in a state this app doesn't know. The variables are a release and an environment.")
        }
    }
}

/// One line of an item's evidence: `18 in the last day`, `p95 640 ms, usually 210 ms`.
struct ItemDetail: View {
    let evidence: TodayRow.Evidence

    var body: some View {
        switch evidence {
        case .incident(_, _, _, let acknowledged):
            if acknowledged {
                Text("Acknowledged: someone is on it", bundle: #bundle, comment: "An incident someone is on.")
            } else {
                Text("No one has acknowledged it yet", bundle: #bundle, comment: "An incident no one is on yet.")
            }
        case .error(_, let occurrences, _, _, _, _):
            Text(
                "\(occurrences) in the last day", bundle: #bundle,
                comment: "How many times an error happened in the last day. The variable is a count.")
        case .slower(_, let p95Ms, let usualP95Ms):
            Text(
                "p95 \(Duration.milliseconds(p95Ms), format: DurationText.style(p95Ms)), usually \(Duration.milliseconds(usualP95Ms), format: DurationText.style(usualP95Ms))",
                bundle: #bundle,
                comment: "An operation's p95 over the last day, and its usual. Both are durations."
            )
        case .promotion(_, let component, _, let state, _):
            PromotionNeedDetail(component: component, state: state)
        case .silent(let lastDataAt):
            if let lastDataAt {
                Text(
                    "Last sent \(agoText(lastDataAt)) ago", bundle: #bundle,
                    comment: "When a silent project last sent data. The variable is a duration.")
            } else {
                Text("Nothing in 8 days", bundle: #bundle, comment: "A project silent for 8 days or more.")
            }
        case .unknown:
            EmptyView()
        }
    }
}

/// What a promotion that needs you asks of you, after its component: `notes-ios · release it when
/// you're ready`.
struct PromotionNeedDetail: View {
    let component: String
    let state: PromotionItemState

    var body: some View {
        switch state {
        case .approved:
            Text(
                "\(component) · release it when you're ready", bundle: #bundle,
                comment: "What an approved release waits for. The variable is a component.")
        case .waiting:
            Text(
                "\(component) · approve it on GitHub", bundle: #bundle,
                comment: "What a promotion waiting for its environment's approval needs. The variable is a component.")
        case .rejected:
            Text(
                "\(component) · App Store Connect says why", bundle: #bundle,
                comment: "Where to read why App Review rejected a release. The variable is a component.")
        default:
            Text(
                "\(component) · its run on GitHub says why", bundle: #bundle,
                comment: "Where to read why a promotion didn't get there. The variable is a component.")
        }
    }
}

/// Since when an item has been there, as its corner says it: `4 min`; nothing for a slower
/// operation, which is over the last day.
struct ItemSince: View {
    let evidence: TodayRow.Evidence

    var body: some View {
        switch evidence {
        case .incident(_, _, let openedAt, _):
            agoText(openedAt)
        case .error(_, _, let firstSeen, let lastSeen, let isNew, let ongoing):
            agoText(ongoing ? lastSeen : isNew ? firstSeen : lastSeen)
        case .promotion(_, _, _, _, let since):
            agoText(since)
        case .slower, .silent, .unknown:
            EmptyView()
        }
    }
}

/// Every project: those that need you first, then the rest by name; or how to create the first.
struct ProjectsSection: View {
    let projects: [ProjectNow]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(title: Text("Projects", bundle: #bundle, comment: "Title of the list of projects."))
            Panel {
                if projects.isEmpty {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("No projects yet", bundle: #bundle, comment: "The deployment has no projects.")
                            .font(.callout.weight(.medium))
                        Text(
                            "Create one from a terminal, in Cluenori's folder: ./cluenori project create",
                            bundle: #bundle,
                            comment: "How to create the first project."
                        )
                        .font(.subheadline)
                        .foregroundStyle(Palette.secondary)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                }
                ForEach(projects) { project in
                    if project.id != projects.first?.id {
                        PanelDivider()
                    }
                    NavigationLink(value: Route.project(project.key)) {
                        ProjectNowRow(
                            name: project.name,
                            status: project.status,
                            note: ProjectNote(project: project),
                            hours: project.pulse?.hours,
                            people: project.pulse?.people
                        )
                    }
                    .buttonStyle(PanelRowStyle())
                }
            }
        }
    }
}

/// A project on Now: its status, its name, a line of what's going on, its load over the last 24
/// hours, and its daily people against a week before.
struct ProjectNowRow: View {
    let name: String
    /// Its most urgent item's kind; nil when nothing needs you there.
    let status: TodayRow.Kind?
    let note: ProjectNote
    /// Nil when its pulse is unknown.
    let hours: [PulseHour]?
    let people: PeopleNow?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                // Too big for one row: the load and people below what the project is.
                VStack(alignment: .leading, spacing: 8) {
                    ProjectNowName(name: name, color: dotColor, note: note, lineLimit: nil)
                    HStack(spacing: 12) {
                        if let hours {
                            PulseSpark(hours: hours)
                        }
                        Spacer(minLength: 4)
                        DailyPeople(people: people)
                    }
                }
            } else {
                HStack(spacing: 12) {
                    ProjectNowName(name: name, color: dotColor, note: note, lineLimit: 2)
                    Spacer(minLength: 4)
                    if let hours {
                        PulseSpark(hours: hours)
                    }
                    DailyPeople(people: people)
                        .frame(minWidth: 72, alignment: .trailing)
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(minHeight: 68)
        .accessibilityElement(children: .combine)
    }

    // Its most urgent item's color; mint when nothing needs you, gray when it didn't answer.
    private var dotColor: Color {
        status?.color ?? (note.answered ? Palette.mint : Palette.secondary)
    }
}

/// A project's status dot and name, over its line.
private struct ProjectNowName: View {
    let name: String
    let color: Color
    let note: ProjectNote
    let lineLimit: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Dot(color: color)
                Text(verbatim: name)
                    .font(.body.weight(.semibold))
                    .lineLimit(lineLimit == nil ? nil : 1)
            }
            note
                .font(.subheadline)
                .foregroundStyle(Palette.secondary)
                .lineLimit(lineLimit)
        }
    }
}

/// A project's line on Now: what needs you there, else how its last 24 hours went, else that it
/// didn't answer.
struct ProjectNote: View {
    let rows: [TodayRow]
    let answered: Bool
    let pulse: Pulse?

    init(project: ProjectNow) {
        rows = project.rows
        answered = project.answered
        pulse = project.pulse
    }

    var body: some View {
        if !answered {
            Text(
                "Didn't answer: what it would show is missing", bundle: #bundle,
                comment: "A project that didn't answer Now.")
        } else if let first = rows.first {
            let same = rows.filter { $0.kind.sameKind(as: first.kind) }.count
            let kind = KindCount(kind: first.kind, count: same).text
            if rows.count > same {
                Text(
                    "\(rows.count) need you · \(kind)", bundle: #bundle,
                    comment:
                        "How many things need you in a project, and the most urgent kind's count, such as 3 need you · 1 incident."
                )
            } else {
                kind
            }
        } else if let pulse {
            if pulse.operations > 0 {
                Text(
                    "\(pulse.operations, format: .number.notation(.compactName)) operations · \(Double(pulse.failed) / Double(pulse.operations), format: .percent.precision(.fractionLength(0...1))) failed",
                    bundle: #bundle,
                    comment:
                        "A project's last 24 hours: how many operations ran, and the share that failed. The variables are a count and a percentage."
                )
            } else {
                Text(
                    "No operations in 24 hours", bundle: #bundle,
                    comment: "A project that ran nothing in the last 24 hours.")
            }
        } else {
            Text("Nothing needs you", bundle: #bundle, comment: "A project where nothing needs attention.")
        }
    }
}

/// How many items of one kind a project has, in words: `1 incident`, `2 slower operations`.
struct KindCount {
    let kind: TodayRow.Kind
    let count: Int

    var text: Text {
        switch kind {
        case .incident:
            Text("^[\(count) incident](inflect: true)", bundle: #bundle, comment: "How many open incidents.")
        case .error:
            Text("^[\(count) error](inflect: true)", bundle: #bundle, comment: "How many new or ongoing errors.")
        case .slower:
            Text(
                "^[\(count) slower operation](inflect: true)", bundle: #bundle,
                comment: "How many operations got slower than their usual.")
        case .promotion:
            Text(
                "^[\(count) release](inflect: true) for you", bundle: #bundle,
                comment: "How many releases need you, such as one App Store review approved.")
        case .silent:
            Text("No data today", bundle: #bundle, comment: "A project that sent nothing in the last day.")
        case .unknown:
            Text("Update the app", bundle: #bundle, comment: "An item's kind, of a kind this app doesn't know.")
        }
    }
}

extension TodayRow.Kind {
    /// Whether it is the same kind as `other`, an incident acknowledged or not.
    func sameKind(as other: TodayRow.Kind) -> Bool {
        switch (self, other) {
        case (.incident, .incident): true
        default: self == other
        }
    }
}

/// A project's load over the last 24 hours, small: a bar for each two hours, the latest last; a
/// stretch with nothing reported is a dim tick, not a bar of none.
struct PulseSpark: View {
    let hours: [PulseHour]

    var body: some View {
        let bars = PulseBars(hours: hours, now: .now).pairs
        let highest = max(bars.compactMap(\.self).max() ?? 0, 1)
        HStack(alignment: .bottom, spacing: 2) {
            ForEach(bars.indices, id: \.self) { index in
                let value = bars[index]
                Rectangle()
                    .fill(value == nil ? Palette.border : Palette.sky.opacity(0.8))
                    .frame(width: 3, height: value.map { max(2, 22 * CGFloat($0) / CGFloat(highest)) } ?? 1)
            }
        }
        .frame(height: 22, alignment: .bottom)
        .accessibilityHidden(true)
    }
}

/// The hours of the last 24, as bars show them: one count for each hour, oldest first, the one now
/// is in last; nil for an hour that reported nothing.
struct PulseBars {
    let counts: [Int?]

    init(hours: [PulseHour], now: Date) {
        let hour: TimeInterval = 3_600
        let current = (now.timeIntervalSince1970 / hour).rounded(.down) * hour
        let byHour = Dictionary(
            hours.map { (($0.start.timeIntervalSince1970 / hour).rounded(.down) * hour, $0.count) },
            uniquingKeysWith: +)
        counts = (0..<24).map { index in byHour[current - Double(23 - index) * hour] }
    }

    /// Two hours a bar: twelve, oldest first.
    var pairs: [Int?] {
        stride(from: 0, to: counts.count, by: 2).map { index in
            let pair = counts[index..<min(index + 2, counts.count)].compactMap(\.self)
            return pair.isEmpty ? nil : pair.reduce(0, +)
        }
    }
}

/// A project's daily people on the latest whole UTC day, and how they moved against a week before:
/// `1,284`, `DAU +6%`; a dash when unknown, never 0.
struct DailyPeople: View {
    let people: PeopleNow?

    var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            if let people {
                Text(people.daily, format: .number)
                    .font(.body.monospaced())
                if let change = people.dailyChange {
                    Text(
                        "DAU \(changeText(change))", bundle: #bundle,
                        comment: "Daily people's change against a week before, such as DAU +6%."
                    )
                    .font(.caption)
                    .foregroundStyle(changeColor(change))
                } else {
                    Text(
                        "DAU", bundle: #bundle,
                        comment: "Below a project's daily people, when a week before is unknown."
                    )
                    .font(.caption)
                    .foregroundStyle(Palette.secondary)
                }
            } else {
                Text(verbatim: "—")
                    .font(.body.monospaced())
                    .foregroundStyle(Palette.secondary)
                    .accessibilityLabel(
                        Text("Daily people unknown", bundle: #bundle, comment: "A project whose apps sent nothing."))
                Text("DAU", bundle: #bundle, comment: "Below a project's daily people, when a week before is unknown.")
                    .font(.caption)
                    .foregroundStyle(Palette.secondary)
            }
        }
    }
}

/// Says when what Now shows may be out of date: asking again failed.
struct NowBanner: View {
    let today: TodayModel
    let pairing: PairingModel

    var body: some View {
        if let lookedAt = today.lookedAt, today.problem == .unreachable {
            BannerText(systemImage: "wifi.exclamationmark") {
                Text(
                    "Offline. Showing Now as of \(lookedAt, format: .dateTime.hour().minute()).",
                    bundle: #bundle,
                    comment: "Banner when Now couldn't be asked for. The variable is a time of day."
                )
            }
        } else if today.problem == .unreadable {
            BannerText(systemImage: "exclamationmark.triangle") {
                Text(
                    "Cluenori answered in a way this version doesn't understand. Update the app.",
                    bundle: #bundle,
                    comment: "Banner when the deployment's answer couldn't be read."
                )
            }
        } else if pairing.problem == .unreachable {
            BannerText(systemImage: "wifi.exclamationmark") {
                Text(
                    "Cluenori didn't answer. Showing what was here before.",
                    bundle: #bundle,
                    comment: "Banner when the phone is offline or the deployment is down."
                )
            }
        }
    }
}

/// Runs `action` whenever the app comes back to the foreground. Its own view, so the scene phase
/// it reads invalidates only it.
struct RefreshWhenActive: ViewModifier {
    let action: () async -> Void
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        content.onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await action() }
            }
        }
    }
}

extension View {
    /// Runs `action` whenever the app comes back to the foreground.
    func refreshWhenActive(_ action: @escaping () async -> Void) -> some View {
        modifier(RefreshWhenActive(action: action))
    }
}
