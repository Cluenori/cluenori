import Charts
import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// A project's summary, in production: its daily and monthly people against a week before, and its
/// load over the last 24 hours with its errors; what needs you there; and its doors, each with a line
/// of what's inside: Product, its apps' analytics; Tech, its operations, errors, logs and incidents;
/// and Releases, its delivery.
struct ProjectScreen: View {
    let key: String
    let today: TodayModel
    let delivery: DeliveryModel
    /// Its apps' analytics, in the environment the project's screens show, whose latest release's
    /// app health the Product door says.
    let analytics: AnalyticsModel
    let name: String

    var body: some View {
        let project = today.project(key)
        PanelScreen(spacing: 24) {
            if let project {
                if !project.answered {
                    Text(
                        "\(project.name) didn't answer, so what it would show is missing. Pull down to try again.",
                        bundle: #bundle,
                        comment: "A project that didn't answer. The variable is its name."
                    )
                    .font(.subheadline)
                    .foregroundStyle(Palette.secondary)
                } else if let pulse = project.pulse {
                    VStack(alignment: .leading, spacing: 10) {
                        PeopleTiles(people: pulse.people)
                        LoadPanel(hours: pulse.hours)
                    }
                }
                if !project.rows.isEmpty {
                    ProjectNeedsYou(rows: project.rows)
                }
            } else {
                AnswerPlaceholder(problem: today.rows == nil ? today.problem : .missing)
            }
            Doors(
                key: key,
                rows: project?.rows ?? [],
                pulse: project?.pulse,
                delivery: delivery.overview,
                analytics: analytics
            )
        }
        .navigationTitle(name)
        .refreshable {
            async let now: Void = today.load()
            async let releases: Void = delivery.load()
            async let health: Void = analytics.appHealth.load()
            _ = await (now, releases, health)
        }
        .task {
            async let releases: Void = delivery.load()
            // Opened by a link at launch, Now may not have asked yet.
            if today.rows == nil {
                await today.load()
            }
            await releases
        }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: today.problem, receivedAt: today.lookedAt)
        }
    }
}

/// A project's people on the latest whole UTC day: daily and monthly, each against a week before.
struct PeopleTiles: View {
    /// Nil when its apps sent nothing by then.
    let people: PeopleNow?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Grid(horizontalSpacing: 10) {
                GridRow {
                    PeopleTile(
                        title: Text("Daily people", bundle: #bundle, comment: "People active on a day: DAU."),
                        count: people?.daily,
                        change: people?.dailyChange,
                        counted: people != nil
                    )
                    PeopleTile(
                        title: Text("Monthly people", bundle: #bundle, comment: "People active in 30 days: MAU."),
                        count: people?.monthly,
                        change: people?.monthlyChange,
                        counted: people != nil
                    )
                }
            }
            Group {
                if let people {
                    Text(
                        "On \(people.day, format: Date.FormatStyle(timeZone: .gmt).month(.abbreviated).day()), UTC, against the same day a week before.",
                        bundle: #bundle,
                        comment: "Below a project's people: the UTC day counted. The variable is a day, such as Oct 22."
                    )
                } else {
                    Text(
                        "Its apps haven't sent anything yet.", bundle: #bundle,
                        comment: "Below a project's people, when its apps sent nothing.")
                }
            }
            .font(.caption)
            .foregroundStyle(Palette.secondary)
            .padding(.horizontal, 2)
        }
    }
}

/// One count of people: its name, the count, and how it moved against a week before; a dash when it
/// isn't counted, never 0.
struct PeopleTile: View {
    let title: Text
    /// Nil when it isn't counted.
    let count: Int?
    /// Nil when a week before isn't counted, or had no one.
    let change: Double?
    /// Whether the project's apps sent anything at all.
    let counted: Bool

    var body: some View {
        Panel {
            VStack(alignment: .leading, spacing: 4) {
                title
                    .font(.footnote)
                    .foregroundStyle(Palette.secondary)
                if let count {
                    Text(count, format: .number)
                        .font(.title2.monospaced())
                } else {
                    Text(verbatim: "—")
                        .font(.title2.monospaced())
                        .foregroundStyle(Palette.secondary)
                        .accessibilityLabel(Text("Unknown", bundle: #bundle, comment: "A count that isn't known."))
                }
                Group {
                    if let change {
                        Text(
                            "\(changeText(change)) vs a week before", bundle: #bundle,
                            comment:
                                "A count's change against a week before. The variable is a percentage, such as +6%."
                        )
                        .foregroundStyle(changeColor(change))
                    } else if count != nil {
                        Text(
                            "Not counted a week before", bundle: #bundle,
                            comment: "A count whose week before isn't known."
                        )
                        .foregroundStyle(Palette.secondary)
                    } else if counted {
                        Text(
                            "Not 30 days counted yet", bundle: #bundle,
                            comment: "A monthly count before 30 days were counted."
                        )
                        .foregroundStyle(Palette.secondary)
                    } else {
                        Text("No apps yet", bundle: #bundle, comment: "A project whose apps sent nothing.")
                            .foregroundStyle(Palette.secondary)
                    }
                }
                .font(.footnote)
                .lineLimit(2)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A project's load over the last 24 hours in production, by the hour, its failed part on top.
struct LoadPanel: View {
    let hours: [PulseHour]

    var body: some View {
        let operations = hours.reduce(0) { $0 + $1.count }
        let failed = hours.reduce(0) { $0 + $1.errors }
        Panel {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Load, last 24 hours", bundle: #bundle, comment: "Title of a project's load over a day.")
                        .foregroundStyle(Palette.secondary)
                    Spacer(minLength: 8)
                    if operations > 0 {
                        Text(
                            "\(operations, format: .number) · \(Double(failed) / Double(operations), format: .percent.precision(.fractionLength(0...1))) failed",
                            bundle: #bundle,
                            comment:
                                "How many operations ran over a day, and the share that failed. The variables are a count and a percentage."
                        )
                        .monospacedDigit()
                    }
                }
                .font(.footnote)
                if hours.isEmpty {
                    Text(
                        "Nothing reported in 24 hours.", bundle: #bundle,
                        comment: "A project's load when its services reported nothing in a day."
                    )
                    .font(.subheadline)
                    .foregroundStyle(Palette.secondary)
                    .frame(maxWidth: .infinity, minHeight: 100)
                } else {
                    PulseChart(hours: hours)
                        .frame(height: 112)
                }
                HStack(spacing: 14) {
                    LegendKey(color: Palette.sky) {
                        Text("Operations", bundle: #bundle, comment: "The chart's key: operations that ran.")
                    }
                    LegendKey(color: Palette.pink) {
                        Text("Errors", bundle: #bundle, comment: "The chart's key: operations that failed.")
                    }
                }
                .font(.caption)
                .foregroundStyle(Palette.secondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
    }
}

/// A chart's key: a square of its color, and what it stands for.
struct LegendKey<Label: View>: View {
    let color: Color
    @ViewBuilder let label: Label

    var body: some View {
        HStack(spacing: 6) {
            Rectangle()
                .fill(color)
                .frame(width: 10, height: 10)
                .accessibilityHidden(true)
            label
        }
    }
}

/// The hours of a pulse as bars: what ran in sky, what failed in pink on top; an hour without a bar
/// reported nothing.
struct PulseChart: View {
    let hours: [PulseHour]

    var body: some View {
        let hour: TimeInterval = 3_600
        let now = Date.now
        let end = (now.timeIntervalSince1970 / hour).rounded(.down) * hour + hour
        let domain = Date(timeIntervalSince1970: end - 24 * hour)...Date(timeIntervalSince1970: end)
        Chart(hours, id: \.start) { point in
            BarMark(
                x: .value(String(localized: "Hour", bundle: #bundle), point.start, unit: .hour),
                yStart: .value(String(localized: "Count", bundle: #bundle), 0),
                yEnd: .value(String(localized: "Succeeded", bundle: #bundle), point.count - point.errors)
            )
            .foregroundStyle(Palette.sky.opacity(0.85))
            BarMark(
                x: .value(String(localized: "Hour", bundle: #bundle), point.start, unit: .hour),
                yStart: .value(String(localized: "Succeeded", bundle: #bundle), point.count - point.errors),
                yEnd: .value(String(localized: "Failed", bundle: #bundle), point.count)
            )
            .foregroundStyle(Palette.pink)
        }
        .chartXScale(domain: domain)
        .chartXAxis {
            AxisMarks(values: .stride(by: .hour, count: 6)) { _ in
                AxisValueLabel(format: .dateTime.hour().minute())
                    .foregroundStyle(Palette.secondary)
            }
        }
        .chartYAxis(.hidden)
    }
}

/// What needs you in one project, the most urgent first, each opening the item itself.
struct ProjectNeedsYou: View {
    let rows: [TodayRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(title: Text("Needs you", bundle: #bundle, comment: "Title of what needs attention now."))
            Panel {
                ForEach(rows) { row in
                    if row.id != rows.first?.id {
                        PanelDivider()
                    }
                    if let route = row.route {
                        NavigationLink(value: route) {
                            NeedsYouRow(project: "", evidence: row.evidence, kind: row.kind)
                        }
                        .buttonStyle(PanelRowStyle())
                    }
                }
            }
        }
    }
}

/// A project's doors, each a level deeper, with a line of what's inside.
struct Doors: View {
    let key: String
    /// What needs you in the project.
    let rows: [TodayRow]
    let pulse: Pulse?
    /// Nil until the delivery arrives.
    let delivery: DeliveryOverview?
    let analytics: AnalyticsModel

    var body: some View {
        Grid(horizontalSpacing: 10, verticalSpacing: 10) {
            GridRow {
                Door(
                    name: Text("Product", bundle: #bundle, comment: "The door to a project's apps' analytics."),
                    color: Palette.mint,
                    route: .analytics(AnalyticsRef(project: key))
                ) {
                    ProductLine(analytics: analytics)
                }
                Door(
                    name: Text(
                        "Tech", bundle: #bundle,
                        comment: "The door to a project's operations, errors, logs and incidents."),
                    color: Palette.blue,
                    route: .tech(project: key)
                ) {
                    TechLine(rows: rows, pulse: pulse)
                }
            }
            GridRow {
                Door(
                    name: Text("Releases", bundle: #bundle, comment: "The door to a project's delivery."),
                    color: Palette.purple,
                    route: .delivery(project: key)
                ) {
                    ReleasesLine(overview: delivery)
                }
                .gridCellColumns(2)
            }
        }
    }
}

/// A door: a square of its color, its name, and a line of what's inside, opening it.
struct Door<Line: View>: View {
    let name: Text
    let color: Color
    let route: Route
    @ViewBuilder let line: Line

    var body: some View {
        NavigationLink(value: route) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Rectangle()
                        .fill(color)
                        .frame(width: 10, height: 10)
                        .accessibilityHidden(true)
                    name
                        .font(.body.weight(.semibold))
                }
                Spacer(minLength: 0)
                line
                    .font(.footnote)
                    .foregroundStyle(Palette.secondary)
                    .multilineTextAlignment(.leading)
                    .lineLimit(3)
            }
            .padding(14)
            .frame(maxWidth: .infinity, minHeight: 104, alignment: .topLeading)
        }
        .buttonStyle(DoorStyle())
    }
}

/// A door's look: a panel, darker while pressed.
struct DoorStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Palette.text)
            .background(configuration.isPressed ? Palette.border : Palette.panel)
            .clipShape(.rect(cornerRadius: Palette.radius))
            .overlay {
                RoundedRectangle(cornerRadius: Palette.radius)
                    .strokeBorder(Palette.border, lineWidth: 1)
            }
            .contentShape(.rect(cornerRadius: Palette.radius))
    }
}

/// The Product door's line: its apps' latest release and how its app health compares with the
/// release before; what's inside until that arrives.
struct ProductLine: View {
    let analytics: AnalyticsModel

    var body: some View {
        Group {
            if let list = analytics.appHealth.value {
                if let latest = list.releases.first {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: latest.release.release)
                            .monospaced()
                            .unhyphenated()
                        HealthVerdictText(verdict: latest.verdict, worse: latest.worse, better: latest.better)
                    }
                } else if let environment = analytics.analytics.environment {
                    Text(
                        "No app sent anything from \(environment) in \(analyticsPeriodPhrase(analytics.period))",
                        bundle: #bundle,
                        comment:
                            "The Product door's line when no app sent anything. The variables are an environment and a period."
                    )
                } else {
                    Text(
                        "No app sent anything in \(analyticsPeriodPhrase(analytics.period))", bundle: #bundle,
                        comment: "The Product door's line when no app sent anything. The variable is a period.")
                }
            } else {
                Text(
                    "People, retention, app health, features", bundle: #bundle,
                    comment: "The Product door's line before its analytics arrive: what they show.")
            }
        }
        .task(id: analytics.analytics) { await analytics.appHealth.load() }
    }
}

/// The Tech door's line: what needs you there, else how its last 24 hours went.
struct TechLine: View {
    let rows: [TodayRow]
    let pulse: Pulse?

    var body: some View {
        let incidents = rows.filter { if case .incident = $0.kind { true } else { false } }.count
        let errors = rows.filter { $0.kind == .error }.count
        let slower = rows.filter { $0.kind == .slower }.count
        let parts = [
            incidents > 0 ? KindCount(kind: .incident(acknowledged: false), count: incidents).text : nil,
            errors > 0 ? KindCount(kind: .error, count: errors).text : nil,
            slower > 0 ? KindCount(kind: .slower, count: slower).text : nil,
        ].compactMap(\.self)
        if let line = joined(parts) {
            line
        } else if let pulse, pulse.operations > 0 {
            Text(
                "\(pulse.operations, format: .number.notation(.compactName)) operations · \(Double(pulse.failed) / Double(pulse.operations), format: .percent.precision(.fractionLength(0...1))) failed",
                bundle: #bundle,
                comment:
                    "A project's last 24 hours: how many operations ran, and the share that failed. The variables are a count and a percentage."
            )
        } else {
            Text(
                "Operations, errors, logs, incidents", bundle: #bundle,
                comment: "The Tech door's line when nothing needs you: what's inside.")
        }
    }
}

/// The Releases door's line: promotions under way or that didn't get there, releases ready to
/// promote; else the release that reached production last.
struct ReleasesLine: View {
    /// Nil until the delivery arrives.
    let overview: DeliveryOverview?

    var body: some View {
        if let overview {
            let parts = [
                overview.underWay > 0
                    ? Text(
                        "^[\(overview.underWay) promotion](inflect: true) under way", bundle: #bundle,
                        comment: "How many promotions haven't ended.") : nil,
                overview.failed > 0
                    ? Text(
                        "^[\(overview.failed) promotion](inflect: true) didn't get there", bundle: #bundle,
                        comment: "How many promotions ended without their release getting there.") : nil,
                overview.ready > 0
                    ? Text(
                        "^[\(overview.ready) release](inflect: true) ready to promote", bundle: #bundle,
                        comment: "How many releases can go on to their next environment.") : nil,
            ].compactMap(\.self)
            if let line = joined(parts) {
                line
            } else if let latest = overview.latestInProduction {
                Text(
                    "\(Text(verbatim: latest.release).monospaced()) of \(latest.component) in production for \(agoText(latest.since))",
                    bundle: #bundle,
                    comment:
                        "The release that reached production last. The variables are a release, a component, and a duration."
                )
            } else {
                Text("Nothing in production yet", bundle: #bundle, comment: "No release reached production.")
            }
        } else {
            Text(
                "What's in each environment, and what's next", bundle: #bundle,
                comment: "The Releases door's line before the delivery arrives: what it shows.")
        }
    }
}

/// Parts of a line, one after another: `1 incident · 2 errors`; nil for none.
func joined(_ parts: [Text]) -> Text? {
    guard let first = parts.first else { return nil }
    return parts.dropFirst().reduce(first) { line, part in
        Text("\(line) · \(part)", bundle: #bundle, comment: "Two parts of a line, such as 1 incident · 2 errors.")
    }
}
