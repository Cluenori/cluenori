import Charts
import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// The load over time: one bar per step that had anything counted, in sky, its failed part in pink.
/// A step without a bar had nothing reported, which isn't the same as nothing done. With `onPick`,
/// a tap opens the moment tapped; `moment` is the one open, marked within the rest.
struct LoadChart: View {
    let points: [LoadPoint]
    let step: SeriesStep
    var height: CGFloat = 140
    var moment: Moment? = nil
    var onPick: ((Date) -> Void)? = nil

    var body: some View {
        Chart {
            if let moment {
                MomentMark(moment: moment)
            }
            ForEach(points, id: \.start) { point in
                bars(point)
            }
        }
        .picking(onPick)
        .chartXAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) { _ in
                AxisGridLine()
                AxisValueLabel(format: labelFormat)
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: .automatic(desiredCount: 3))
        }
        .frame(height: height)
    }

    @ChartContentBuilder
    private func bars(_ point: LoadPoint) -> some ChartContent {
        let end = point.start.addingTimeInterval(seconds)
        RectangleMark(
            xStart: .value(String(localized: "Start", bundle: #bundle), point.start),
            xEnd: .value(String(localized: "End", bundle: #bundle), end),
            yStart: .value(String(localized: "Count", bundle: #bundle), 0),
            yEnd: .value(String(localized: "Succeeded", bundle: #bundle), point.count - point.errors)
        )
        .foregroundStyle(Palette.sky.opacity(0.85))
        RectangleMark(
            xStart: .value(String(localized: "Start", bundle: #bundle), point.start),
            xEnd: .value(String(localized: "End", bundle: #bundle), end),
            yStart: .value(String(localized: "Count", bundle: #bundle), point.count - point.errors),
            yEnd: .value(String(localized: "Failed", bundle: #bundle), point.count)
        )
        .foregroundStyle(Palette.pink)
    }

    // Each bar's width: its step.
    private var seconds: TimeInterval { step.seconds }

    // Times within a day by the clock, longer ones by the day.
    private var labelFormat: Date.FormatStyle {
        switch step {
        case .`1m`, .`5m`: .dateTime.hour().minute()
        case .`1h`: .dateTime.weekday(.abbreviated).day()
        default: .dateTime.month(.abbreviated).day()
        }
    }
}

/// How long one operation took over time: its p50, p95 and p99 in each step, with the moment open
/// marked, and a tap opening another, as on its load.
struct LatencyChart: View {
    let points: [LoadPoint]
    var moment: Moment? = nil
    var onPick: ((Date) -> Void)? = nil

    var body: some View {
        Chart {
            if let moment {
                MomentMark(moment: moment)
            }
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
        .picking(onPick)
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

/// The moment open on a chart: its step, outlined behind the bars.
struct MomentMark: ChartContent {
    let moment: Moment

    var body: some ChartContent {
        RectangleMark(
            xStart: .value(String(localized: "Start", bundle: #bundle), moment.start),
            xEnd: .value(String(localized: "End", bundle: #bundle), moment.end)
        )
        .foregroundStyle(Color.primary.opacity(0.14))
        .accessibilityLabel(Text("The moment open", bundle: #bundle, comment: "The step of a chart a tap opened."))
        // A line too, so a step a few points wide shows among hundreds.
        RuleMark(
            x: .value(
                String(localized: "Start", bundle: #bundle),
                moment.start.addingTimeInterval(moment.end.timeIntervalSince(moment.start) / 2))
        )
        .foregroundStyle(Color.primary.opacity(0.7))
        .lineStyle(StrokeStyle(lineWidth: 1.5))
    }
}

extension View {
    /// A tap on the chart opens the moment tapped, when `onPick` is given.
    @ViewBuilder
    fileprivate func picking(_ onPick: ((Date) -> Void)?) -> some View {
        if let onPick {
            chartOverlay { proxy in
                GeometryReader { geometry in
                    Rectangle()
                        .fill(.clear)
                        .contentShape(Rectangle())
                        .onTapGesture { location in
                            guard let frame = proxy.plotFrame else { return }
                            let x = location.x - geometry[frame].origin.x
                            if let date: Date = proxy.value(atX: x) {
                                onPick(date)
                            }
                        }
                }
            }
        } else {
            self
        }
    }
}
