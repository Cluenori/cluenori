import Charts
import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// One person, found by the app's own user ID for them: their user IDs and when they were first and
/// last seen, their installations, the days they were active, and their timeline, newest first.
struct PersonScreen: View {
    let person: PersonModel

    var body: some View {
        List {
            if let found = person.person.value {
                PersonContent(person: found)
            }
        }
        .overlay {
            if person.person.value == nil {
                if person.person.problem == .missing {
                    NoSuchPerson()
                } else {
                    AnswerPlaceholder(problem: person.person.problem)
                }
            }
        }
        .navigationTitle(Text(verbatim: person.user))
        #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
        #endif
        .refreshable { await person.load() }
        .task { await person.load() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: person.person.problem, receivedAt: person.person.receivedAt)
        }
    }
}

/// A user ID the apps never sent.
struct NoSuchPerson: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text("No such person", bundle: #bundle, comment: "A user ID the apps never sent.")
            } icon: {
                Image(systemName: "person.crop.circle.badge.questionmark")
            }
        } description: {
            Text(
                "No person with this user ID: the app never sent it.", bundle: #bundle,
                comment: "Why a person isn't found by their user ID.")
        }
    }
}

/// A person's sections: who they are, their installations, their active days, and their timeline.
struct PersonContent: View {
    let person: AppPerson

    var body: some View {
        Section {
            LabeledContent {
                VStack(alignment: .trailing, spacing: 2) {
                    ForEach(person.users, id: \.self) { user in
                        Text(verbatim: user)
                            .unhyphenated()
                            .monospaced()
                            .textSelection(.enabled)
                    }
                }
                .multilineTextAlignment(.trailing)
            } label: {
                Text(
                    "^[User ID](inflect: true)", bundle: #bundle,
                    comment: "Label of a person's user IDs, the app's own IDs for them.")
            }
            LabeledContent {
                Text(person.firstSeen, format: .dateTime.month(.abbreviated).day().year().hour().minute())
            } label: {
                Text("First seen", bundle: #bundle, comment: "When a person first sent anything.")
            }
            LabeledContent {
                Text(person.lastSeen, format: .dateTime.month(.abbreviated).day().hour().minute())
            } label: {
                Text("Last seen", bundle: #bundle, comment: "When a person last sent anything.")
            }
        }
        if !person.installations.isEmpty {
            Section {
                ForEach(person.installations, id: \.installation) { installation in
                    InstallationRow(
                        component: installation.component, environment: installation.environment,
                        release: installation.release, model: installation.device.model,
                        platform: installation.device.platform.rawValue, osVersion: installation.device.osVersion,
                        locale: installation.device.locale, country: installation.country,
                        lastSeen: installation.lastSeen)
                }
            } header: {
                Text("Installations", bundle: #bundle, comment: "Section of the apps a person has, one per device.")
            }
        }
        Section {
            ActiveDaysRow(days: person.days)
        } header: {
            Text("Active days", bundle: #bundle, comment: "Section of the days a person used the apps.")
        } footer: {
            Text(
                "Sessions by UTC day, the latest 90 days kept.", bundle: #bundle,
                comment: "Below a person's active days: what the chart shows.")
        }
        Section {
            if person.timeline.isEmpty {
                Text("Nothing kept.", bundle: #bundle, comment: "A person's timeline without any signal.")
                    .foregroundStyle(.secondary)
            }
            ForEach(Array(person.timeline.enumerated()), id: \.offset) { _, entry in
                TimelineRow(signal: entry.signal, release: entry.release, component: entry.component)
            }
        } header: {
            Text("Timeline", bundle: #bundle, comment: "Section of what a person did, newest first.")
        } footer: {
            if person.timeline.count >= 1_000 {
                Text(
                    "The latest 1,000 are kept.", bundle: #bundle,
                    comment: "Below a full timeline: how many are kept.")
            }
        }
    }
}

/// One app on one device: where it runs, its release, the device, and when it last sent.
struct InstallationRow: View {
    let component: String
    let environment: String
    let release: String
    let model: String
    let platform: String
    let osVersion: String
    let locale: String
    /// Absent when Cloudflare couldn't say.
    let country: String?
    let lastSeen: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            TitleAndValue {
                Text(verbatim: release)
                    .unhyphenated()
                    .font(.body.monospaced())
                    .lineLimit(2)
            } value: {
                Text(lastSeen, format: .relative(presentation: .named))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            Text(verbatim: "\(component) · \(environment)")
                .unhyphenated()
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Text(verbatim: device)
                .unhyphenated()
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }

    // `iPhone17,1 · iOS 27.1 · en_US · UA`, as each part is sent.
    private var device: String {
        ([model, "\(platform) \(osVersion)", locale] + (country.map { [$0] } ?? [])).joined(separator: " · ")
    }
}

/// A person's sessions on each UTC day they were active, as bars, with how many days and sessions.
struct ActiveDaysRow: View {
    let days: [PersonDay]

    var body: some View {
        let points = days.compactMap { day in UTCDay.date(day.day).map { DayCount(day: $0, value: day.sessions) } }
        VStack(alignment: .leading, spacing: 6) {
            Text(
                "\(Text("^[\(points.count) day](inflect: true)", bundle: #bundle, comment: "How many days a person was active. The variable is a count.")) · \(Text("^[\(points.reduce(0) { $0 + $1.value }) session](inflect: true)", bundle: #bundle, comment: "How many sessions a person had. The variable is a count."))",
                bundle: #bundle,
                comment: "A person's active days and sessions. The variables are counts, as words."
            )
            .monospacedDigit()
            if let last = points.map(\.day).max() {
                Chart(points, id: \.day) { point in
                    RectangleMark(
                        xStart: .value(String(localized: "Day", bundle: #bundle), point.day.addingTimeInterval(3_600)),
                        xEnd: .value(String(localized: "Day", bundle: #bundle), point.day.addingTimeInterval(82_800)),
                        yStart: .value(String(localized: "Sessions", bundle: #bundle), 0),
                        yEnd: .value(String(localized: "Sessions", bundle: #bundle), point.value)
                    )
                    .foregroundStyle(Color.purple)
                    .accessibilityLabel(Text(point.day, format: utcDayStyle()))
                    .accessibilityValue(
                        Text(
                            "^[\(point.value) session](inflect: true)", bundle: #bundle,
                            comment: "How many sessions a person had. The variable is a count."))
                }
                .chartXScale(domain: last.addingTimeInterval(-89 * 86_400)...last.addingTimeInterval(86_400))
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                        AxisGridLine()
                        AxisValueLabel(format: utcDayStyle())
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading, values: .automatic(desiredCount: 2))
                }
                .environment(\.timeZone, utc)
                // Its axes' labels stop growing where they would overlap.
                .dynamicTypeSize(...DynamicTypeSize.xLarge)
                .frame(height: 72)
            }
        }
        .padding(.vertical, 4)
    }
}

/// One signal of a person's timeline: what happened, and when, in which release and feature.
struct TimelineRow: View {
    let signal: TimelineSignal
    let release: String
    let component: String

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                what
                Text(verbatim: context)
                    .unhyphenated()
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: symbol)
                .foregroundStyle(tint)
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var what: some View {
        switch signal {
        case .sessionStarted:
            Text("Session started", bundle: #bundle, comment: "A person's app came to the foreground.")
        case .sessionEnded(let ended):
            Text(
                "Session ended · \(Duration.milliseconds(ended.foregroundMs), format: .units(allowed: [.hours, .minutes, .seconds], width: .abbreviated, maximumUnitCount: 2)) in the foreground",
                bundle: #bundle,
                comment: "A person's session ended, with its foreground time. The variable is a duration."
            )
        case .appLaunched(let launch):
            VStack(alignment: .leading, spacing: 2) {
                Group {
                    if launch.start == .cold {
                        Text(
                            "Cold launch · \(Text(verbatim: HealthLineRow.words(.milliseconds(launch.firstFrameMs)))) to first frame",
                            bundle: #bundle,
                            comment: "A cold launch and its time to the first frame. The variable is a duration.")
                    } else {
                        Text(
                            "Warm launch · \(Text(verbatim: HealthLineRow.words(.milliseconds(launch.firstFrameMs)))) to first frame",
                            bundle: #bundle,
                            comment: "A warm launch and its time to the first frame. The variable is a duration.")
                    }
                }
                if let ready = launch.readyMs {
                    Text(
                        "\(Text(verbatim: HealthLineRow.words(.milliseconds(ready)))) to first useful screen",
                        bundle: #bundle,
                        comment: "A launch's time to the app's first useful screen. The variable is a duration."
                    )
                    .font(.subheadline)
                }
                if launch.prewarmed {
                    Text(
                        "Prewarmed by iOS", bundle: #bundle,
                        comment: "A launch iOS started ahead, so its time isn't comparable."
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
            }
        case .screen(let screen):
            Text(
                "Screen \(Text(verbatim: screen.screen).monospaced())", bundle: #bundle,
                comment: "A screen the app showed. The variable is its name, as the app sent it.")
        case .event(let event):
            VStack(alignment: .leading, spacing: 2) {
                Text(
                    "Event \(Text(verbatim: event.name).monospaced())", bundle: #bundle,
                    comment: "An event the app sent. The variable is its name, as the app sent it.")
                if let properties = event.properties, !properties.isEmpty {
                    Text(verbatim: Self.words(properties))
                        .unhyphenated()
                        .font(.subheadline.monospaced())
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            }
        case .metrickit(let report):
            Text(
                "MetricKit report · \(Text("^[\(report.crashes) crash](inflect: true)", bundle: #bundle, comment: "How many crashes a MetricKit report had. The variable is a count.")), \(Text("^[\(report.hangs) hang](inflect: true)", bundle: #bundle, comment: "How many hangs a MetricKit report had. The variable is a count."))",
                bundle: #bundle,
                comment: "A MetricKit report, with its crashes and hangs. The variables are counts, as words."
            )
        default:
            Text(
                "A signal this version can't show. Update the app.", bundle: #bundle,
                comment: "A timeline signal of a kind this app doesn't know.")
        }
    }

    // When, in which release, and in which feature: `Oct 22, 9:41 AM · 0.3.0+20 · cards.flip`.
    private var context: String {
        let at: Date?
        let feature: String?
        switch signal {
        case .sessionStarted(let signal): (at, feature) = (signal.at, signal.feature)
        case .sessionEnded(let signal): (at, feature) = (signal.at, signal.feature)
        case .appLaunched(let signal): (at, feature) = (signal.at, signal.feature)
        case .screen(let signal): (at, feature) = (signal.at, signal.feature)
        case .event(let signal): (at, feature) = (signal.at, signal.feature)
        case .metrickit(let signal): (at, feature) = (signal.at, nil)
        default: (at, feature) = (nil, nil)
        }
        let when = at?.formatted(.dateTime.month(.abbreviated).day().hour().minute().second())
        return ([when, release, feature].compactMap { $0 }).joined(separator: " · ")
    }

    private var symbol: String {
        switch signal {
        case .sessionStarted: "play.circle"
        case .sessionEnded: "stop.circle"
        case .appLaunched: "bolt.circle"
        case .screen: "rectangle.portrait"
        case .event: "smallcircle.filled.circle"
        case .metrickit: "stethoscope"
        default: "questionmark.circle"
        }
    }

    private var tint: Color {
        switch signal {
        case .metrickit(let report) where report.crashes > 0 || report.hangs > 0: Verdict.worse.tint
        case .appLaunched: .orange
        case .event: .purple
        default: .secondary
        }
    }

    /// An event's properties as `name: value` pairs, by name: `pinned: true, words: 120`.
    static func words(_ properties: [String: JSONValue]) -> String {
        properties.sorted { $0.key < $1.key }.map { "\($0.key): \(words($0.value))" }.joined(separator: ", ")
    }

    private static func words(_ value: JSONValue) -> String {
        switch value {
        case .null: "null"
        case .bool(let bool): bool ? "true" : "false"
        case .number(let number): number.formatted(.number.grouping(.never).locale(Locale(identifier: "en_US_POSIX")))
        case .string(let string): "\"\(string)\""
        case .array(let values): "[\(values.map(words).joined(separator: ", "))]"
        case .object(let object): "{\(words(object))}"
        }
    }
}

// MARK: - Previews, on made-up values

#if DEBUG
    enum PersonPreviewData {
        static let now = AnalyticsPreviewData.now
        static let device = AppDevice(
            model: "iPhone17,1", platform: .iOS, osVersion: "27.1", locale: "en_US", timeZone: "Europe/Kyiv")

        static func entry(_ signal: TimelineSignal) -> TimelineEntry {
            TimelineEntry(
                component: "notes-ios", environment: "production", release: "0.3.0+20", installation: "i-1",
                signal: signal)
        }

        static let person = AppPerson(
            person: "p-7f2c", users: ["user-1842"], firstSeen: now.addingTimeInterval(-40 * 86_400),
            lastSeen: now.addingTimeInterval(-600),
            installations: [
                AppInstallation(
                    installation: "i-1", component: "notes-ios", environment: "production", release: "0.3.0+20",
                    device: device, sdk: AppSdk(name: "cluenori-swift", version: "0.1.0"), country: "PT",
                    firstSeen: now.addingTimeInterval(-40 * 86_400), lastSeen: now.addingTimeInterval(-600)),
                AppInstallation(
                    installation: "i-2", component: "notes-ios", environment: "beta", release: "0.4.0+25",
                    device: AppDevice(
                        model: "iPad16,3", platform: .iPadOS, osVersion: "27.0", locale: "pt_PT",
                        timeZone: "Europe/Lisbon"),
                    sdk: AppSdk(name: "cluenori-swift", version: "0.1.0"),
                    firstSeen: now.addingTimeInterval(-3 * 86_400), lastSeen: now.addingTimeInterval(-86_400)),
            ],
            days: (0..<12).map { index in
                let day = UTCDay.date("2026-10-22")!.addingTimeInterval(-Double(index * 3) * 86_400)
                return PersonDay(
                    day: day.formatted(.iso8601.year().month().day()), sessions: 1 + index % 4,
                    foregroundMs: 600_000)
            },
            timeline: [
                entry(
                    .sessionEnded(
                        SessionEnded(id: "s6", at: now.addingTimeInterval(-600), session: "a", foregroundMs: 252_000))),
                entry(
                    .event(
                        EventTracked(
                            id: "s5", at: now.addingTimeInterval(-700), session: "a", feature: "cards.flip",
                            name: "card.flipped", properties: ["deck": .string("verbs"), "count": .number(12)]))),
                entry(
                    .screen(
                        ScreenShown(
                            id: "s4", at: now.addingTimeInterval(-800), session: "a", feature: "cards.flip",
                            screen: "DeckView"))),
                entry(
                    .metrickit(
                        MetricKitSummary(
                            id: "s3", at: now.addingTimeInterval(-850), report: .diagnostics, crashes: 1, hangs: 0))),
                entry(
                    .appLaunched(
                        AppLaunched(
                            id: "s2", at: now.addingTimeInterval(-860), session: "a", start: .cold, prewarmed: false,
                            firstFrameMs: 1_380, readyMs: 1_710))),
                entry(.sessionStarted(SessionStarted(id: "s1", at: now.addingTimeInterval(-861), session: "a"))),
            ])

        // Without installations' country, active days, or a timeline.
        static let partial = AppPerson(
            person: "p-1a", users: ["user-1003", "8C1F4E2A-55D0-4B7E-9F31-2A6C0D9E7B11"],
            firstSeen: now.addingTimeInterval(-3_600), lastSeen: now.addingTimeInterval(-3_000),
            installations: [], days: [], timeline: [])
    }

    #Preview("Person") {
        NavigationStack {
            List { PersonContent(person: PersonPreviewData.person) }
                .navigationTitle("user-1842")
        }
    }

    #Preview("Person, little sent") {
        NavigationStack {
            List { PersonContent(person: PersonPreviewData.partial) }
                .navigationTitle("user-1003")
        }
    }

    #Preview("Person, not found") {
        NavigationStack {
            List {}
                .overlay { NoSuchPerson() }
                .navigationTitle("user-0000")
        }
    }

    #Preview("Person, loading and offline") {
        List {
            AnswerPlaceholder(problem: nil)
            AnswerPlaceholder(problem: .unreachable)
        }
    }
#endif
