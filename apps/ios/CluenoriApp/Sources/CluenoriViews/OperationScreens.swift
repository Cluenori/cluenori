import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// Every operation of a project over the period, the slowest first by the percentile chosen.
struct OperationsScreen: View {
    @Bindable var operations: OperationsModel

    var body: some View {
        Group {
            if let table = operations.table.value {
                if table.rows.isEmpty {
                    ContentUnavailableView {
                        Label {
                            Text("No operations", bundle: #bundle, comment: "A project ran nothing in the period.")
                        } icon: {
                            Image(systemName: "chart.bar")
                        }
                    } description: {
                        Text(
                            "Nothing was reported in this period.",
                            bundle: #bundle,
                            comment: "Below No operations: missing data isn't zero."
                        )
                    }
                } else {
                    List(operations.order.sorted(table.rows), id: \.self) { row in
                        NavigationLink(
                            value: Route.operation(
                                OperationRef(
                                    project: operations.project,
                                    component: row.component,
                                    environment: row.environment,
                                    name: row.operation
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
        .refreshable { await operations.table.load() }
        .task { await operations.table.load() }
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

/// One operation over the period: its load, its p50, p95 and p99 over time, and its percentiles.
struct OperationScreen: View {
    let operation: OperationModel

    var body: some View {
        List {
            Section {
                if let series = operation.load.value {
                    LoadChart(points: series.points, step: series.step)
                        .padding(.vertical, 8)
                } else {
                    AnswerPlaceholder(problem: operation.load.problem)
                }
            } header: {
                Text("Load", bundle: #bundle, comment: "Section of an operation's runs over time.")
            }
            Section {
                if let series = operation.load.value {
                    LatencyChart(points: series.points)
                        .padding(.vertical, 8)
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
        }
        .navigationTitle(operation.operation.name)
        .refreshable { await operation.refresh() }
        .task { await operation.refresh() }
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
