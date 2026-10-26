import CluenoriClient
import Foundation
import Observation

/// The deployment's feeds the phone's member sees, by name, each with how many entries arrived in
/// the last 24 hours and 7 days: shown at once from the phone, and asked again. Now and Feeds share
/// it.
@Observable
public final class FeedsModel {
    public let feeds: Answer<FeedList>

    init(api: CluenoriAPI, context: AnswerContext) {
        feeds = Answer(context, .init(key: "feeds") { () async throws(APIError) in try await api.feeds() })
    }

    /// Asks for the feeds again.
    public func load() async {
        await feeds.load()
    }
}

/// One feed, live: what it watches, how many arrived lately and from which projects, and its entries,
/// newest first, 100 at a time. The newest page is kept on the phone and asked again each minute
/// while the screen shows it; older ones load on demand and stay as newer ones arrive.
@Observable
public final class FeedModel {
    public let id: String
    /// The newest page, with the feed's summary.
    public let page: Answer<FeedEntries>
    /// The entries older than the newest page's, as `loadOlder` adds them.
    public private(set) var older: [FeedEntry] = []
    /// Whether there are older entries than those shown.
    public private(set) var hasOlder = false

    /// How often the screen asks for the newest entries: the deployment takes up to a minute to list
    /// one.
    public static let askEvery: Duration = .seconds(60)

    @ObservationIgnored private let api: CluenoriAPI
    @ObservationIgnored private var next: Int? = nil
    @ObservationIgnored private var isLoadingOlder = false

    init(id: String, api: CluenoriAPI, context: AnswerContext) {
        self.id = id
        self.api = api
        page = Answer(
            context, .init(key: "feeds/\(id)") { () async throws(APIError) in try await api.feed(feed: id) })
        next = page.value?.next
        hasOlder = next != nil
    }

    /// The entries shown, newest first: the newest page's, then the older ones added.
    public var entries: [FeedEntry] {
        (page.value?.entries ?? []) + older
    }

    /// Asks for the newest page again. Every entry shown stays: those the newest page no longer
    /// holds join the older ones.
    public func refresh() async {
        let before = page.value?.entries ?? []
        await page.load()
        guard let newest = page.value else { return }
        // Read after the wait: older pages may have loaded meanwhile, and they stay.
        // Not handled: more than 100 entries arriving between two asks leave a gap between the newest
        // page and the entries shown before, until the screen opens again.
        let oldestNewest = newest.entries.last?.id ?? Int.max
        let olderIDs = Set(older.map(\.id))
        let displaced = before.filter { $0.id < oldestNewest && !olderIDs.contains($0.id) }
        older = (displaced + older).filter { $0.id < oldestNewest }
        if older.isEmpty {
            next = newest.next
        }
        hasOlder = next != nil
    }

    /// Adds the next older page, when there is one.
    public func loadOlder() async {
        guard let before = next, !isLoadingOlder else { return }
        isLoadingOlder = true
        defer { isLoadingOlder = false }
        // Not handled: a failure here leaves the older entries out until the list is asked again; the
        // newest page shows its own problem.
        guard let page = try? await api.feed(feed: id, before: String(before)) else { return }
        older += page.entries
        next = page.next
        hasOlder = next != nil
    }
}
