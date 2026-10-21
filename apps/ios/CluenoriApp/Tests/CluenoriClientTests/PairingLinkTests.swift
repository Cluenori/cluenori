import CluenoriClient
import Foundation
import Testing

struct PairingLinkTests {
    private static let code = "Zk3Pq9TzX2mV8wYb4LdR7nHs1cFgJ0uE_abcdefghij"

    @Test func `reads the deployment and the code of a link from the web`() throws {
        let url = try #require(URL(string: "cluenori://pair?url=https%3A%2F%2Fcluenori.example&code=\(Self.code)"))
        let link = try #require(PairingLink(url))
        #expect(link.deployment == URL(string: "https://cluenori.example"))
        #expect(link.code == Self.code)
    }

    @Test(arguments: [
        "https://pair?url=https%3A%2F%2Fcluenori.example&code=\(code)",
        "cluenori://unpair?url=https%3A%2F%2Fcluenori.example&code=\(code)",
        "cluenori://pair?url=javascript%3Aalert(1)&code=\(code)",
        "cluenori://pair?url=https%3A%2F%2Fcluenori.example&code=short",
        "cluenori://pair?url=https%3A%2F%2Fcluenori.example&code=\(code.dropLast())%2B",
        "cluenori://pair?code=\(code)",
    ])
    func `refuses what isn't a pairing link`(_ text: String) throws {
        let url = try #require(URL(string: text))
        #expect(PairingLink(url) == nil)
    }
}

struct PhoneDetailsTests {
    @Test func `says the app's and iOS's versions in its User-Agent`() {
        let details = PhoneDetails(model: "iPhone19,3", systemVersion: "27.1", appVersion: "1.0 (12)")
        #expect(details.userAgent == "Cluenori/1.0 (12) iOS/27.1")
    }
}

struct PairingTests {
    private static let link = PairingLink(
        URL(
            string:
                "cluenori://pair?url=https%3A%2F%2Fcluenori.example&code=Zk3Pq9TzX2mV8wYb4LdR7nHs1cFgJ0uE_abcdefghij")!
    )!
    private static let details = PhoneDetails(model: "iPhone19,3", systemVersion: "27.1", appVersion: "1.0 (12)")

    @Test func `pairs with the code, and keeps the phone's ID and key`() async throws {
        let deployment = FakeDeployment()
        deployment.answer(
            "POST /api/phones", 201,
            #"""
            {"phone":{"id":"019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f53","model":"iPhone19,3","modelName":"iPhone 18 Pro Max",
            "systemVersion":"27.1","appVersion":"1.0 (12)","pairedAt":"2026-10-21T12:15:43.690Z"},
            "key":"cluenori.phone.019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f53.secret"}
            """#)

        let paired = try await PairedDeployment.pair(Self.link, as: Self.details, transport: deployment.transport)

        #expect(
            paired
                == PairedDeployment(
                    deployment: URL(string: "https://cluenori.example")!,
                    phone: "019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f53",
                    key: "cluenori.phone.019a0f2e-5c1e-7d3a-9b2f-4e8a1c6d0f53.secret"
                ))
        let request = try #require(deployment.requests.first)
        #expect(request.value(forHTTPHeaderField: "User-Agent") == "Cluenori/1.0 (12) iOS/27.1")
        #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
        let body = try JSONSerialization.jsonObject(with: try #require(request.httpBody)) as? [String: String]
        #expect(
            body == [
                "code": Self.link.code, "model": "iPhone19,3", "systemVersion": "27.1", "appVersion": "1.0 (12)",
            ])
    }

    @Test func `says when the code was already used`() async {
        let deployment = FakeDeployment()
        deployment.answer("POST /api/phones", 403, #"{"_tag":"PairingCodeRejected"}"#)
        await #expect {
            try await PairedDeployment.pair(Self.link, as: Self.details, transport: deployment.transport)
        } throws: { error in
            guard case .pairingCodeRejected = error as? APIError else { return false }
            return true
        }
    }

    @Test func `calls as the phone, with its key`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("GET /api/projects", 200, #"{"projects":[]}"#)
        let paired = PairedDeployment(deployment: URL(string: "https://cluenori.example")!, phone: "p", key: "k")
        _ = try await paired.api(Self.details, transport: deployment.transport).listProjects()
        #expect(deployment.requests.first?.value(forHTTPHeaderField: "Authorization") == "Bearer k")
    }
}
