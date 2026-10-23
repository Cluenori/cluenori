import CluenoriClient
import CluenoriScreens
import Foundation
import Synchronization
import Testing

/// A pairing store in memory, which can be told to fail.
final class MemoryStore: PairingStore {
    var saved: PairedDeployment?
    var fails = false

    init(_ saved: PairedDeployment? = nil) {
        self.saved = saved
    }

    func load() throws -> PairedDeployment? {
        if fails { throw CocoaError(.fileReadUnknown) }
        return saved
    }

    func save(_ deployment: PairedDeployment) throws {
        if fails { throw CocoaError(.fileWriteUnknown) }
        saved = deployment
    }

    func remove() throws {
        saved = nil
    }
}

/// A deployment for tests: answers by method and path, fails like a phone offline when told to,
/// and keeps the requests it got.
final class FakeDeployment: Sendable {
    private let answers = Mutex<[String: (Int, String)]>([:])
    private let offline = Mutex(false)
    private let received = Mutex<[String]>([])
    private let receivedURLs = Mutex<[URL]>([])
    private let receivedBodies = Mutex<[(request: String, body: Data)]>([])

    func answer(_ request: String, _ status: Int, _ body: String = "") {
        answers.withLock { $0[request] = (status, body) }
    }

    func setOffline(_ isOffline: Bool) {
        offline.withLock { $0 = isOffline }
    }

    /// Each request, `"DELETE /api/phones/p1"`, in order.
    var requests: [String] { received.withLock { $0 } }

    /// The query of each request to `path`, in order, by parameter: `["release": "1.8.0"]`.
    func queries(_ path: String) -> [[String: String]] {
        receivedURLs.withLock { urls in
            urls.filter { $0.path(percentEncoded: true) == path }.map { url in
                let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
                return Dictionary(items.map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { _, last in last })
            }
        }
    }

    /// The body of each request `request` names, `"POST /api/phones"`, in order.
    func bodies(_ request: String) -> [Data] {
        receivedBodies.withLock { $0.filter { $0.request == request }.map(\.body) }
    }

    var transport: CluenoriAPI.Transport {
        { [self] request in
            let key = "\(request.httpMethod ?? "GET") \(request.url?.path(percentEncoded: true) ?? "")"
            received.withLock { $0.append(key) }
            if let url = request.url {
                receivedURLs.withLock { $0.append(url) }
            }
            if let body = request.httpBody {
                receivedBodies.withLock { $0.append((key, body)) }
            }
            if offline.withLock({ $0 }) {
                throw URLError(.notConnectedToInternet)
            }
            let (status, body) = answers.withLock { $0[key] } ?? (404, #"{"_tag":"RouteNotFound"}"#)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
            return (Data(body.utf8), response)
        }
    }
}

let details = PhoneDetails(model: "iPhone19,3", systemVersion: "27.1", appVersion: "1.0 (12)")
let link = URL(
    string: "cluenori://pair?url=https%3A%2F%2Fcluenori.example&code=Zk3Pq9TzX2mV8wYb4LdR7nHs1cFgJ0uE_abcdefghij")!
let paired = PairedDeployment(deployment: URL(string: "https://cluenori.example")!, phone: "p1", key: "k1")

let pairedAnswer = #"""
    {"phone":{"id":"p2","model":"iPhone19,3","modelName":"iPhone 18 Pro Max","systemVersion":"27.1",
    "appVersion":"1.0 (12)","pairedAt":"2026-10-21T12:15:43.690Z"},"key":"k2"}
    """#

struct PairingModelTests {
    @Test func `pairs by a link, keeps the key, and shows the deployment's projects`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("POST /api/phones", 201, pairedAnswer)
        deployment.answer("GET /api/today", 200, todayAnswer)
        let store = MemoryStore()
        let pairing = PairingModel(store: store, details: details, transport: deployment.transport)
        #expect(pairing.state == .unpaired)

        await pairing.open(link)

        #expect(pairing.state == .paired)
        #expect(pairing.host == "cluenori.example")
        #expect(store.saved?.key == "k2")
        let today = try #require(pairing.models?.today)
        await today.load()
        #expect(today.projects?.map(\.name) == ["Notes", "Atlas", "Quiet"])
    }

    @Test func `starts paired with the deployment kept from before`() {
        let pairing = PairingModel(store: MemoryStore(paired), details: details)
        #expect(pairing.state == .paired)
        #expect(pairing.models?.today != nil)
    }

    @Test func `says why a code was refused, and keeps a pairing from before`() async {
        let deployment = FakeDeployment()
        deployment.answer("POST /api/phones", 403, #"{"_tag":"PairingCodeRejected"}"#)
        let unpaired = PairingModel(store: MemoryStore(), details: details, transport: deployment.transport)
        await unpaired.open(link)
        #expect(unpaired.state == .unpaired)
        #expect(unpaired.problem == .codeRejected)

        let store = MemoryStore(paired)
        let stillPaired = PairingModel(store: store, details: details, transport: deployment.transport)
        await stillPaired.open(link)
        #expect(stillPaired.state == .paired)
        #expect(stillPaired.problem == .codeRejected)
        #expect(store.saved == paired)
    }

    @Test func `tries the same link again after the deployment didn't answer`() async {
        let deployment = FakeDeployment()
        deployment.setOffline(true)
        let pairing = PairingModel(store: MemoryStore(), details: details, transport: deployment.transport)
        await pairing.open(link)
        #expect(pairing.problem == .unreachable)
        #expect(pairing.canRetry)

        deployment.setOffline(false)
        deployment.answer("POST /api/phones", 201, pairedAnswer)
        await pairing.retry()

        #expect(pairing.state == .paired)
        #expect(pairing.canRetry == false)
        #expect(deployment.requests == ["POST /api/phones", "POST /api/phones"])
    }

    @Test func `can't retry a code the deployment refused`() async {
        let deployment = FakeDeployment()
        deployment.answer("POST /api/phones", 403, #"{"_tag":"PairingCodeRejected"}"#)
        let pairing = PairingModel(store: MemoryStore(), details: details, transport: deployment.transport)
        await pairing.open(link)
        #expect(pairing.canRetry == false)
    }

    @Test func `says when a link isn't a pairing link, and asks nothing`() async throws {
        let deployment = FakeDeployment()
        let pairing = PairingModel(store: MemoryStore(), details: details, transport: deployment.transport)
        await pairing.open(try #require(URL(string: "https://cluenori.example/phones")))
        #expect(pairing.problem == .notAPairingLink)
        #expect(deployment.requests.isEmpty)
    }

    @Test func `unpairs when the deployment refuses the phone's key`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/today", 401, #"{"_tag":"Unauthorized","message":"Pair the phone again."}"#)
        let store = MemoryStore(paired)
        let pairing = PairingModel(store: store, details: details, transport: deployment.transport)

        try await #require(pairing.models?.today).load()

        #expect(pairing.state == .unpaired)
        #expect(pairing.problem == .removed)
        #expect(store.saved == nil)
    }

    @Test func `keeps showing the projects when the phone goes offline`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/today", 200, todayAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let today = try #require(pairing.models?.today)
        await today.load()

        deployment.setOffline(true)
        await today.load()

        #expect(today.projects?.count == 3)
        #expect(today.problem == .unreachable)
        #expect(today.isLoading == false)
    }

    @Test func `unpairing removes the phone from its deployment, then forgets it`() async {
        let deployment = FakeDeployment()
        deployment.answer("DELETE /api/phones/p1", 204)
        let store = MemoryStore(paired)
        let pairing = PairingModel(store: store, details: details, transport: deployment.transport)

        await pairing.unpair()

        #expect(deployment.requests == ["DELETE /api/phones/p1"])
        #expect(pairing.state == .unpaired)
        #expect(pairing.problem == nil)
        #expect(store.saved == nil)
    }

    @Test func `stays paired when unpairing can't reach the deployment`() async {
        let deployment = FakeDeployment()
        deployment.setOffline(true)
        let store = MemoryStore(paired)
        let pairing = PairingModel(store: store, details: details, transport: deployment.transport)

        await pairing.unpair()

        #expect(pairing.state == .paired)
        #expect(pairing.problem == .unreachable)
        #expect(store.saved == paired)
    }

    @Test func `says when the Keychain can't be read`() {
        let store = MemoryStore(paired)
        store.fails = true
        let pairing = PairingModel(store: store, details: details)
        #expect(pairing.state == .unpaired)
        #expect(pairing.problem == .keychain)
    }
}
