import CluenoriClient
import CluenoriScreens
import Foundation
import Synchronization
import Testing

/// The phone's side of alerts, for tests: what it allows until asked, and after.
final class FakeAlertSystem: AlertSystem {
    private let allowed = Mutex(AlertPermission.notAsked)
    private let afterAsking: AlertPermission

    init(afterAsking: AlertPermission) {
        self.afterAsking = afterAsking
    }

    func permission() async -> AlertPermission {
        allowed.withLock { $0 }
    }

    func turnOn() async -> AlertPermission {
        allowed.withLock {
            $0 = afterAsking
            return $0
        }
    }
}

let incidentId = "0199f7a2-6000-7000-8000-000000000001"

/// An alert push's payload, as the deployment sends it.
func alertPayload(level: String, at: String, project: String? = "notes") -> [AnyHashable: Any] {
    var part: [String: Any] = ["level": level, "at": at, "alert": incidentId]
    if let project {
        part["project"] = project
        part["incident"] = incidentId
    }
    return ["aps": ["alert": ["title": "Notes · Down"], "mutable-content": 1], "cluenori": part]
}

let incidentAnswer = #"""
    {"id":"0199f7a2-6000-7000-8000-000000000001","component":"notes-api","subject":"https://notes.example/health",
    "title":"https://notes.example/health is down: HTTP 503","evidence":{"_tag":"down",
    "monitor":"0199f7a2-6000-7000-8000-000000000002","url":"https://notes.example/health","failures":2,
    "problem":"HTTP 503"},"openedAt":"2026-10-21T10:00:00.000Z","acknowledgedAt":"2026-10-21T10:02:00.000Z"}
    """#

struct AlertsTests {
    @Test func `reads an alert push, which rings only while it is less than 10 minutes old`() throws {
        let alert = try #require(PushAlert(payload: alertPayload(level: "alarm", at: "2026-10-21T10:00:00.000Z")))
        let at = try Date("2026-10-21T10:00:00Z", strategy: .iso8601)

        #expect(alert.level == .alarm)
        #expect(alert.incident == PushAlert.Incident(project: "notes", id: incidentId))
        #expect(alert.route == .project("notes"))
        #expect(alert.rings(at: at.addingTimeInterval(9 * 60)))
        #expect(!alert.rings(at: at.addingTimeInterval(11 * 60)))

        let quiet = try #require(PushAlert(payload: alertPayload(level: "quiet", at: "2026-10-21T10:00:00.000Z")))
        #expect(!quiet.rings(at: at))
    }

    @Test func `reads a test alarm, which opens no screen, and no push that isn't an alert`() throws {
        let test = try #require(
            PushAlert(payload: alertPayload(level: "alarm", at: "2026-10-21T10:00:00.000Z", project: nil)))
        #expect(test.incident == nil)
        #expect(test.route == nil)

        #expect(PushAlert(payload: ["aps": ["alert": "Hello"]]) == nil)
        #expect(PushAlert(payload: alertPayload(level: "siren", at: "2026-10-21T10:00:00.000Z")) == nil)
    }

    @Test func `gives the push token to the paired deployment, and to one the phone pairs with later`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("POST /api/phones", 201, pairedAnswer)
        deployment.answer("PUT /api/phones/push", 204)
        let pairing = PairingModel(store: MemoryStore(), details: details, transport: deployment.transport)

        await pairing.registerPush(token: "a1b2", environment: .development)
        #expect(deployment.requests.isEmpty)

        await pairing.open(link)
        #expect(deployment.requests == ["POST /api/phones", "PUT /api/phones/push"])
        #expect(pairing.models?.alerts.isRegistered == true)
    }

    @Test func `unpairs when the deployment refuses the key the token is registered with`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("PUT /api/phones/push", 401, #"{"_tag":"PhoneKeyRejected"}"#)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)

        await pairing.registerPush(token: "a1b2", environment: .production)

        #expect(pairing.state == .unpaired)
        #expect(pairing.problem == .removed)
    }

    @Test func `acknowledges an incident from its alert, and says when the phone can't`() async throws {
        let deployment = FakeDeployment()
        deployment.answer("POST /api/projects/notes/incidents/\(incidentId)/acknowledge", 200, incidentAnswer)
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let incident = PushAlert.Incident(project: "notes", id: incidentId)

        #expect(await pairing.acknowledge(incident) == nil)
        #expect(await pairing.acknowledge(PushAlert.Incident(project: "atlas", id: incidentId)) == .unreadable)
        deployment.setOffline(true)
        #expect(await pairing.acknowledge(incident) == .unreachable)
    }

    @Test func `rings a test alarm, and says why it can't`() async throws {
        let deployment = FakeDeployment()
        let pairing = PairingModel(store: MemoryStore(paired), details: details, transport: deployment.transport)
        let alerts = try #require(pairing.models?.alerts)

        deployment.answer("POST /api/phones/p1/test-alert", 204)
        await alerts.ringTestAlarm()
        #expect(alerts.testAlarm == .sent)

        deployment.answer("POST /api/phones/p1/test-alert", 409, #"{"_tag":"PushNotSetUp"}"#)
        await alerts.ringTestAlarm()
        #expect(alerts.testAlarm == .failed(.notSetUp))

        deployment.answer("POST /api/phones/p1/test-alert", 502, #"{"_tag":"PushRejected","reason":"BadDeviceToken"}"#)
        await alerts.ringTestAlarm()
        #expect(alerts.testAlarm == .failed(.rejected("BadDeviceToken")))

        alerts.dismissTestAlarm()
        #expect(alerts.testAlarm == .idle)
    }

    @Test func `turns alerts on through the phone, which says what it allows`() async throws {
        let pairing = PairingModel(
            store: MemoryStore(paired),
            details: details,
            alertSystem: FakeAlertSystem(afterAsking: .withoutAlarms)
        )
        let alerts = try #require(pairing.models?.alerts)
        #expect(alerts.permission == nil)

        await alerts.refreshPermission()
        #expect(alerts.permission == .notAsked)
        await alerts.turnOn()
        #expect(alerts.permission == .withoutAlarms)
    }
}
