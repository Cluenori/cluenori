import Charts
import CluenoriClient
import Foundation
import SwiftUI

/// The load over time: one bar per step that had anything counted, its failed part in red. A step
/// without a bar had nothing reported, which isn't the same as nothing done.
struct LoadChart: View {
    let points: [LoadPoint]
    let step: SeriesStep

    var body: some View {
        Chart(points, id: \.start) { point in
            let end = point.start.addingTimeInterval(seconds)
            RectangleMark(
                xStart: .value(String(localized: "Start", bundle: #bundle), point.start),
                xEnd: .value(String(localized: "End", bundle: #bundle), end),
                yStart: .value(String(localized: "Count", bundle: #bundle), 0),
                yEnd: .value(String(localized: "Succeeded", bundle: #bundle), point.count - point.errors)
            )
            .foregroundStyle(Color.accentColor)
            RectangleMark(
                xStart: .value(String(localized: "Start", bundle: #bundle), point.start),
                xEnd: .value(String(localized: "End", bundle: #bundle), end),
                yStart: .value(String(localized: "Count", bundle: #bundle), point.count - point.errors),
                yEnd: .value(String(localized: "Failed", bundle: #bundle), point.count)
            )
            .foregroundStyle(.red)
        }
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                AxisGridLine()
                AxisValueLabel(format: labelFormat)
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 3))
        }
        .frame(height: 140)
    }

    // Each bar's width: its step.
    private var seconds: TimeInterval {
        switch step {
        case .`1m`: 60
        case .`5m`: 300
        case .`1h`: 3_600
        default: 86_400
        }
    }

    // Times within a day by the clock, longer ones by the day.
    private var labelFormat: Date.FormatStyle {
        switch step {
        case .`1m`, .`5m`: .dateTime.hour().minute()
        case .`1h`: .dateTime.weekday(.abbreviated).day()
        default: .dateTime.month(.abbreviated).day()
        }
    }
}

/// How long one operation took over time: its p50, p95 and p99 in each step.
struct LatencyChart: View {
    let points: [LoadPoint]

    var body: some View {
        Chart {
            ForEach(points, id: \.start) { point in
                LineMark(
                    x: .value(String(localized: "Time", bundle: #bundle), point.start),
                    y: .value(String(localized: "Duration", bundle: #bundle), point.p99Ms),
                    series: .value(String(localized: "Percentile", bundle: #bundle), "p99")
                )
                .foregroundStyle(by: .value(String(localized: "Percentile", bundle: #bundle), "p99"))
                LineMark(
                    x: .value(String(localized: "Time", bundle: #bundle), point.start),
                    y: .value(String(localized: "Duration", bundle: #bundle), point.p95Ms),
                    series: .value(String(localized: "Percentile", bundle: #bundle), "p95")
                )
                .foregroundStyle(by: .value(String(localized: "Percentile", bundle: #bundle), "p95"))
                LineMark(
                    x: .value(String(localized: "Time", bundle: #bundle), point.start),
                    y: .value(String(localized: "Duration", bundle: #bundle), point.p50Ms),
                    series: .value(String(localized: "Percentile", bundle: #bundle), "p50")
                )
                .foregroundStyle(by: .value(String(localized: "Percentile", bundle: #bundle), "p50"))
            }
        }
        .chartForegroundStyleScale(["p50": Color.mint, "p95": Color.orange, "p99": Color.red])
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 3)) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let milliseconds = value.as(Double.self) {
                        DurationText(milliseconds: milliseconds)
                    }
                }
            }
        }
        .frame(height: 160)
    }
}
