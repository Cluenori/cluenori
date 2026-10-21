import CluenoriClient
import CluenoriScreens
import Foundation
import Testing

let passkeyOptionsAnswer = #"""
    {"challenge":"q3W8mYpZf1o7oG2bTnS0xR4kL9vC6aJ2eH5dU8iN1wE","rpId":"cluenori.example","timeout":300000,
    "userVerification":"required","allowCredentials":[]}
    """#

/// What the phone's passkey request answers, as the app builds it.
let answeredPasskey = PasskeyAssertion(
    id: "c29tZS1rZXk",
    type: "public-key",
    response: PasskeySignature(
        clientDataJSON: "e30", authenticatorData: "AAAA", signature: "MEUC", userHandle: "bWVtYmVy")
)

struct PasskeyPairingTests {
    @Test func `pairs with the deployment it is built for by a passkey, in place of a link`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("POST /api/sign-in/passkey/options", 200, passkeyOptionsAnswer)
        deployment.answer("POST /api/phones/passkey", 201, pairedAnswer)
        let store = MemoryStore()
        let pairing = PairingModel(
            store: store, details: details, transport: deployment.transport,
            passkeyDeployment: URL(string: "https://cluenori.example")!)

        var asked: PasskeyRequestOptions? = nil
        await pairing.signInWithPasskey { options throws(PairingModel.PasskeyRefusal) in
            asked = options
            return answeredPasskey
        }

        #expect(asked?.rpId == "cluenori.example")
        #expect(pairing.state == .paired)
        #expect(pairing.host == "cluenori.example")
        #expect(store.saved?.phone == "p2")
        #expect(deployment.requests == ["POST /api/sign-in/passkey/options", "POST /api/phones/passkey"])
    }

    @Test func `stays as it was when no passkey is used, or the deployment refuses it`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("POST /api/sign-in/passkey/options", 200, passkeyOptionsAnswer)
        deployment.answer("POST /api/phones/passkey", 401, #"{"_tag":"PasskeyRejected"}"#)
        let pairing = PairingModel(
            store: MemoryStore(), details: details, transport: deployment.transport,
            passkeyDeployment: URL(string: "https://cluenori.example")!)

        await pairing.signInWithPasskey { _ throws(PairingModel.PasskeyRefusal) in throw .cancelled }
        #expect(pairing.state == .unpaired)
        #expect(pairing.problem == .passkeyNotUsed)
        #expect(!deployment.requests.contains("POST /api/phones/passkey"))

        await pairing.signInWithPasskey { _ throws(PairingModel.PasskeyRefusal) in throw .unavailable }
        #expect(pairing.problem == .passkeysUnavailable)

        await pairing.signInWithPasskey { _ throws(PairingModel.PasskeyRefusal) in answeredPasskey }
        #expect(pairing.state == .unpaired)
        #expect(pairing.problem == .passkeyRejected)
    }

    @Test func `offers no passkey for an app built for no deployment`() {
        let pairing = PairingModel(store: MemoryStore(), details: details)
        #expect(pairing.passkeyDeployment == nil)
    }
}
