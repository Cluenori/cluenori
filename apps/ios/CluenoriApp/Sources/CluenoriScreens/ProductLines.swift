import CluenoriClient
import Foundation

/// The products a project's lines are of, in the order a project's screen lists those with no news.
public enum Product: CaseIterable, Hashable, Sendable {
    case uptime
    case errors
    case performance
    case releases
    case analytics
    case logs

    /// The product's own screen of a project: where its line leads when it isn't about one thing.
    public func route(of project: String) -> Route {
        switch self {
        case .uptime: .incidents(project: project)
        case .errors: .errors(of: .project(project))
        case .performance: .operations(of: .project(project))
        case .releases: .delivery(project: project)
        case .analytics: .analytics(AnalyticsRef(project: project))
        case .logs: .logs(of: .project(project))
        }
    }
}

/// One product's line about one project, for Now and the project's screen (Experience, rule 1;
/// Foundation, "Its line for Now and the project"): how it reads, what it says as data, which each
/// view says in words, where it leads, and Today's items behind it. The web's
/// `apps/dashboard/src/product-lines.ts` declares the same lines by the same rules.
public struct ProductLine: Identifiable, Equatable, Sendable {
    /// How a line reads: red for what fails now, yellow for what to look at, purple for a release
    /// waiting for a member; steady when the product has no news; quiet when it has nothing to say of
    /// the project; unknown when the project didn't answer, or the deployment doesn't say.
    public enum Tone: Equatable, Sendable {
        case failure
        case warning
        case release
        case steady
        case quiet
        case unknown

        /// Whether a line in it has news.
        public var isNews: Bool {
            self == .failure || self == .warning || self == .release
        }
    }

    /// What a line says, as data.
    public enum Says: Equatable, Sendable {
        /// The one thing behind it, as its row says it.
        case one(TodayRow.Evidence)
        /// Several open incidents, some acknowledged.
        case incidents(count: Int, acknowledged: Int)
        case noIncidents
        /// Errors happening now, and those new in the last day and not happening now.
        case errors(now: Int, new: Int)
        case nothingNew
        /// Several operations slower than their usual.
        case slower(count: Int)
        /// The last 24 hours' operations, and how many failed.
        case load(operations: Int, failed: Int)
        /// Several releases that need a member.
        case releases(count: Int)
        /// The release that reached production last; nil when none has.
        case inProduction(DeliveryOverview.Latest?)
        /// Daily people on the latest whole UTC day, and how they moved against a week before, in
        /// signed whole percent, when it can be said.
        case people(daily: Int, percent: Int?)
        /// Nothing to say of the project: what the product holds.
        case quiet
        /// The project didn't answer.
        case didNotAnswer
        /// The deployment doesn't say, as one older than pulses.
        case notSaid
    }

    public let product: Product
    public let tone: Tone
    public let says: Says
    /// The one thing it is about, else the product's screen of the project.
    public let route: Route
    /// Today's items behind it, the most urgent first; none for a line without news.
    public let rows: [TodayRow]

    public var id: Product {
        product
    }

    /// Daily people falling this many whole percent against a week before is worth a look; rising
    /// as much is said as "Up", without asking anything of the founder.
    public static let peopleFall = 10

    /// How `now` moved against `before`, in signed whole percent, half away from zero, from the
    /// counts themselves, as the web rounds it: 181 against 200 is −10. Nil when there is no
    /// `before`, or it had no one.
    static func wholePercent(_ now: Int, against before: Int?) -> Int? {
        guard let before, before > 0 else { return nil }
        return Int((Double(100 * (now - before)) / Double(before)).rounded(.toNearestOrAwayFromZero))
    }

    /// Each product's line about `project`, from Today, the most urgent first: those with items in
    /// Today's order of their first, then the rest by tone and product. A product with nothing to say
    /// has no line, and a project that didn't answer has none. `delivery`, on the project's screen,
    /// gives Releases a line when no release needs a member.
    public static func lines(of project: ProjectNow, delivery: DeliveryOverview? = nil) -> [ProductLine] {
        guard project.answered else { return [] }
        let key = project.key
        var lines: [ProductLine] = []
        func add(_ product: Product, _ tone: Tone, _ says: Says, _ rows: [TodayRow] = []) {
            // A line about one thing leads to it, unless that is the project itself.
            var route = product.route(of: key)
            if rows.count == 1, let only = rows.first?.route, only != .project(key) {
                route = only
            }
            lines.append(ProductLine(product: product, tone: tone, says: says, route: route, rows: rows))
        }

        let incidents = project.rows.filter { if case .incident = $0.kind { true } else { false } }
        if let first = incidents.first {
            let acknowledged = incidents.filter { $0.kind == .incident(acknowledged: true) }.count
            add(
                .uptime, tone(of: first),
                incidents.count == 1
                    ? .one(first.evidence) : .incidents(count: incidents.count, acknowledged: acknowledged),
                incidents)
        } else {
            add(.uptime, .steady, .noIncidents)
        }

        let errors = project.rows.filter { $0.kind == .error }
        if let first = errors.first {
            let now = errors.filter { if case .error(_, _, _, _, _, true) = $0.evidence { true } else { false } }.count
            let new = errors.filter { if case .error(_, _, _, _, true, false) = $0.evidence { true } else { false } }
                .count
            add(.errors, tone(of: first), .errors(now: now, new: new), errors)
        } else {
            add(.errors, .steady, .nothingNew)
        }

        let silent = project.rows.filter { $0.kind == .silent }
        let slower = project.rows.filter { $0.kind == .slower }
        let quiet = project.rows.filter { $0.kind == .quiet }
        if let first = silent.first {
            add(.performance, .warning, .one(first.evidence), silent)
        } else if let first = slower.first {
            add(.performance, .warning, slower.count == 1 ? .one(first.evidence) : .slower(count: slower.count), slower)
        } else if let first = quiet.first {
            // A guess says less than what is measured, so it speaks only when nothing slower does.
            add(.performance, .warning, .one(first.evidence), quiet)
        } else if let pulse = project.pulse, !pulse.hours.isEmpty {
            add(.performance, .steady, .load(operations: pulse.operations, failed: pulse.failed))
        }

        let promotions = project.rows.filter { $0.kind == .promotion }
        if let first = promotions.first {
            add(
                .releases, tone(of: first),
                promotions.count == 1 ? .one(first.evidence) : .releases(count: promotions.count), promotions)
        } else if let delivery {
            add(.releases, .steady, .inProduction(delivery.latestInProduction))
        }

        if let people = project.pulse?.people {
            let percent = wholePercent(people.daily, against: people.dailyWeekBefore)
            add(
                .analytics, (percent ?? 0) <= -peopleFall ? .warning : .steady,
                .people(daily: people.daily, percent: percent))
        }

        let order = Dictionary(
            project.rows.enumerated().map { ($0.element.id, $0.offset) }, uniquingKeysWith: { first, _ in first })
        return lines.sorted { left, right in
            let leftFirst = left.rows.first.flatMap { order[$0.id] } ?? .max
            let rightFirst = right.rows.first.flatMap { order[$0.id] } ?? .max
            if leftFirst != rightFirst { return leftFirst < rightFirst }
            if left.tone.rank != right.tone.rank { return left.tone.rank < right.tone.rank }
            return left.product.rank < right.product.rank
        }
    }

    /// The projects as Now lists them: those with news from Today's items first, in the order Today
    /// gave them; then those with news from the pulse alone, such as fewer people; then the rest,
    /// each in the order they came in.
    public static func newsFirst(_ projects: [ProjectNow]) -> [ProjectNow] {
        func kind(_ project: ProjectNow) -> Int {
            guard lines(of: project).contains(where: \.tone.isNews) else { return 2 }
            return project.rows.isEmpty ? 1 : 0
        }
        return projects.enumerated()
            .sorted { (kind($0.element), $0.offset) < (kind($1.element), $1.offset) }
            .map(\.element)
    }

    /// Every product's row on the project's screen: its line, as `lines(of:delivery:)` orders them;
    /// then each product with nothing to say, quiet, in the products' order, leading to its screen.
    /// When the project didn't answer, what Today would say is unknown, and Releases still says what
    /// is in production.
    public static func rows(of project: ProjectNow, delivery: DeliveryOverview?) -> [ProductLine] {
        var lines = lines(of: project, delivery: delivery)
        if !project.answered, let delivery {
            lines = [
                ProductLine(
                    product: .releases, tone: .steady, says: .inProduction(delivery.latestInProduction),
                    route: Product.releases.route(of: project.key), rows: [])
            ]
        }
        let said = Set(lines.map(\.product))
        return lines
            + Product.allCases.filter { !said.contains($0) }.map { product in
                let (tone, says): (Tone, Says) =
                    if product != .logs && !project.answered {
                        (.unknown, .didNotAnswer)
                    } else if project.pulse == nil && (product == .analytics || product == .performance) {
                        (.unknown, .notSaid)
                    } else {
                        (.quiet, .quiet)
                    }
                return ProductLine(
                    product: product, tone: tone, says: says, route: product.route(of: project.key), rows: [])
            }
    }

    // How one of Today's items reads: an incident no one is on, an error happening now, and a
    // promotion that ended without its release getting there fail; a release waiting for a member is
    // a release's; the rest are to look at.
    private static func tone(of row: TodayRow) -> Tone {
        switch row.evidence {
        case .incident(_, _, _, let acknowledged): acknowledged ? .warning : .failure
        case .error(_, _, _, _, _, let ongoing): ongoing ? .failure : .warning
        case .promotion(_, _, _, let state, _): state == .approved || state == .waiting ? .release : .failure
        case .slower, .quiet, .silent, .unknown: .warning
        }
    }
}

extension Product {
    fileprivate var rank: Int {
        Self.allCases.firstIndex(of: self) ?? 0
    }
}

extension ProductLine.Tone {
    fileprivate var rank: Int {
        switch self {
        case .failure: 0
        case .warning: 1
        case .release: 2
        case .steady: 3
        case .quiet: 4
        case .unknown: 5
        }
    }
}
