import Charts
import CluenoriClient
import CluenoriScreens
import SwiftUI

/// Whether a release works, first: its verdict against the release before, then its life beside
/// the release before's, each number opening where it comes from: who used it, its requests an
/// hour (or a day), the share that failed, its warnings and errors, and how long it ran; then when it
/// was deployed and where its build stands in App Store Connect.
struct ReleaseAnswerSection: View {
    let summary: ReleaseSummary
    let life: ReleaseLife?
    /// The release, as its operations, errors, logs and app health open narrowed to it.
    let ref: ReleaseRef

    var body: some View {
        Section {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    VerdictText(
                        verdict: summary.verdict, slower: summary.slower, failingMore: summary.failingMore,
                        newErrors: summary.newErrors
                    )
                    .font(.headline)
                    .foregroundStyle(summary.verdict.tint)
                    VerdictReason(verdict: summary.verdict, release: summary.release, component: summary.component)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: summary.verdict.symbol)
                    .symbolRenderingMode(.hierarchical)
                    .foregroundStyle(summary.verdict.tint)
            }
            .padding(.vertical, 4)
            if let life {
                numbers(life)
            }
            if let deployedAt = summary.deployedAt {
                LabeledContent {
                    Text(deployedAt, format: .dateTime.month(.abbreviated).day().hour().minute())
                } label: {
                    Text("Deployed", bundle: #bundle, comment: "When a release's deploy was reported.")
                }
            }
            if let store = summary.store {
                LabeledContent {
                    Text(
                        verbatim: storeStageWords(
                            store.stage, appStoreState: store.appStoreState, phased: store.phasedRelease))
                } label: {
                    Text("App Store", bundle: #bundle, comment: "Where a release's build stands in App Store Connect.")
                }
            }
        } header: {
            Group {
                if let previous = summary.previous {
                    Text(
                        "Against \(Text(verbatim: previous).monospaced())", bundle: #bundle,
                        comment:
                            "Header of a release's answer: the release it is compared with. The variable is a release.")
                } else {
                    Text(
                        "Its answer", bundle: #bundle,
                        comment: "Header of a release's answer, with no release before it.")
                }
            }
            .textCase(nil)
        }
    }

    @ViewBuilder private func numbers(_ life: ReleaseLife) -> some View {
        let totals = life.totals
        let before = life.previous
        let unit = totals.rateUnit
        if let people = totals.people {
            NavigationLink(value: Route.appHealth(ref)) {
                ComparedNumber(
                    label: Text("People", bundle: #bundle, comment: "How many people used a release."),
                    value: Text(people, format: .number),
                    before: before.map { $0.people.map { Text($0, format: .number) } })
            }
        }
        if let requests = totals.requests {
            NavigationLink(value: Route.operations(of: .release(ref))) {
                ComparedNumber(
                    label: unit == .hour
                        ? Text("Requests an hour", bundle: #bundle, comment: "A release's requests in an hour.")
                        : Text("Requests a day", bundle: #bundle, comment: "A release's requests in a day."),
                    value: rateText(totals.rate(requests, per: unit)),
                    before: before.map { b in b.requests.map { rateText(b.rate($0, per: unit)) } })
            }
            NavigationLink(value: Route.operations(of: .release(ref))) {
                ComparedNumber(
                    label: Text("Failed", bundle: #bundle, comment: "The share of a release's requests that failed."),
                    value: shareText(totals.failedShare),
                    tint: (totals.failedShare ?? 0) > (before?.failedShare ?? 0) ? Palette.pink : nil,
                    before: before.map { shareText($0.failedShare) })
            }
        }
        if let warnings = totals.warnings {
            NavigationLink(value: Route.logs(of: .release(ref))) {
                ComparedNumber(
                    label: unit == .hour
                        ? Text("Warnings an hour", bundle: #bundle, comment: "A release's warnings in an hour.")
                        : Text("Warnings a day", bundle: #bundle, comment: "A release's warnings in a day."),
                    value: rateText(totals.logRate(warnings, per: unit)),
                    tint: warnings > 0 ? Palette.yellow : nil,
                    before: before.map { b in b.warnings.map { rateText(b.logRate($0, per: unit)) } })
            }
        }
        if let errors = totals.errors {
            NavigationLink(value: Route.errors(of: .release(ref))) {
                ComparedNumber(
                    label: unit == .hour
                        ? Text("Errors an hour", bundle: #bundle, comment: "A release's errors in an hour.")
                        : Text("Errors a day", bundle: #bundle, comment: "A release's errors in a day."),
                    value: rateText(totals.logRate(errors, per: unit)),
                    tint: errors > 0 ? Palette.pink : nil,
                    before: before.map { b in b.errors.map { rateText(b.logRate($0, per: unit)) } })
            }
        }
        ComparedNumber(
            label: Text(
                "Ran for", bundle: #bundle,
                comment: "How long a release ran, from its first request or signal to its last."),
            value: livedText(totals.lived),
            before: before.map { livedText($0.lived) })
    }
}

/// A number of a release beside the release before's: `Requests an hour   3,214 / before 2,509`. An
/// unknown number reads unknown, never 0.
struct ComparedNumber: View {
    let label: Text
    let value: Text
    var tint: Color? = nil
    /// Nil without a release before; `.some(nil)` when the release before's is unknown.
    let before: Text??

    var body: some View {
        LabeledContent {
            VStack(alignment: .trailing, spacing: 1) {
                value
                    .font(.body.monospacedDigit().weight(.medium))
                    .foregroundStyle(tint ?? Palette.text)
                if let before {
                    Group {
                        if let before {
                            Text(
                                "before \(before)", bundle: #bundle,
                                comment: "The same number for the release before. The variable is a number.")
                        } else {
                            Text(
                                "before: unknown", bundle: #bundle, comment: "The release before's number isn't known.")
                        }
                    }
                    .font(.footnote.monospacedDigit())
                    .foregroundStyle(.secondary)
                }
            }
        } label: {
            label
        }
        .accessibilityElement(children: .combine)
    }
}

/// A count in an hour or a day: whole from 100, else to a tenth: `3,214`, `5.7`.
func rateText(_ rate: Double) -> Text {
    Text(rate, format: .number.precision(.fractionLength(rate >= 100 ? 0...0 : 0...1)))
}

/// A share of requests: `0.5%`; unknown without requests.
func shareText(_ share: Double?) -> Text {
    if let share {
        Text(share, format: .percent.precision(.fractionLength(0...1)))
    } else {
        Text("unknown", bundle: #bundle, comment: "A share that isn't known: there were no requests.")
    }
}

/// How long a release lived, in its largest units: `3 hr`, `6 days`; at least a minute.
func livedText(_ seconds: TimeInterval) -> Text {
    Text(
        Duration.seconds(max(seconds, 60)),
        format: .units(allowed: [.days, .hours, .minutes], width: .abbreviated, maximumUnitCount: 1))
}

/// A release's life, step by step: an app's people by the day, its requests with those that
/// failed, and its warnings and errors, over a strip of its whole life. Dragging across the strip zooms the charts to those
/// steps; the strip always shows everything, so a zoom never hides what is outside it. Totals don't
/// change with the zoom: they are in the answer above.
struct ReleaseLifeSection: View {
    let life: ReleaseLife
    @State private var window: LifeWindow?

    var body: some View {
        let points = life.points
        // A zoom of the life before it was shown in other steps may not fit it now.
        let shown = (window ?? .whole(steps: points.count)).within(steps: points.count)
        Section {
            VStack(alignment: .leading, spacing: 14) {
                if points.contains(where: { $0.people != nil }) {
                    chart(
                        title: Text(
                            "People", bundle: #bundle, comment: "Chart of how many people used a release each day."),
                        shown: shown, height: 70,
                        low: { $0.people ?? 0 }, lowColor: Palette.mint,
                        high: { _ in 0 }, highColor: Palette.mint,
                        has: { $0.people != nil })
                }
                if life.totals.requests != nil {
                    chart(
                        title: Text(
                            "Requests", bundle: #bundle, comment: "Chart of a release's requests over its life."),
                        shown: shown, height: 110,
                        low: { ($0.requests ?? 0) - ($0.failed ?? 0) }, lowColor: Palette.sky.opacity(0.85),
                        high: { $0.failed ?? 0 }, highColor: Palette.pink,
                        has: { $0.requests != nil })
                }
                if life.totals.warnings != nil || life.totals.errors != nil {
                    chart(
                        title: Text(
                            "Warnings and errors", bundle: #bundle,
                            comment: "Chart of a release's warnings and errors over its life."),
                        shown: shown, height: 70,
                        low: { $0.warnings ?? 0 }, lowColor: Palette.yellow,
                        high: { $0.errors ?? 0 }, highColor: Palette.pink,
                        has: { $0.warnings != nil || $0.errors != nil })
                }
                if points.count > 3 {
                    LifeOverview(points: points, step: life.step, window: shown) { window = $0 }
                    HStack {
                        if shown.isWhole(steps: points.count) {
                            Text(
                                "Drag across the strip to zoom", bundle: #bundle,
                                comment: "How to zoom a release's life chart.")
                        } else {
                            Text(windowRange(shown), format: .interval.month(.abbreviated).day().hour().minute())
                            Spacer()
                            Button {
                                window = nil
                            } label: {
                                Text("Whole life", bundle: #bundle, comment: "Shows a release's whole life again.")
                            }
                            .buttonStyle(.borderless)
                            .foregroundStyle(Palette.blue)
                        }
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 6)
            .onChange(of: life.step) { window = nil }
        } header: {
            HStack {
                Text("Its life", bundle: #bundle, comment: "Section of a release's life, step by step.")
                Spacer()
                stepText.textCase(nil)
            }
        }
    }

    private var stepText: Text {
        switch life.step {
        case .`5m`: Text("By 5 minutes", bundle: #bundle, comment: "A release's life chart, in steps of 5 minutes.")
        case .`1h`: Text("By the hour", bundle: #bundle, comment: "A release's life chart, in steps of an hour.")
        default: Text("By UTC day", bundle: #bundle, comment: "A release's life chart, in steps of a UTC day.")
        }
    }

    private func windowRange(_ window: LifeWindow) -> Range<Date> {
        let start = life.points[window.first].start
        return start..<life.points[window.last].start.addingTimeInterval(life.step.seconds)
    }

    // One chart of the shown steps: two counts stacked in each step, `low` under `high`; a step it
    // knows nothing of is left empty, never drawn as 0.
    private func chart(
        title: Text, shown: LifeWindow, height: CGFloat, low: @escaping (LifePoint) -> Int, lowColor: Color,
        high: @escaping (LifePoint) -> Int, highColor: Color, has: @escaping (LifePoint) -> Bool
    ) -> some View {
        let step = life.step.seconds
        let points = Array(life.points[shown.first...shown.last]).filter(has)
        return VStack(alignment: .leading, spacing: 4) {
            title
                .font(.footnote)
                .foregroundStyle(.secondary)
            Chart(points, id: \.start) { point in
                let end = point.start.addingTimeInterval(step)
                RectangleMark(
                    xStart: .value(String(localized: "Start", bundle: #bundle), point.start),
                    xEnd: .value(String(localized: "End", bundle: #bundle), end),
                    yStart: .value(String(localized: "Count", bundle: #bundle), 0),
                    yEnd: .value(String(localized: "Count", bundle: #bundle), low(point))
                )
                .foregroundStyle(lowColor)
                RectangleMark(
                    xStart: .value(String(localized: "Start", bundle: #bundle), point.start),
                    xEnd: .value(String(localized: "End", bundle: #bundle), end),
                    yStart: .value(String(localized: "Count", bundle: #bundle), low(point)),
                    yEnd: .value(String(localized: "Count", bundle: #bundle), low(point) + high(point))
                )
                .foregroundStyle(highColor)
            }
            .chartXScale(domain: windowRange(shown).lowerBound...windowRange(shown).upperBound)
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                    AxisGridLine()
                    AxisValueLabel(
                        format: life.step == .`1d` ? .dateTime.month(.abbreviated).day() : .dateTime.hour().minute())
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading, values: .automatic(desiredCount: 3))
            }
            .frame(height: height)
        }
    }
}

/// The whole life of a release in small gray bars, the steps the charts show marked; dragging
/// across it picks the steps to show.
struct LifeOverview: View {
    let points: [LifePoint]
    let step: LifeStep
    let window: LifeWindow
    let zoom: (LifeWindow) -> Void

    var body: some View {
        let values = points.map { $0.requests ?? (($0.warnings ?? 0) + ($0.errors ?? 0)) }
        Chart {
            ForEach(Array(values.enumerated()), id: \.offset) { index, value in
                BarMark(
                    x: .value(String(localized: "Step", bundle: #bundle), index),
                    y: .value(String(localized: "Count", bundle: #bundle), value)
                )
                .foregroundStyle(
                    index >= window.first && index <= window.last ? Palette.secondary : Palette.secondary.opacity(0.35))
            }
        }
        .chartXScale(domain: -0.5...Double(points.count) - 0.5)
        .chartXAxis(.hidden)
        .chartYAxis(.hidden)
        .frame(height: 28)
        .chartOverlay { proxy in
            GeometryReader { geometry in
                Rectangle()
                    .fill(.clear)
                    .contentShape(.rect)
                    .gesture(
                        DragGesture(minimumDistance: 8)
                            .onChanged { drag in
                                guard let plot = proxy.plotFrame.map({ geometry[$0] }) else { return }
                                func index(_ x: CGFloat) -> Int {
                                    Int(((proxy.value(atX: x - plot.minX, as: Double.self) ?? 0)).rounded())
                                }
                                zoom(
                                    .within(
                                        from: index(drag.startLocation.x), to: index(drag.location.x),
                                        steps: points.count))
                            }
                    )
            }
        }
        .accessibilityElement()
        .accessibilityLabel(
            Text("Its whole life", bundle: #bundle, comment: "The strip that zooms a release's life chart.")
        )
        .accessibilityAction(named: Text("Zoom in", bundle: #bundle, comment: "Narrows a release's life chart.")) {
            zoom(window.zoomed(in: true, steps: points.count))
        }
        .accessibilityAction(named: Text("Zoom out", bundle: #bundle, comment: "Widens a release's life chart.")) {
            zoom(window.zoomed(in: false, steps: points.count))
        }
        .accessibilityAdjustableAction { direction in
            // Moves the zoom a step later or earlier, as wide as it is.
            let width = window.last - window.first
            let move = direction == .increment ? 1 : -1
            let first = min(max(0, window.first + move), max(0, points.count - 1 - width))
            zoom(LifeWindow(first: first, last: first + width))
        }
    }
}

/// Every error a release logged, the most frequent first, a new one marked; then how many warnings
/// it logged in its whole life, and the ways to all of them.
struct ReleaseErrorsSection: View {
    let errors: [ErrorGroup]
    let release: String
    let warnings: Int?
    let ref: ReleaseRef

    var body: some View {
        Section {
            if errors.isEmpty {
                Text("It logged no errors.", bundle: #bundle, comment: "A release that logged no error.")
                    .foregroundStyle(.secondary)
            }
            ForEach(errors, id: \.id) { group in
                NavigationLink(value: Route.error(of: .release(ref), id: group.id)) {
                    HStack(alignment: .firstTextBaseline) {
                        ErrorGroupRow(title: group.title, culprit: group.culprit, occurrences: group.occurrences)
                        if group.firstRelease == release {
                            Text("new", bundle: #bundle, comment: "Marks an error first seen in this release.")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Palette.yellow)
                        }
                    }
                }
            }
            NavigationLink(value: Route.logs(of: .release(ref))) {
                if let warnings {
                    Text(
                        "\(warnings, format: .number) warnings in its whole life", bundle: #bundle,
                        comment: "How many warnings a release logged; opens its logs. The variable is a count.")
                } else {
                    Text("Its logs", bundle: #bundle, comment: "Opens a release's warnings and errors.")
                }
            }
            .foregroundStyle(Palette.blue)
        } header: {
            Text("Errors and warnings", bundle: #bundle, comment: "Section of a release's errors and warnings.")
        }
    }
}
