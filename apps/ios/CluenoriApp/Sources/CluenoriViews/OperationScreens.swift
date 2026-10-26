import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// Every operation of a project in one environment over the period, or of one of its releases over
/// its span (`concept/Experience.md`, "Lists, groups and items"): what the period holds in a line,
/// their load, where a tap opens that moment and the requests kept from it, then every operation,
/// the slowest first by the percentile chosen.
struct OperationsScreen: View {
    @Bindable var operations: OperationsModel
    let environments: EnvironmentChoice
    @Bindable var navigation: Navigation

    var body: some View {
        List {
            CoverageSections(
                telemetry: operations.telemetry,
                release: operations.release,
                environments: environments,
                route: .operations(of: operations.telemetry),
                navigation: navigation
            )
            if let table = operations.table.value, !table.rows.isEmpty {
                Section {
                    Text(
                        "\(table.count, format: .number) requests across \(table.rows.count, format: .number) operations",
                        bundle: #bundle,
                        comment: "What a period holds of a project's operations. The variables are counts."
                    )
                    .font(.headline)
                    FailedShare(count: table.count, failed: table.errors)
                        .font(.subheadline)
                    if let series = operations.load.value {
                        LoadChart(
                            points: series.points, step: series.step, moment: operations.moment,
                            onPick: { date in operations.moment = Moment(at: date, in: series) }
                        )
                        .padding(.vertical, 8)
                    }
                } footer: {
                    Text("Tap a moment to open it.", bundle: #bundle, comment: "How a chart opens a moment.")
                }
            }
            if let moment = operations.moment, let series = operations.load.value {
                MomentSection(
                    moment: moment, series: series, requests: operations.requests(in: moment),
                    project: operations.telemetry.project, showOperation: true,
                    close: { operations.moment = nil })
            }
            if let table = operations.table.value {
                ForEach(operations.order.sorted(table.rows), id: \.self) { row in
                    NavigationLink(
                        value: Route.operation(
                            OperationRef(
                                project: operations.telemetry.project,
                                component: row.component,
                                environment: row.environment,
                                name: row.operation,
                                release: operations.telemetry.release?.version
                            )
                        )
                    ) {
                        OperationRowView(
                            name: row.operation,
                            component: row.component,
                            count: row.count,
                            errors: row.errors,
                            shownMs: shownMs(row),
                            order: operations.order
                        )
                    }
                }
            }
        }
        .overlay {
            if let table = operations.table.value {
                if table.rows.isEmpty {
                    NothingShown(
                        title: Text("No operations", bundle: #bundle, comment: "A project ran nothing in the period."),
                        systemImage: "chart.bar",
                        narrowed: operations.release != nil,
                        period: $navigation.period
                    )
                }
            } else {
                AnswerPlaceholder(problem: operations.table.problem)
            }
        }
        .navigationTitle(Text("Operations", bundle: #bundle, comment: "Title of every operation of a project."))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Picker(selection: $operations.order) {
                    ForEach(OperationOrder.allCases, id: \.self) { order in
                        Text(verbatim: order.rawValue).tag(order)
                    }
                } label: {
                    Label {
                        Text("Order", bundle: #bundle, comment: "The menu that orders operations.")
                    } icon: {
                        Image(systemName: "arrow.up.arrow.down")
                    }
                }
                .pickerStyle(.menu)
            }
        }
        .refreshable { await operations.refresh() }
        .task { await operations.refresh() }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: operations.table.problem, receivedAt: operations.table.receivedAt)
        }
    }

    private func shownMs(_ row: OperationRow) -> Double {
        switch operations.order {
        case .p50: row.p50Ms
        case .p80: row.p80Ms
        case .p99: row.p99Ms
        case .p95, .count, .errors: row.p95Ms
        }
    }
}

struct OperationRowView: View {
    let name: String
    let component: String
    let count: Int
    let errors: Int
    let shownMs: Double
    let order: OperationOrder

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .lineLimit(2)
                HStack(spacing: 6) {
                    Text(component)
                    Text(count, format: .number)
                    FailedShare(count: count, failed: errors)
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
            Spacer(minLength: 12)
            VStack(alignment: .trailing, spacing: 2) {
                DurationText(milliseconds: shownMs)
                    .font(.body.weight(.semibold))
                Text(verbatim: order == .count || order == .errors ? "p95" : order.rawValue)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// One operation and its requests, in its environment, over the period and every release, or over
/// one release's span (`concept/Experience.md`, "Lists, groups and items"): what the period holds of
/// it, or that it holds none and when it last ran; its load and its p50, p95 and p99 over time,
/// where a tap opens that moment and the requests kept from it; its percentiles; then its failed and
/// slowest requests, each opening its trace. Its incidents, open and resolved lately, come first
/// when it has any.
struct OperationScreen: View {
    let operation: OperationModel
    /// The project's incidents, of which those about this operation show.
    let incidents: IncidentsModel
    /// The project's monitors, to which "Monitor this" adds one.
    let monitors: MonitorsModel
    let environments: EnvironmentChoice
    @Bindable var navigation: Navigation
    /// The monitor being drafted, of this operation in the environment it is for; nil for none.
    @State private var monitoring: MonitorTarget? = nil

    // The quiet hint about this operation, a guess that it is a job that hasn't run, when there is one.
    private var quiet: QuietOperation? {
        let ref = operation.operation
        return incidents.incidents.value?.quiet.first { hint in
            hint.operation == ref.name && hint.component == ref.component
                && (ref.environment == nil || hint.environment == ref.environment)
        }
    }

    // The incidents about this operation, in its component and, when it shows one, its environment.
    private var about: [Incident] {
        guard let list = incidents.incidents.value else { return [] }
        let ref = operation.operation
        return (list.open + list.resolved).filter { incident in
            let name: String? =
                switch incident.evidence {
                case .failing(let failing): failing.operation
                case .stopped(let stopped): stopped.operation
                case .monitor(let fired):
                    if case .operation(let operation) = fired.condition.subject { operation } else { nil }
                case .down, .unknown: nil
                }
            return name == ref.name && incident.component == ref.component
                && (ref.environment == nil || incident.environment == ref.environment)
        }
    }

    var body: some View {
        List {
            CoverageSections(
                telemetry: operation.operation.telemetry,
                release: operation.release,
                environments: environments,
                route: .operation(operation.operation),
                navigation: navigation
            )
            if let quiet {
                Section {
                    QuietWords(usualGapMs: quiet.usualGapMs, lastRanAt: quiet.lastRanAt).text
                        .foregroundStyle(Palette.yellow)
                    Button {
                        let ref = operation.operation
                        monitoring = MonitorTarget(
                            project: ref.project, component: quiet.component, environment: quiet.environment,
                            name: ref.name, draft: .job(ref.name, usualGapMs: quiet.usualGapMs))
                    } label: {
                        Label {
                            Text(
                                "It's a job: monitor it", bundle: #bundle,
                                comment: "Monitors a quiet operation as a job.")
                        } icon: {
                            Image(systemName: "dot.radiowaves.left.and.right")
                        }
                    }
                }
            }
            if !about.isEmpty {
                Section {
                    ForEach(about, id: \.id) { incident in
                        NavigationLink(value: Route.incident(project: incidents.project, id: incident.id)) {
                            IncidentRow(
                                title: incident.title, openedAt: incident.openedAt,
                                acknowledged: incident.acknowledgedAt != nil, resolvedAt: incident.resolvedAt)
                        }
                    }
                } header: {
                    Text(
                        "Incidents", bundle: #bundle,
                        comment: "Section of the incidents about an operation: open, and resolved in the last 7 days.")
                }
            }
            Section {
                if let row = operation.table.value?.rows.first {
                    Text(
                        "\(row.count, format: .number) requests, p95 \(Duration.milliseconds(row.p95Ms), format: DurationText.style(row.p95Ms))",
                        bundle: #bundle,
                        comment: "What a period holds of an operation. The variables are a count and a duration."
                    )
                    .font(.headline)
                }
                if let series = operation.load.value {
                    LoadChart(
                        points: series.points, step: series.step, moment: operation.moment,
                        onPick: { date in operation.moment = Moment(at: date, in: series) }
                    )
                    .padding(.vertical, 8)
                } else {
                    AnswerPlaceholder(problem: operation.load.problem)
                }
            } header: {
                Text("Load", bundle: #bundle, comment: "Section of an operation's runs over time.")
            } footer: {
                Text("Tap a moment to open it.", bundle: #bundle, comment: "How a chart opens a moment.")
            }
            Section {
                if let series = operation.load.value {
                    LatencyChart(
                        points: series.points, moment: operation.moment,
                        onPick: { date in operation.moment = Moment(at: date, in: series) }
                    )
                    .padding(.vertical, 8)
                }
                if let table = operation.table.value, table.rows.isEmpty {
                    if operation.release != nil {
                        Text(
                            "It didn't run in this release.",
                            bundle: #bundle,
                            comment: "An operation that didn't run in the release a screen is narrowed to."
                        )
                        .foregroundStyle(.secondary)
                    } else if let lastSeen = table.lastSeen {
                        // The operation is known whatever the period; only its requests are the period's.
                        Text(
                            "None in \(periodPhrase(navigation.period)). Last ran \(lastSeen, format: .relative(presentation: .named)).",
                            bundle: #bundle,
                            comment:
                                "An operation none of whose requests are in the period, and when it last ran. The variables are a period and a time."
                        )
                        .foregroundStyle(.secondary)
                        LookFurtherBack(period: $navigation.period)
                    } else {
                        Text(
                            "It didn't run in \(periodPhrase(navigation.period)).",
                            bundle: #bundle,
                            comment: "An operation that didn't run in the period. The variable is a period."
                        )
                        .foregroundStyle(.secondary)
                        LookFurtherBack(period: $navigation.period)
                    }
                }
                if let row = operation.table.value?.rows.first {
                    PercentilesGrid(
                        p50Ms: row.p50Ms,
                        p80Ms: row.p80Ms,
                        p95Ms: row.p95Ms,
                        p99Ms: row.p99Ms,
                        count: row.count,
                        errors: row.errors
                    )
                }
            } header: {
                Text("Latency", bundle: #bundle, comment: "Section of how long an operation took.")
            }
            if let moment = operation.moment, let series = operation.load.value {
                MomentSection(
                    moment: moment, series: series, requests: operation.requests(in: moment),
                    project: operation.operation.project, showOperation: false,
                    close: { operation.moment = nil })
            }
            if let kept = operation.kept.value {
                if !kept.failed.isEmpty {
                    Section {
                        ForEach(kept.failed, id: \.self) { row in
                            RequestRow(row: row, project: operation.operation.project, showOperation: false)
                        }
                    } header: {
                        Text("Failed requests", bundle: #bundle, comment: "Section of an operation's failed requests.")
                    }
                }
                Section {
                    if kept.slowest.isEmpty {
                        Text(
                            "No request of this period is kept. Of each hour, the five slowest are kept 14 days.",
                            bundle: #bundle,
                            comment: "An operation with no slow request kept in the period."
                        )
                        .foregroundStyle(.secondary)
                    }
                    ForEach(kept.slowest, id: \.self) { row in
                        RequestRow(row: row, project: operation.operation.project, showOperation: false)
                    }
                } header: {
                    Text("Slowest requests", bundle: #bundle, comment: "Section of an operation's slowest requests.")
                }
            }
        }
        .navigationTitle(operation.operation.name)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                MonitorThisButton {
                    let ref = operation.operation
                    monitoring = MonitorTarget(
                        project: ref.project, component: ref.component, environment: ref.environment, name: ref.name,
                        draft: .first(.operation(ref.name)))
                }
            }
        }
        .monitorSheet($monitoring, monitors: monitors, navigation: navigation)
        .refreshable {
            async let incidents: Void = incidents.load()
            await operation.refresh()
            await incidents
        }
        .task {
            async let incidents: Void = incidents.load()
            await operation.refresh()
            await incidents
        }
        .safeAreaInset(edge: .bottom) {
            AnswerBanner(problem: operation.load.problem, receivedAt: operation.load.receivedAt)
        }
    }
}

struct PercentilesGrid: View {
    let p50Ms: Double
    let p80Ms: Double
    let p95Ms: Double
    let p99Ms: Double
    let count: Int
    let errors: Int

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
            GridRow {
                Percentile(name: "p50", milliseconds: p50Ms)
                Percentile(name: "p80", milliseconds: p80Ms)
                Percentile(name: "p95", milliseconds: p95Ms)
                Percentile(name: "p99", milliseconds: p99Ms)
            }
            GridRow {
                Text(count, format: .number)
                    .monospacedDigit()
                    .gridCellColumns(2)
                FailedShare(count: count, failed: errors)
                    .gridCellColumns(2)
            }
            .font(.subheadline)
        }
        .padding(.vertical, 4)
    }
}

struct Percentile: View {
    let name: String
    let milliseconds: Double

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            DurationText(milliseconds: milliseconds)
                .font(.headline)
            Text(verbatim: name)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A request, as a row that opens its trace: when it started, its operation when the list is of
/// several, how long it took, and its status, red when it failed.
struct RequestRow: View {
    let row: KeptTraceRow
    let project: String
    let showOperation: Bool

    var body: some View {
        NavigationLink(value: Route.trace(TraceRef(project: project, id: row.trace, around: row.start))) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    if showOperation {
                        Text(row.operation)
                            .lineLimit(2)
                    }
                    Text(row.start, format: .dateTime.month(.abbreviated).day().hour().minute().second())
                        .font(showOperation ? .subheadline : .body)
                        .foregroundStyle(showOperation ? .secondary : .primary)
                        .monospacedDigit()
                }
                Spacer(minLength: 12)
                VStack(alignment: .trailing, spacing: 2) {
                    DurationText(milliseconds: row.durationMs)
                        .font(.body.weight(.semibold))
                    if let status = row.status {
                        Text(verbatim: "\(status)")
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(row.failed ? .red : .secondary)
                    } else if row.failed {
                        Text("failed", bundle: #bundle, comment: "A request that failed, with no HTTP status.")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }
            .accessibilityElement(children: .combine)
        }
    }
}

/// The moment a chart opened, marked on it: how many ran then, how many failed, and how long they
/// took, then the requests kept from it.
struct MomentSection: View {
    let moment: Moment
    let series: LoadSeries
    let requests: Answer<KeptTraces>
    let project: String
    let showOperation: Bool
    let close: () -> Void

    var body: some View {
        Section {
            if let point = moment.point(in: series) {
                PercentilesGrid(
                    p50Ms: point.p50Ms, p80Ms: point.p80Ms, p95Ms: point.p95Ms, p99Ms: point.p99Ms, count: point.count,
                    errors: point.errors)
            } else {
                Text(
                    "Nothing was reported then. The sender may have been silent.",
                    bundle: #bundle,
                    comment: "A moment of a chart with nothing counted."
                )
                .foregroundStyle(.secondary)
            }
            if let kept = requests.value {
                if kept.requests.isEmpty {
                    Text(
                        "No request of this moment is kept.",
                        bundle: #bundle,
                        comment: "A moment of a chart none of whose requests are kept."
                    )
                    .foregroundStyle(.secondary)
                }
                ForEach(kept.requests, id: \.self) { row in
                    RequestRow(row: row, project: project, showOperation: showOperation)
                }
            } else {
                AnswerPlaceholder(problem: requests.problem)
            }
        } header: {
            HStack {
                Text(
                    "\(moment.from, format: .dateTime.month(.abbreviated).day().hour().minute())–\(moment.to, format: .dateTime.hour().minute())",
                    bundle: #bundle,
                    comment: "The moment a chart opened, from when to when."
                )
                Spacer()
                Button(action: { close() }) {
                    Label {
                        Text("Close", bundle: #bundle, comment: "Closes the moment a chart opened.")
                    } icon: {
                        Image(systemName: "xmark")
                    }
                    .labelStyle(.iconOnly)
                }
            }
        }
        .task(id: moment) { await requests.load() }
    }
}
