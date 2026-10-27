import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// A project's screen, in production: what its lines come to, then a row for each product, the most
/// urgent first, with what it says of the project and the things behind it, each leading in; the
/// products with nothing to say last, still a way in. All of it Today's, which Now asked too, and what
/// runs where, for Releases.
struct ProjectScreen: View {
    let key: String
    let today: TodayModel
    let delivery: DeliveryModel
    let name: String

    var body: some View {
        let project = today.project(key)
        PanelScreen(spacing: 24) {
            if let project {
                ProductsSection(project: project, delivery: delivery.overview)
            } else {
                AnswerPlaceholder(problem: today.rows == nil ? today.problem : .missing)
            }
        }
        .navigationTitle(name)
        .navigationSubtitle(ifAny: project.map { ProjectSummary(project: $0).text })
        .refreshable {
            async let now: Void = today.load()
            async let releases: Void = delivery.load()
            _ = await (now, releases)
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
        .readyMark(receivedAt: today.receivedAt)
    }
}

/// Below a project's title: which of its products need you, or that none does.
struct ProjectSummary {
    let project: ProjectNow

    var text: Text {
        let news = ProductLine.lines(of: project).filter(\.tone.isNews)
        if !project.answered {
            return Text(
                "Didn't answer: what needs you here is unknown", bundle: #bundle,
                comment: "Below a project's title, when it didn't answer.")
        }
        if news.isEmpty {
            return Text("Nothing needs you here", bundle: #bundle, comment: "Below a project's title.")
        }
        let names = news.map(\.product.nameString).formatted(.list(type: .and))
        return news.count == 1
            ? Text(
                "\(names) needs you", bundle: #bundle,
                comment: "Below a project's title. The variable is its one product with news.")
            : Text(
                "\(names) need you", bundle: #bundle,
                comment: "Below a project's title. The variable is its products with news, as a list.")
    }
}

/// Every product of a project, a row each, the most urgent first, opening the product; under a line
/// with things behind it, each of them, opening it.
struct ProductsSection: View {
    let project: ProjectNow
    /// Nil until the delivery arrives.
    let delivery: DeliveryOverview?
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let rows = ProductLine.rows(of: project, delivery: delivery)
        VStack(alignment: .leading, spacing: 0) {
            PanelTitle(
                title: Text("Products", bundle: #bundle, comment: "Title of a project's products."),
                trailing: Text("In production", bundle: #bundle, comment: "What a project's products cover."))
            Panel {
                ForEach(rows) { line in
                    if line.id != rows.first?.id {
                        PanelDivider()
                    }
                    NavigationLink(value: line.route) {
                        ProductLineRow(line: line) {
                            if line.product == .performance, let hours = project.pulse?.hours, !hours.isEmpty,
                                !dynamicTypeSize.isAccessibilitySize
                            {
                                PulseSpark(hours: hours)
                            }
                        }
                    }
                    .buttonStyle(PanelRowStyle())
                    // What the line is about, each thing its own row: the line itself opens the product.
                    if !line.rows.isEmpty {
                        ForEach(line.rows) { row in
                            if let route = row.route {
                                NavigationLink(value: route) {
                                    NeedsYouRow(project: "", evidence: row.evidence, kind: row.kind)
                                        .padding(.leading, 20)
                                }
                                .buttonStyle(PanelRowStyle())
                            }
                        }
                    }
                }
            }
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
