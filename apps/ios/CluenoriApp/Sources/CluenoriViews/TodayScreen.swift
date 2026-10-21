import CluenoriScreens
import Foundation
import SwiftUI

/// Today: what needs attention now across the paired deployment's projects, refreshed by pulling
/// down and whenever the app comes back, with what was seen last shown at once.
struct TodayScreen: View {
    let today: TodayModel
    let pairing: PairingModel

    var body: some View {
        TodayList(today: today)
            .navigationTitle(Text("Today", bundle: #bundle, comment: "Title of the attention queue."))
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    PhoneMenu(pairing: pairing)
                }
            }
            .refreshable { await today.load() }
            .task { await today.load() }
            .refreshWhenActive { await today.load() }
            .safeAreaInset(edge: .bottom) {
                TodayBanner(today: today)
            }
            .safeAreaInset(edge: .top) {
                if let alerts = pairing.models?.alerts {
                    AlertsCard(alerts: alerts)
                }
            }
    }
}

struct TodayList: View {
    let today: TodayModel

    var body: some View {
        if let rows = today.rows {
            if rows.isEmpty && today.unanswered.isEmpty {
                ContentUnavailableView {
                    Label {
                        Text("Nothing needs you", bundle: #bundle, comment: "Today is empty.")
                    } icon: {
                        Image(systemName: "checkmark.circle")
                    }
                } description: {
                    Text(
                        "Every project is going as usual.",
                        bundle: #bundle,
                        comment: "Below Nothing needs you."
                    )
                }
            } else {
                List {
                    if let lookedAt = today.lookedAt {
                        Section {
                            ForEach(rows) { row in
                                if let route = row.route {
                                    NavigationLink(value: route) {
                                        TodayRowView(project: row.project, evidence: row.evidence)
                                    }
                                } else {
                                    TodayRowView(project: row.project, evidence: row.evidence)
                                }
                            }
                        } header: {
                            LookedAt(date: lookedAt)
                        }
                    }
                    if !today.unanswered.isEmpty {
                        Section {
                            Text(
                                "\(today.unanswered.formatted()) didn't answer, so what they would show is missing.",
                                bundle: #bundle,
                                comment: "Projects that didn't answer Today. The variable is their names, as a list."
                            )
                            .foregroundStyle(.secondary)
                        }
                    }
                }
            }
        } else if today.problem != nil {
            ContentUnavailableView {
                Label {
                    Text("Today couldn't load", bundle: #bundle, comment: "Today never loaded.")
                } icon: {
                    Image(systemName: "wifi.exclamationmark")
                }
            } description: {
                Text("Pull down to try again.", bundle: #bundle, comment: "How to ask for Today again.")
            }
        } else {
            ProgressView()
        }
    }
}

struct LookedAt: View {
    let date: Date

    var body: some View {
        Text(
            "Looked \(Text(date, style: .relative)) ago",
            bundle: #bundle,
            comment: "When the deployment last looked. The variable is a duration, such as 3 minutes."
        )
    }
}

/// One item: a symbol for its kind, what it is, and its project with the evidence.
struct TodayRowView: View {
    let project: String
    let evidence: TodayRow.Evidence

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            TodayKindSymbol(evidence: evidence)
            VStack(alignment: .leading, spacing: 4) {
                TodayHeadline(evidence: evidence)
                    .font(.body)
                    .lineLimit(3)
                HStack(spacing: 6) {
                    Text(project)
                        .fontWeight(.medium)
                    TodayDetail(evidence: evidence)
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

struct TodayKindSymbol: View {
    let evidence: TodayRow.Evidence

    var body: some View {
        Image(systemName: symbol)
            .symbolRenderingMode(.hierarchical)
            .foregroundStyle(tint)
            .font(.title3)
            .frame(width: 28)
            .accessibilityHidden(true)
    }

    private var symbol: String {
        switch evidence {
        case .incident(_, _, let acknowledged): acknowledged ? "bell.badge.slash.fill" : "bell.badge.fill"
        case .error(_, _, _, _, let ongoing): ongoing ? "exclamationmark.octagon.fill" : "sparkle"
        case .slower: "tortoise.fill"
        case .silent: "antenna.radiowaves.left.and.right.slash"
        case .unknown: "questionmark.circle"
        }
    }

    private var tint: Color {
        switch evidence {
        case .incident(_, _, let acknowledged): acknowledged ? .orange : .red
        case .error(_, _, _, _, let ongoing): ongoing ? .red : .orange
        case .slower: .orange
        case .silent, .unknown: .secondary
        }
    }
}

struct TodayHeadline: View {
    let evidence: TodayRow.Evidence

    var body: some View {
        switch evidence {
        case .incident(let title, _, _):
            Text(title)
        case .error(let title, _, _, let isNew, let ongoing):
            if isNew && ongoing {
                Text("New, now: \(title)", bundle: #bundle, comment: "An error first seen today, happening now.")
            } else if ongoing {
                Text("Now: \(title)", bundle: #bundle, comment: "An error happening now. The variable is its title.")
            } else {
                Text("New: \(title)", bundle: #bundle, comment: "An error first seen today. The variable is its title.")
            }
        case .slower(let operation, _, _):
            Text(
                "\(operation) got slower", bundle: #bundle,
                comment: "An operation got slower. The variable is its name.")
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

struct TodayDetail: View {
    let evidence: TodayRow.Evidence

    var body: some View {
        switch evidence {
        case .incident(_, let openedAt, let acknowledged):
            if acknowledged {
                Text(
                    "acknowledged, open \(Text(openedAt, style: .relative))",
                    bundle: #bundle,
                    comment: "An incident someone is on. The variable is how long it has been open."
                )
            } else {
                Text(
                    "open \(Text(openedAt, style: .relative))",
                    bundle: #bundle,
                    comment: "How long an incident has been open. The variable is a duration."
                )
            }
        case .error(_, let occurrences, _, _, _):
            Text(
                "\(occurrences) today",
                bundle: #bundle,
                comment: "How many times an error happened in the last day."
            )
        case .slower(_, let p95Ms, let usualP95Ms):
            Text(
                "p95 \(Duration.milliseconds(p95Ms), format: .units(width: .narrow)), usually \(Duration.milliseconds(usualP95Ms), format: .units(width: .narrow))",
                bundle: #bundle,
                comment: "An operation's p95 over the last day, and its usual. Both are durations."
            )
        case .silent(let lastDataAt):
            if let lastDataAt {
                Text(
                    "last \(Text(lastDataAt, style: .relative)) ago",
                    bundle: #bundle,
                    comment: "When a silent project last sent data. The variable is a duration."
                )
            } else {
                Text("nothing in 8 days", bundle: #bundle, comment: "A project silent for 8 days or more.")
            }
        case .unknown:
            EmptyView()
        }
    }
}

/// Says when what Today shows may be out of date: asking again failed.
struct TodayBanner: View {
    let today: TodayModel

    var body: some View {
        if let lookedAt = today.lookedAt, today.problem == .unreachable {
            BannerText(systemImage: "wifi.exclamationmark") {
                Text(
                    "Offline. Showing Today as of \(lookedAt, format: .dateTime.hour().minute()).",
                    bundle: #bundle,
                    comment: "Banner when Today couldn't be asked for. The variable is a time of day."
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
