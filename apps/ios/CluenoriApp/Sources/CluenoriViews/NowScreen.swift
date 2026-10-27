import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// Now, the app's root: every project, those that need you first, each with a line for each product
/// that has news, opening what it is about, and the steady ones in one quiet row; then the feeds,
/// when there are any. Refreshed by pulling down and whenever the app comes back, with what was seen
/// last shown at once.
struct NowScreen: View {
    let today: TodayModel
    let feeds: FeedsModel
    let pairing: PairingModel

    var body: some View {
        NowContent(today: today, feeds: feeds.feeds.value?.feeds ?? [])
            .navigationTitle(Text("Now", bundle: #bundle, comment: "Title of the app's first screen."))
            .navigationSubtitle(ifAny: today.projects.map { NowSummary(projects: $0).text })
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
            // The launch is timed to Now's first answer, the first screen ready.
            .readyMark(receivedAt: today.receivedAt)
            .measuredScreen("now", feature: "today")
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

/// Below Now's title: which project needs you, and in which products; or how many projects do.
struct NowSummary {
    let projects: [ProjectNow]

    var text: Text {
        let needing = projects.compactMap { project in
            let news = ProductLine.lines(of: project).filter(\.tone.isNews)
            return news.isEmpty ? nil : (project.name, news)
        }
        guard let (name, news) = needing.first else {
            return Text("Nothing needs you", bundle: #bundle, comment: "Below Now's title: nothing needs attention.")
        }
        if needing.count > 1 {
            return Text(
                "\(needing.count) projects need you", bundle: #bundle,
                comment: "Below Now's title. The variable is a count of projects.")
        }
        return Text(
            "\(name) needs you: \(news.map(\.product.nameString).formatted(.list(type: .and)))", bundle: #bundle,
            comment: "Below Now's title. The variables are a project's name and its products with news, as a list.")
    }
}

struct NowContent: View {
    let today: TodayModel
    /// The feeds, by name; none hides their section.
    var feeds: [FeedSummary] = []

    var body: some View {
        if let projects = today.projects {
            PanelScreen {
                ProjectsSection(projects: projects, lookedAt: today.lookedAt)
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
        case .quiet:
            Text(
                "Quiet, a guess", bundle: #bundle,
                comment: "An item's kind: an operation that usually runs regularly hasn't, as Cluenori guessed.")
        case .promotion:
            Text("Release", bundle: #bundle, comment: "An item's kind: a release that needs you.")
        case .silent:
            Text("No data", bundle: #bundle, comment: "An item's kind: a project sent nothing.")
        case .keyExpiring:
            Text("Key expires", bundle: #bundle, comment: "An item's kind: an ingest key expires soon.")
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
        case .slower(let operation, _, _), .quiet(let operation, _, _):
            Text(verbatim: operation)
        case .promotion(let release, _, let environment, let state, _):
            PromotionNeedTitle(release: release, environment: environment, state: state)
        case .silent:
            Text("Sent no data today", bundle: #bundle, comment: "A project sent nothing in the last day.")
        case .keyExpiring(let component, let name, _):
            Text(
                "\(component)'s ingest key “\(name)”", bundle: #bundle,
                comment: "An ingest key about to expire. The variables are a component and the key's name.")
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
        text
    }

    /// The same, as text inside a sentence.
    var text: Text {
        let version = Text(verbatim: release)
        return switch state {
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
        case .quiet(_, let usualGapMs, let lastRanAt):
            QuietWords(usualGapMs: usualGapMs, lastRanAt: lastRanAt).text
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
        case .keyExpiring(_, _, let expiresAt):
            Text(
                "Expires \(expiresAt, format: .relative(presentation: .named)); add a key and deploy it first",
                bundle: #bundle,
                comment: "When an ingest key expires, and what to do. The variable is a relative time.")
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
        case .quiet(_, _, let lastRanAt):
            agoText(lastRanAt)
        case .slower, .silent, .keyExpiring, .unknown:
            EmptyView()
        }
    }
}

/// Every project, those that need you first, a panel each; or how to create the first.
struct ProjectsSection: View {
    let projects: [ProjectNow]
    let lookedAt: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(
                title: Text("Projects", bundle: #bundle, comment: "Title of the list of projects."),
                trailing: lookedAt.map { LookedAt(date: $0).text })
            if projects.isEmpty {
                Panel {
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
            }
            VStack(spacing: 10) {
                ForEach(ProductLine.newsFirst(projects)) { project in
                    ProjectLinesPanel(project: project)
                }
            }
        }
    }
}

/// A project on Now: its name and what its lines come to, opening its screen; each line with news,
/// opening what it is about; then the steady ones in one row.
struct ProjectLinesPanel: View {
    let project: ProjectNow

    var body: some View {
        let lines = ProductLine.lines(of: project)
        let news = lines.filter(\.tone.isNews)
        let steady = lines.filter { !$0.tone.isNews }
        Panel {
            NavigationLink(value: Route.project(project.key)) {
                ProjectNowHeader(project: project, news: news)
            }
            .buttonStyle(PanelRowStyle())
            ForEach(news) { line in
                PanelDivider()
                NavigationLink(value: line.route) {
                    ProductLineRow(line: line)
                }
                .buttonStyle(PanelRowStyle())
            }
            if !steady.isEmpty {
                PanelDivider()
                SteadyLinesRow(lines: steady)
            }
        }
    }
}

/// A project's name with its most urgent line's dot, what its lines come to, and its load over the
/// last 24 hours.
struct ProjectNowHeader: View {
    let project: ProjectNow
    let news: [ProductLine]
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Dot(color: !project.answered ? Palette.secondary : (news.first?.tone.color ?? Palette.mint))
                    Text(verbatim: project.name)
                        .font(.body.weight(.semibold))
                }
                Group {
                    if !project.answered {
                        Text(
                            "Didn't answer: what it would show is missing", bundle: #bundle,
                            comment: "A project that didn't answer Now.")
                    } else if news.isEmpty {
                        Text("Nothing needs you", bundle: #bundle, comment: "A project where nothing needs attention.")
                    } else if news.count == 1 {
                        Text("1 product needs you", bundle: #bundle, comment: "One of a project's products has news.")
                    } else {
                        Text(
                            "\(news.count) products need you", bundle: #bundle,
                            comment: "How many of a project's products have news. The variable is a count.")
                    }
                }
                .font(.subheadline)
                .foregroundStyle(Palette.secondary)
            }
            Spacer(minLength: 4)
            // Too big beside the name at the largest sizes: Performance's line says the load.
            if let hours = project.pulse?.hours, !hours.isEmpty, !dynamicTypeSize.isAccessibilitySize {
                PulseSpark(hours: hours)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
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

/// What a quiet operation's hint says, worded as the guess it is: `Usually runs about every 31 min;
/// nothing for 3 hr. Maybe fine: Cluenori guessed this from its history.`
struct QuietWords {
    let usualGapMs: Double
    let lastRanAt: Date
    var now: Date = .now

    var text: Text {
        let style = Duration.UnitsFormatStyle.units(
            allowed: [.days, .hours, .minutes], width: .abbreviated, maximumUnitCount: 1)
        let gap = Duration.milliseconds(usualGapMs)
        let quiet = Duration.seconds(max(60, now.timeIntervalSince(lastRanAt)))
        return Text(
            "Usually runs about every \(gap, format: style); nothing for \(quiet, format: style). Maybe fine: Cluenori guessed this from its history.",
            bundle: #bundle,
            comment:
                "A hint, never an alert: an operation that usually runs regularly hasn't. The variables are durations."
        )
    }
}
