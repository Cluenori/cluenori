import Charts
import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// One feature's story, with no period: first the answer (everyone who used it, yesterday's people,
/// and what its services ran and failed for it in 7 days), then each of its last 30 UTC days, who
/// used it last, its releases, its errors and its operations. A feature only the apps mark says why
/// its services' part is missing. "Ask an agent" shares a brief for looking further.
struct FeatureScreen: View {
    let feature: FeatureModel
    let environments: EnvironmentChoice
    @Bindable var navigation: Navigation

    var body: some View {
        Group {
            if let story = feature.story.value {
                PanelScreen {
                    FeatureNumbers(feature: feature, story: story)
                    FeatureDaysPanel(days: feature.days(last: 30), servicesNamedIt: feature.servicesNamedIt)
                    if !story.use.latestPeople.isEmpty {
                        FeaturePeoplePanel(project: feature.feature.project, story: story)
                    }
                    if !story.use.releases.isEmpty {
                        FeatureReleasesPanel(story: story)
                    }
                    if !story.logs.errors.isEmpty {
                        FeatureErrorsPanel(feature: feature.feature, errors: story.logs.errors)
                    }
                    if !feature.operations.isEmpty {
                        FeatureOperationsPanel(feature: feature)
                    }
                }
            } else if feature.story.problem == .missing {
                ContentUnavailableView {
                    Label {
                        Text("No such feature", bundle: #bundle, comment: "A feature nothing kept names.")
                    } icon: {
                        Image(systemName: "square.on.circle")
                    }
                } description: {
                    Text(
                        "Nothing kept names it: no app marked it in 15 months, and no service named it in cluenori.feature.",
                        bundle: #bundle,
                        comment: "Why a feature isn't found."
                    )
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Palette.ground)
            } else {
                AnswerPlaceholder(problem: feature.story.problem)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Palette.ground)
            }
        }
        .navigationTitle(Text(verbatim: feature.feature.key))
        .navigationSubtitle(ifAny: feature.feature.environment.map { Text(verbatim: $0) })
        .toolbar {
            if let brief = feature.agentBrief {
                ToolbarItem(placement: .primaryAction) {
                    AskAnAgent(brief: brief)
                }
            }
        }
        .refreshable { await feature.load() }
        .task { await feature.load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: feature.story.problem, receivedAt: feature.story.receivedAt)
        }
    }
}

/// Shares a brief an agent reads to look further, through the API and the CLI: copied, or sent to
/// the agent's app.
struct AskAnAgent: View {
    let brief: String

    var body: some View {
        ShareLink(item: brief) {
            Label {
                Text("Ask an agent", bundle: #bundle, comment: "Shares a brief for an agent to look further.")
            } icon: {
                Image(systemName: "sparkles")
            }
        }
    }
}

/// The answer a feature's screen starts with: everyone who used it, yesterday's people against a
/// week before, and, when its services named it, the last 7 days' operations and errors.
struct FeatureNumbers: View {
    let feature: FeatureModel
    let story: FeatureStory

    var body: some View {
        let days = feature.days(last: 9)
        // Yesterday, the latest whole UTC day, and the same day a week before.
        let yesterday = days.count >= 2 ? days[days.count - 2].people : nil
        let weekBefore = days.first?.people
        let week = days.suffix(7)
        Panel {
            HStack(spacing: 0) {
                number(
                    Text(story.use.people, format: .number),
                    Text("People", bundle: #bundle, comment: "Everyone who used a feature."),
                    Text("In the 15 months kept", bundle: #bundle, comment: "Under everyone who used a feature.")
                        .foregroundStyle(Palette.secondary))
                divider
                number(
                    yesterday.map { Text($0, format: .number) } ?? Text(verbatim: "—"),
                    Text("Yesterday", bundle: #bundle, comment: "A feature's people on the latest whole UTC day."),
                    change(yesterday, weekBefore))
            }
            .fixedSize(horizontal: false, vertical: true)
            if feature.servicesNamedIt {
                PanelDivider()
                HStack(spacing: 0) {
                    number(
                        Text(week.map(\.operations).reduce(0, +), format: .number),
                        Text("Operations, 7 days", bundle: #bundle, comment: "A feature's operations in 7 days."),
                        Text(
                            "^[\(week.map(\.failed).reduce(0, +)) failed](inflect: true)", bundle: #bundle,
                            comment: "How many of a feature's operations failed. The variable is a count."
                        )
                        .foregroundStyle(week.contains { $0.failed > 0 } ? Palette.red : Palette.secondary))
                    divider
                    number(
                        Text(week.compactMap(\.errors).reduce(0, +), format: .number),
                        Text("Errors, 7 days", bundle: #bundle, comment: "A feature's errors in 7 days."),
                        Text(
                            "^[\(week.compactMap(\.warnings).reduce(0, +)) warning](inflect: true)", bundle: #bundle,
                            comment: "How many warnings a feature had. The variable is a count."
                        )
                        .foregroundStyle(Palette.secondary),
                        tint: week.contains { ($0.errors ?? 0) > 0 } ? Palette.pink : nil)
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var divider: some View {
        Rectangle().fill(Palette.divider).frame(width: 1).accessibilityHidden(true)
    }

    // Yesterday's people against the same day a week before.
    private func change(_ now: Int?, _ before: Int?) -> Text {
        guard let now, let before, before > 0 else {
            return Text("Not used a week before", bundle: #bundle, comment: "A feature with no one a week before.")
                .foregroundStyle(Palette.secondary)
        }
        let share = Double(now - before) / Double(before)
        return Text(
            "\(changeText(share)) vs a week before", bundle: #bundle,
            comment: "A count's change against a week before. The variable is a percentage, such as +6%."
        )
        .foregroundStyle(changeColor(share))
    }

    private func number(_ value: Text, _ label: Text, _ note: Text, tint: Color? = nil) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            label
                .font(.caption)
                .foregroundStyle(Palette.secondary)
            value
                .font(.title2.monospacedDigit())
                .foregroundStyle(tint ?? Palette.text)
            note
                .font(.caption)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
    }
}

/// A feature's last 30 UTC days, a row of bars for each measure: people and events from the apps;
/// operations, failed ones, warnings and errors from its services, when they named it.
struct FeatureDaysPanel: View {
    let days: [FeatureDay]
    let servicesNamedIt: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(
                title: Text("Each day", bundle: #bundle, comment: "Title of a feature's days."),
                trailing: Text("Last 30 UTC days", bundle: #bundle, comment: "What a feature's days cover."))
            Panel {
                VStack(alignment: .leading, spacing: 10) {
                    // People aren't added up across days: one who came back would count twice.
                    bars(
                        Text("People", bundle: #bundle, comment: "A feature's people each day."), Palette.purple,
                        total: false
                    ) {
                        $0.people
                    }
                    bars(Text("Events", bundle: #bundle, comment: "A feature's events each day."), Palette.purple) {
                        $0.events
                    }
                    if servicesNamedIt {
                        bars(
                            Text("Operations", bundle: #bundle, comment: "A feature's operations each day."),
                            Palette.sky
                        ) {
                            $0.operations
                        }
                        bars(
                            Text("Failed", bundle: #bundle, comment: "A feature's failed operations each day."),
                            Palette.red
                        ) {
                            $0.failed
                        }
                        bars(
                            Text("Warnings", bundle: #bundle, comment: "A feature's warnings each day."), Palette.yellow
                        ) {
                            $0.warnings
                        }
                        bars(Text("Errors", bundle: #bundle, comment: "A feature's errors each day."), Palette.pink) {
                            $0.errors
                        }
                    }
                    if let first = days.first?.day, let last = days.last?.day {
                        HStack {
                            Text(first, format: utcDayStyle())
                            Spacer()
                            Text(last, format: utcDayStyle())
                        }
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(Palette.secondary)
                        .accessibilityHidden(true)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                if !servicesNamedIt {
                    PanelDivider()
                    Text(
                        "No service named this feature, so its operations, warnings and errors aren't here. A service names it in the cluenori.feature attribute of its spans and logs.",
                        bundle: #bundle,
                        comment: "Below a feature only the apps mark."
                    )
                    .font(.footnote)
                    .foregroundStyle(Palette.secondary)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                }
            }
        }
    }

    // One measure's bars over the days; a day it is unknown, before the logs kept, is left empty.
    private func bars(
        _ name: Text, _ color: Color, total showsTotal: Bool = true, _ value: @escaping (FeatureDay) -> Int?
    ) -> some View {
        let known = days.compactMap { day in value(day).map { (day: day.day, value: $0) } }
        let total = known.map(\.value).reduce(0, +)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                name
                Spacer()
                if showsTotal {
                    Text(total, format: .number)
                        .monospacedDigit()
                        .foregroundStyle(Palette.secondary)
                }
            }
            .font(.footnote)
            Chart(known, id: \.day) { point in
                BarMark(
                    x: .value(String(localized: "Day", bundle: #bundle), point.day, unit: .day),
                    y: .value(String(localized: "Count", bundle: #bundle), point.value)
                )
                .foregroundStyle(color)
            }
            .chartXScale(domain: (days.first?.day ?? .now)...(days.last?.day ?? .now).addingTimeInterval(86_400))
            .chartXAxis(.hidden)
            .chartYAxis(.hidden)
            .environment(\.timeZone, utc)
            .frame(height: 28)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(name)
        .accessibilityValue(showsTotal ? Text(total, format: .number) : Text(verbatim: ""))
    }
}

/// The people who used a feature last, each opening their screen.
struct FeaturePeoplePanel: View {
    let project: String
    let story: FeatureStory

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(
                title: Text("Who uses it", bundle: #bundle, comment: "Title of the people who used a feature last."),
                trailing: Text(
                    "The \(story.use.latestPeople.count) last, of \(story.use.people)", bundle: #bundle,
                    comment: "How many of a feature's people are listed. The variables are counts."))
            Panel {
                ForEach(story.use.latestPeople, id: \.person) { person in
                    if person.person != story.use.latestPeople.first?.person {
                        PanelDivider()
                    }
                    NavigationLink(value: Route.personByID(project: project, person: person.person)) {
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            VStack(alignment: .leading, spacing: 3) {
                                if let user = person.users.first {
                                    Text(verbatim: user)
                                        .font(.body.monospaced())
                                        .lineLimit(1)
                                } else {
                                    Text(
                                        "Without a user ID", bundle: #bundle,
                                        comment: "A person the app never identified."
                                    )
                                    .foregroundStyle(Palette.secondary)
                                }
                                Text(
                                    "^[\(person.days) day](inflect: true), ^[\(person.events) event](inflect: true)",
                                    bundle: #bundle,
                                    comment: "How much a person used a feature. The variables are counts."
                                )
                                .font(.subheadline)
                                .foregroundStyle(Palette.secondary)
                            }
                            Spacer(minLength: 4)
                            if let last = UTCDay.date(person.lastDay) {
                                Text(last, format: utcDayStyle())
                                    .font(.subheadline.monospacedDigit())
                                    .foregroundStyle(Palette.secondary)
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .accessibilityElement(children: .combine)
                    }
                    .buttonStyle(PanelRowStyle())
                }
            }
        }
    }
}

/// The releases a feature was used in, the latest first used first, with their people.
struct FeatureReleasesPanel: View {
    let story: FeatureStory

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(
                title: Text("Releases", bundle: #bundle, comment: "Title of the releases a feature was used in."))
            Panel {
                ForEach(story.use.releases, id: \.self) { release in
                    if release != story.use.releases.first {
                        PanelDivider()
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text(verbatim: release.release)
                                .font(.body.monospaced())
                            Text(verbatim: "\(release.component) · \(release.environment)")
                                .font(.subheadline)
                                .foregroundStyle(Palette.secondary)
                        }
                        Spacer(minLength: 4)
                        Text(
                            "^[\(release.people) person](inflect: true)", bundle: #bundle,
                            comment: "How many people used a feature in a release. The variable is a count."
                        )
                        .font(.subheadline.monospacedDigit())
                        .foregroundStyle(Palette.secondary)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}

/// A feature's errors from its services, the most frequent first, each opening its group.
struct FeatureErrorsPanel: View {
    let feature: FeatureRef
    let errors: [ErrorGroup]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(
                title: Text("Errors", bundle: #bundle, comment: "Title of a feature's errors."),
                trailing: Text("90 days kept", bundle: #bundle, comment: "How long a feature's errors are kept."))
            Panel {
                ForEach(errors, id: \.id) { error in
                    if error.id != errors.first?.id {
                        PanelDivider()
                    }
                    NavigationLink(
                        value: Route.error(
                            of: .project(feature.project, environment: feature.environment ?? error.lastEnvironment),
                            id: error.id)
                    ) {
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            BaselineDot(color: Palette.pink, textStyle: .body)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(verbatim: error.title)
                                    .lineLimit(2)
                                Text(verbatim: error.culprit)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(Palette.secondary)
                                    .lineLimit(1)
                            }
                            Spacer(minLength: 4)
                            Text(error.occurrences, format: .number)
                                .monospacedDigit()
                                .foregroundStyle(Palette.pink)
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .accessibilityElement(children: .combine)
                    }
                    .buttonStyle(PanelRowStyle())
                }
            }
        }
    }
}

/// The operations a feature's services ran for it, every day kept, the most first, each opening its
/// screen.
struct FeatureOperationsPanel: View {
    let feature: FeatureModel

    var body: some View {
        let operations = feature.operations
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(
                title: Text("Operations", bundle: #bundle, comment: "Title of the operations run for a feature."))
            Panel {
                ForEach(operations, id: \.operation) { each in
                    if each.operation != operations.first?.operation {
                        PanelDivider()
                    }
                    NavigationLink(
                        value: Route.operation(
                            OperationRef(
                                project: feature.feature.project, component: each.component,
                                environment: feature.feature.environment, name: each.operation))
                    ) {
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(verbatim: each.operation)
                                    .font(.subheadline.monospaced())
                                    .lineLimit(2)
                                Text(verbatim: each.component)
                                    .font(.caption)
                                    .foregroundStyle(Palette.secondary)
                            }
                            Spacer(minLength: 4)
                            VStack(alignment: .trailing, spacing: 3) {
                                Text(each.count, format: .number)
                                    .monospacedDigit()
                                if each.failed > 0 {
                                    Text(
                                        "^[\(each.failed) failed](inflect: true)", bundle: #bundle,
                                        comment: "How many of an operation's runs failed. The variable is a count."
                                    )
                                    .font(.caption.monospacedDigit())
                                    .foregroundStyle(Palette.red)
                                }
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .accessibilityElement(children: .combine)
                    }
                    .buttonStyle(PanelRowStyle())
                }
            }
        }
    }
}
