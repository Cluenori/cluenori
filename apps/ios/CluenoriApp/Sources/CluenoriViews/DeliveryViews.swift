import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

// How a project's components' releases reach their environments, in words: what's where, since
// when, and the one next step; the project's overview of it, a row for each component.

/// A next step as its button says it, naming what goes where: `Promote 1.0.0+3 to prod`,
/// `Build latest commit`.
func stepTitle(_ step: DeliveryStep) -> Text {
    switch step {
    case .promote(let release, _, let to):
        Text(
            "Promote \(release) to \(to)",
            bundle: #bundle,
            comment: "Promotes a release to the next environment. The variables are a release and an environment."
        )
    case .buildLatest:
        Text(
            "Build latest commit",
            bundle: #bundle,
            comment: "Builds the default branch's newest commit and deploys it to a component's first environment."
        )
    case .unknown:
        Text(
            "A next step this version can't show. Update the app.",
            bundle: #bundle,
            comment: "A next step of a kind this app doesn't know."
        )
    }
}

/// When something reached where it is: a time today, else a day, `1:57 PM`, `Oct 20`.
func reachedText(_ date: Date, now: Date = .now) -> Text {
    if Calendar.current.isDate(date, inSameDayAs: now) {
        Text(date, format: .dateTime.hour().minute())
    } else if Calendar.current.isDate(date, equalTo: now, toGranularity: .year) {
        Text(date, format: .dateTime.month(.abbreviated).day())
    } else {
        Text(date, format: .dateTime.year().month(.abbreviated).day())
    }
}

/// How long since `date`, in its largest unit: `2 hours`, `3 days`; `under a minute` before one.
func durationText(since date: Date, now: Date = .now) -> Text {
    let seconds = now.timeIntervalSince(date)
    guard seconds >= 60 else {
        return Text(
            "under a minute", bundle: #bundle, comment: "How long something has been somewhere: not a minute yet.")
    }
    return Text(
        Duration.seconds(seconds),
        format: .units(allowed: [.days, .hours, .minutes], width: .wide, maximumUnitCount: 1)
    )
}

/// Since when a release is in an environment, and for how long: `Since 1:57 PM · 2 hours`.
struct SinceText: View {
    let since: Date

    var body: some View {
        Text(
            "Since \(reachedText(since)) · \(durationText(since: since))",
            bundle: #bundle,
            comment:
                "When a release reached an environment, and how long it has been there. The variables are a time or day, and a duration."
        )
    }
}

/// Marks one of a project's production environments: `Production`, in a capsule.
struct ProductionTag: View {
    var body: some View {
        Text("Production", bundle: #bundle, comment: "Marks one of a project's production environments.")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(.fill.tertiary, in: .capsule)
    }
}

/// A promotion under way, in a sentence: `Promoting 1.0.0+3 to prod`.
func promotingText(_ promotion: Promotion) -> Text {
    Text(
        "Promoting \(Text(verbatim: promotion.release).monospaced()) to \(promotion.environment)",
        bundle: #bundle,
        comment: "A promotion under way. The variables are a release and an environment."
    )
}

/// Whether a promotion that ended ended well: succeeded. Every other end is what to look into.
extension Promotion {
    var succeeded: Bool {
        state == .succeeded
    }
}

/// The project's delivery, a row for each component: what's in each of its environments, and a
/// promotion under way or a release ready for the next; each opening the component's screen. A
/// component that ships with another follows it, indented.
struct DeliverySection: View {
    let delivery: DeliveryModel

    var body: some View {
        Section {
            if delivery.answer.value == nil {
                AnswerPlaceholder(problem: delivery.answer.problem)
            } else if delivery.components.isEmpty {
                Text(
                    "No components yet. Add one from a terminal: ./cluenori component add",
                    bundle: #bundle,
                    comment: "A project without components. ./cluenori component add is a command, as is."
                )
                .foregroundStyle(.secondary)
            }
            ForEach(delivery.components) { component in
                NavigationLink(value: Route.component(project: delivery.project, component: component.component)) {
                    if let shipsWith = component.shipsWith {
                        PartDeliveryRow(component: component, shipsWith: delivery.name(of: shipsWith))
                    } else {
                        ComponentDeliveryRow(component: component)
                    }
                }
            }
        } header: {
            Text(
                "Delivery", bundle: #bundle, comment: "Section of what release is in each of a project's environments.")
        }
    }
}

/// A component in the project's delivery: its name, each environment with the release there now,
/// and what's happening: a promotion under way, the last one when it failed, or a release ready for the next
/// environment.
struct ComponentDeliveryRow: View {
    let component: ComponentStages
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: component.name)
                .font(.headline)
            if component.stages.isEmpty {
                Text("Hasn't run anywhere yet", bundle: #bundle, comment: "A component no release of which ran.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else if dynamicTypeSize.isAccessibilitySize {
                // Too big for two columns: each environment above its release.
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(component.stages) { stage in
                        VStack(alignment: .leading, spacing: 0) {
                            Text(verbatim: stage.environment)
                                .foregroundStyle(.secondary)
                            CurrentInOverview(current: stage.current)
                        }
                    }
                }
                .font(.subheadline)
            } else {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 3) {
                    ForEach(component.stages) { stage in
                        GridRow {
                            Text(verbatim: stage.environment)
                                .foregroundStyle(.secondary)
                            CurrentInOverview(current: stage.current)
                        }
                    }
                }
                .font(.subheadline)
            }
            VStack(alignment: .leading, spacing: 4) {
                ForEach(component.stages) { stage in
                    if let promotion = stage.promotion {
                        Fact(symbol: promotion.state.symbol, tint: promotion.state.tint) {
                            VStack(alignment: .leading, spacing: 1) {
                                promotingText(promotion)
                                PromotionStateText(state: promotion.state)
                                    .foregroundStyle(promotion.state.tint)
                            }
                        }
                    } else if let failed = stage.failed {
                        Fact(symbol: failed.state.symbol, tint: failed.state.tint) {
                            FailedPromotionText(promotion: failed)
                        }
                    } else if case .promote(let release, _, let to) = stage.next {
                        Fact(symbol: "arrow.up.circle.fill", tint: .accentColor) {
                            Text(
                                "\(Text(verbatim: release).monospaced()) ready for \(to)",
                                bundle: #bundle,
                                comment:
                                    "A release that can be promoted to the next environment. The variables are a release and an environment."
                            )
                        }
                    }
                }
            }
            .font(.subheadline)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// The release in an environment, in the overview: monospaced, or `nothing yet`.
private struct CurrentInOverview: View {
    let current: CurrentRelease?

    var body: some View {
        if let current {
            Text(verbatim: current.summary.release)
                .monospaced()
        } else {
            Text("nothing yet", bundle: #bundle, comment: "No release in an environment yet.")
                .foregroundStyle(.tertiary)
        }
    }
}

/// A component that ships with another, below it: its name, `Ships with notes-api`, and where it
/// ran.
struct PartDeliveryRow: View {
    let component: ComponentStages
    let shipsWith: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: "arrow.turn.down.right")
                .font(.subheadline)
                .foregroundStyle(.tertiary)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: component.name)
                Text(
                    "Ships with \(shipsWith)",
                    bundle: #bundle,
                    comment: "A component deployed by another's deploys. The variable is that component."
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
        }
        .padding(.leading, 4)
        .accessibilityElement(children: .combine)
    }
}

/// How a promotion that didn't succeed ended, in a sentence: `Promoting 1.0.0+3 to prod failed`.
struct FailedPromotionText: View {
    let promotion: Promotion

    var body: some View {
        let release = Text(verbatim: promotion.release).monospaced()
        switch promotion.state {
        case .failed:
            Text(
                "Promoting \(release) to \(promotion.environment) failed",
                bundle: #bundle,
                comment: "A promotion's run or build failed. The variables are a release and an environment."
            )
        case .cancelled:
            Text(
                "Promoting \(release) to \(promotion.environment) was cancelled",
                bundle: #bundle,
                comment: "A promotion's run was cancelled. The variables are a release and an environment."
            )
        case .rejected:
            Text(
                "\(release) was rejected in App Store review",
                bundle: #bundle,
                comment: "App Review rejected a promotion. The variable is a release."
            )
        case .lost:
            Text(
                "Promoting \(release) to \(promotion.environment) wasn't followed to its end: see GitHub",
                bundle: #bundle,
                comment:
                    "A promotion's run or build wasn't found, or didn't end in time. The variables are a release and an environment. GitHub is a name."
            )
        default:
            Text(
                "Promoting \(release) to \(promotion.environment) ended",
                bundle: #bundle,
                comment:
                    "A promotion ended in a state this app doesn't know. The variables are a release and an environment."
            )
        }
    }
}
