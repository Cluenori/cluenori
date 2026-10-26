import CluenoriClient
import CluenoriScreens
import Foundation
import Testing

/// A deployment that answers the feed's first ask and older pages at once, and holds every later
/// ask for the newest page until `finish`.
actor HeldFeedDeployment {
    private var asked = false
    private var held: (CheckedContinuation<(Data, URLResponse), any Error>, URLRequest)?

    func respond(_ request: URLRequest) async throws -> (Data, URLResponse) {
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        if query.contains(where: { $0.name == "before" }) {
            return Self.reply(feedAnswer(ids: 1...100, next: nil), request)
        }
        if !asked {
            asked = true
            return Self.reply(feedAnswer(ids: 101...200, next: 101), request)
        }
        return try await withCheckedThrowingContinuation { held = ($0, request) }
    }

    var isHolding: Bool { held != nil }

    /// Answers the held ask: two more entries arrived.
    func finish() {
        guard let (continuation, request) = held else { return }
        continuation.resume(returning: Self.reply(feedAnswer(ids: 103...202, next: 103), request))
        held = nil
    }

    private static func reply(_ body: String, _ request: URLRequest) -> (Data, URLResponse) {
        (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}

nonisolated let feedId = "0199f7a2-8000-7000-8000-000000000001"

/// A page of the Registrations feed: entries `ids`, newest first, and `next` when there are older.
nonisolated func feedAnswer(ids: ClosedRange<Int>, next: Int?) -> String {
    let entries = ids.reversed().map { id in
        #"{"id":\#(id),"project":"notes","event":"user.registered","at":"2026-10-21T12:00:00.000Z","component":"notes-ios","environment":"production","release":"2.4.0+12","country":"DE"}"#
    }
    let summary =
        #"{"feed":{"id":"\#(feedId)","name":"Registrations","level":"timeSensitive","sources":[{"project":"notes","event":"user.registered"}]},"lastDay":3,"lastWeek":9,"byProject":[{"project":"notes","lastWeek":9}]}"#
    return
        #"{"summary":\#(summary),"entries":[\#(entries.joined(separator: ","))]\#(next.map { ",\"next\":\($0)" } ?? "")}"#
}

struct FeedsTests {
    @Test func `opens a feed's alert on the feed, without ringing`() throws {
        let payload: [AnyHashable: Any] = [
            "aps": ["alert": ["title": "Notes · Registrations"], "mutable-content": 1],
            "cluenori": [
                "level": "timeSensitive", "at": "2026-10-21T10:00:00.000Z",
                "alert": "0199f7a2-8000-7000-8000-000000000029", "feed": feedId,
            ],
        ]
        let alert = try #require(PushAlert(payload: payload))
        #expect(alert.route == .feed(id: feedId))
        #expect(alert.incident == nil)
        #expect(!alert.rings(at: try Date("2026-10-21T10:00:00Z", strategy: .iso8601)))
        #expect(Route(try #require(URL(string: "cluenori://feeds/\(feedId)"))) == .feed(id: feedId))
        #expect(Route.feed(id: feedId).chain == [.feeds, .feed(id: feedId)])
    }

    @Test func `keeps every entry shown as newer ones arrive, older pages included, each once`() async throws {
        let deployment = FakeDeployment()
        let feed = try pairedModels(deployment).feed(feedId)
        deployment.answer("GET /api/feeds/\(feedId)", 200, feedAnswer(ids: 101...200, next: 101))
        await feed.refresh()
        deployment.answer("GET /api/feeds/\(feedId)", 200, feedAnswer(ids: 1...100, next: nil))
        await feed.loadOlder()
        #expect(feed.entries.map(\.id) == Array((1...200).reversed()))
        #expect(!feed.hasOlder)

        // Two arrive: the newest page moves on by two, and the two it no longer holds stay shown.
        deployment.answer("GET /api/feeds/\(feedId)", 200, feedAnswer(ids: 103...202, next: 103))
        await feed.refresh()
        #expect(feed.entries.map(\.id) == Array((1...202).reversed()))
        #expect(!feed.hasOlder)
        #expect(feed.page.value?.summary.lastDay == 3)
    }

    @Test func `keeps an older page that loads while the newest is asked again`() async throws {
        let deployment = HeldFeedDeployment()
        let pairing = PairingModel(
            store: MemoryStore(paired), details: details,
            transport: { request in try await deployment.respond(request) })
        let feed = try #require(pairing.models?.feed(feedId))
        await feed.refresh()
        let refreshing = Task { await feed.refresh() }
        while !(await deployment.isHolding) { await Task.yield() }
        await feed.loadOlder()
        await deployment.finish()
        await refreshing.value
        #expect(feed.entries.map(\.id) == Array((1...202).reversed()))
        #expect(!feed.hasOlder)
    }
}
