import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

extension Product {
    /// The product's name, as its line starts: `Errors`.
    var name: Text {
        switch self {
        case .uptime: Text("Uptime", bundle: #bundle, comment: "A product: open incidents and the monitors.")
        case .errors: Text("Errors", bundle: #bundle, comment: "A product: errors, grouped.")
        case .performance:
            Text("Performance", bundle: #bundle, comment: "A product: operations, their load and their speed.")
        case .releases: Text("Releases", bundle: #bundle, comment: "A product: what runs where, and what's next.")
        case .analytics: Text("Analytics", bundle: #bundle, comment: "A product: how the apps are used.")
        case .logs: Text("Logs", bundle: #bundle, comment: "A product: warnings and errors, to search.")
        }
    }

    /// The same, as a string inside a list of products.
    var nameString: String {
        switch self {
        case .uptime:
            String(localized: "Uptime", bundle: #bundle, comment: "A product: open incidents and the monitors.")
        case .errors: String(localized: "Errors", bundle: #bundle, comment: "A product: errors, grouped.")
        case .performance:
            String(
                localized: "Performance", bundle: #bundle, comment: "A product: operations, their load and their speed."
            )
        case .releases:
            String(localized: "Releases", bundle: #bundle, comment: "A product: what runs where, and what's next.")
        case .analytics: String(localized: "Analytics", bundle: #bundle, comment: "A product: how the apps are used.")
        case .logs: String(localized: "Logs", bundle: #bundle, comment: "A product: warnings and errors, to search.")
        }
    }
}

extension ProductLine.Tone {
    /// Its color: red for what fails now, yellow for what to look at, purple for a release waiting
    /// for a member, mint when steady, gray when quiet or unknown.
    var color: Color {
        switch self {
        case .failure: Palette.red
        case .warning: Palette.yellow
        case .release: Palette.purple
        case .steady: Palette.mint
        case .quiet, .unknown: Palette.secondary
        }
    }
}

/// What a line says, in words: `1 happening now · 1 new`, `GET /api/feed slower`.
struct LineWords: View {
    let line: ProductLine

    var body: some View {
        text
    }

    var text: Text {
        switch line.says {
        case .one(let evidence):
            one(evidence)
        case .incidents(let count, let acknowledged):
            acknowledged == 0
                ? Text(
                    "^[\(count) open incident](inflect: true)", bundle: #bundle, comment: "How many incidents are open."
                )
                : Text(
                    "^[\(count) open incident](inflect: true), \(acknowledged) acknowledged", bundle: #bundle,
                    comment: "How many incidents are open, and how many of them someone is on.")
        case .noIncidents:
            Text("No open incidents", bundle: #bundle, comment: "Uptime's line when no incident is open.")
        case .errors(let now, let new):
            joined(
                [
                    now > 0
                        ? Text("\(now) happening now", bundle: #bundle, comment: "How many errors are happening now.")
                        : nil,
                    new > 0 ? Text("\(new) new", bundle: #bundle, comment: "How many errors are new today.") : nil,
                ].compactMap(\.self)) ?? Text(verbatim: "")
        case .nothingNew:
            Text("Nothing new", bundle: #bundle, comment: "Errors' line when no error is new or happening now.")
        case .slower(let count):
            Text(
                "^[\(count) operation](inflect: true) slower", bundle: #bundle,
                comment: "How many operations got slower than their usual.")
        case .load(let operations, let failed):
            Text(
                "Steady · \(operations, format: .number.notation(.compactName)) operations in 24 hours, \(Double(failed) / Double(max(operations, 1)), format: .percent.precision(.fractionLength(0...1))) failed",
                bundle: #bundle,
                comment:
                    "Performance's line when nothing is slower: the operations of a day, and the share that failed."
            )
        case .releases(let count):
            Text(
                "^[\(count) release](inflect: true) need you", bundle: #bundle,
                comment: "How many releases need a member.")
        case .inProduction(let latest):
            if let latest {
                Text(
                    "\(Text(verbatim: latest.release).monospaced()) of \(latest.component) in production for \(agoText(latest.since))",
                    bundle: #bundle,
                    comment:
                        "The release that reached production last. The variables are a release, a component, and a duration."
                )
            } else {
                Text("Nothing in production yet", bundle: #bundle, comment: "No release reached production.")
            }
        case .people(let daily, let percent):
            people(daily, percent)
        case .quiet:
            quiet
        case .didNotAnswer:
            Text(
                "Unknown: the project didn't answer", bundle: #bundle,
                comment: "A line of a project that didn't answer.")
        case .notSaid:
            Text(
                "Unknown: this deployment doesn't say", bundle: #bundle,
                comment: "A line the deployment is too old to give.")
        }
    }

    // The one thing behind a line, as the line says it.
    private func one(_ evidence: TodayRow.Evidence) -> Text {
        switch evidence {
        case .incident(let title, _, _, let acknowledged):
            acknowledged
                ? Text(
                    "\(Text(verbatim: title)), acknowledged", bundle: #bundle,
                    comment: "An open incident someone is on. The variable is its title.")
                : Text(verbatim: title)
        case .slower(let operation, _, _):
            Text(
                "\(Text(verbatim: operation)) slower", bundle: #bundle,
                comment: "An operation slower than its usual. The variable is the operation.")
        case .silent(let lastDataAt):
            if let lastDataAt {
                Text(
                    "Nothing reported in the last day, last \(agoText(lastDataAt)) ago", bundle: #bundle,
                    comment: "A project that sent nothing in a day. The variable is a duration.")
            } else {
                Text(
                    "Nothing reported in 8 days", bundle: #bundle,
                    comment: "A project that sent nothing in 8 days or more.")
            }
        case .promotion(let release, _, let environment, let state, _):
            PromotionNeedTitle(release: release, environment: environment, state: state).text
        case .error(let title, _, _, _, _, _):
            Text(verbatim: title)
        case .unknown:
            Text("Update the app", bundle: #bundle, comment: "An item's kind, of a kind this app doesn't know.")
        }
    }

    // Daily people, and how they moved against a week before, in whole percent: steady, up or down.
    private func people(_ daily: Int, _ percent: Int?) -> Text {
        let people = Text("^[\(daily) daily person](inflect: true)", bundle: #bundle, comment: "Daily people: DAU.")
        guard let percent else { return people }
        let change = changeText(Double(percent) / 100)
        if percent <= -ProductLine.peopleFall {
            return Text(
                "Down · \(people), \(change) vs last week", bundle: #bundle,
                comment: "Daily people fell a tenth or more against a week before.")
        }
        if percent >= ProductLine.peopleFall {
            return Text(
                "Up · \(people), \(change) vs last week", bundle: #bundle,
                comment: "Daily people rose a tenth or more against a week before.")
        }
        return Text(
            "Steady · \(people), \(change) vs last week", bundle: #bundle,
            comment: "Daily people about the same as a week before.")
    }

    // What a product holds, for its row when it has nothing to say of the project.
    private var quiet: Text {
        switch line.product {
        case .uptime: Text("Open incidents, and the monitors", bundle: #bundle, comment: "What Uptime holds.")
        case .errors: Text("Errors, grouped", bundle: #bundle, comment: "What Errors holds.")
        case .performance:
            Text(
                "Its services haven't reported anything yet", bundle: #bundle,
                comment: "Performance's row before a project's services report.")
        case .releases:
            Text("What's in each environment, and what's next", bundle: #bundle, comment: "What Releases holds.")
        case .analytics:
            Text(
                "Its apps haven't sent anything yet", bundle: #bundle,
                comment: "Analytics' row before a project's apps send.")
        case .logs: Text("Warnings and errors, to search", bundle: #bundle, comment: "What Logs holds.")
        }
    }
}

/// One product's line, as a row: its tone's dot, the product's name over what it says, a line of
/// evidence when `detail` is on and it is about one thing, and `aside`, such as a small chart.
struct ProductLineRow<Aside: View>: View {
    let line: ProductLine
    var detail = false
    @ViewBuilder var aside: Aside

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            BaselineDot(color: line.tone.color, textStyle: .footnote)
            VStack(alignment: .leading, spacing: 3) {
                line.product.name
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(line.tone.isNews ? line.tone.color : Palette.secondary)
                LineWords(line: line)
                    .font(.callout.weight(line.tone.isNews ? .medium : .regular))
                    .foregroundStyle(line.tone.isNews || line.tone == .steady ? Palette.text : Palette.secondary)
                if detail, line.rows.count == 1, let only = line.rows.first {
                    ItemDetail(evidence: only.evidence)
                        .font(.subheadline)
                        .foregroundStyle(Palette.secondary)
                }
            }
            Spacer(minLength: 4)
            aside
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .accessibilityElement(children: .combine)
    }
}

extension ProductLineRow where Aside == EmptyView {
    init(line: ProductLine, detail: Bool = false) {
        self.init(line: line, detail: detail) { EmptyView() }
    }
}

/// The lines with no news, in one quiet row: `Steady: Uptime · Errors · Analytics`, each name opening
/// its product and saying its line to VoiceOver; one under another when they don't fit in a row.
struct SteadyLinesRow: View {
    let lines: [ProductLine]

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            BaselineDot(color: Palette.mint, textStyle: .footnote)
            Text("Steady:", bundle: #bundle, comment: "Before the products with no news about a project.")
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 10) { links }
                VStack(alignment: .leading, spacing: 8) { links }
            }
        }
        .font(.footnote)
        .foregroundStyle(Palette.secondary)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private var links: some View {
        ForEach(lines) { line in
            NavigationLink(value: line.route) {
                line.product.name
                    .foregroundStyle(Palette.text.opacity(0.85))
                    .fixedSize()
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                Text(
                    "\(line.product.name): \(LineWords(line: line).text)", bundle: #bundle,
                    comment: "A product with no news, for VoiceOver: its name and its line."))
        }
    }
}
