import CluenoriClient
import Foundation
import Observation

/// What the phone allows alerts to do, as the app finds it: the system's notification and alarm
/// permissions, which only the app can ask about.
public enum AlertPermission: Equatable, Sendable {
    /// Not asked yet: turning alerts on asks.
    case notAsked
    /// Notifications and alarms are allowed.
    case allowed
    /// Notifications are allowed, alarms not: Down and Failing come as time-sensitive notifications.
    case withoutAlarms
    /// Notifications are off, in Settings.
    case denied
}

/// The phone's side of alerts: its permissions, and registering for pushes. The app provides it;
/// tests give their own.
public protocol AlertSystem: Sendable {
    /// What the phone allows now.
    func permission() async -> AlertPermission
    /// Asks for what isn't allowed yet, and registers the app for pushes: what the phone allows then.
    func turnOn() async -> AlertPermission
}

/// Alerts on this phone from the paired deployment: whether the phone allows them, its push token
/// registered with the deployment, acknowledging an incident from one, and a test alarm.
@Observable
public final class AlertsModel {
    /// Why registering, acknowledging, or a test alarm didn't happen.
    public enum Problem: Equatable, Sendable {
        /// The deployment didn't answer.
        case unreachable
        /// The deployment has no APNs key yet: `./cluenori push setup` gives it one.
        case notSetUp
        /// The deployment has no push token for this phone yet.
        case noPushToken
        /// APNs refused the push, for Apple's reason, such as `BadDeviceToken`.
        case rejected(String)
        /// APNs didn't take the push now; it may later.
        case apnsUnavailable
        /// The incident is gone: its project or the incident itself.
        case incidentNotFound
        /// The deployment answered in a way this app doesn't understand.
        case unreadable
    }

    /// Where the last test alarm is.
    public enum TestAlarm: Equatable, Sendable {
        case idle
        case sending
        /// APNs took it: the phone rings within seconds.
        case sent
        case failed(Problem)
    }

    /// Nil until the app has looked.
    public private(set) var permission: AlertPermission? = nil
    /// Whether the deployment has this phone's push token, as of the last registration.
    public private(set) var isRegistered = false
    public private(set) var registrationProblem: Problem? = nil
    public private(set) var testAlarm = TestAlarm.idle

    @ObservationIgnored private let api: CluenoriAPI
    @ObservationIgnored private let phone: String
    @ObservationIgnored private let system: (any AlertSystem)?
    @ObservationIgnored private let keyRejected: () -> Void

    init(api: CluenoriAPI, phone: String, system: (any AlertSystem)?, keyRejected: @escaping () -> Void) {
        self.api = api
        self.phone = phone
        self.system = system
        self.keyRejected = keyRejected
    }

    /// Looks at what the phone allows now, as when the app comes to the front.
    public func refreshPermission() async {
        permission = await system?.permission()
    }

    /// Asks the phone for what alerts need, and registers for pushes.
    public func turnOn() async {
        permission = await system?.turnOn()
    }

    /// Gives the deployment the push token iOS gave the app, for the APNs `environment` it belongs to.
    func register(token: String, environment: PushEnvironment) async {
        do {
            try await api.registerPush(RegisterPush(token: token, environment: environment))
            isRegistered = true
            registrationProblem = nil
        } catch .phoneKeyRejected, .unauthorized {
            keyRejected()
        } catch {
            registrationProblem = Self.problem(error)
        }
    }

    /// Acknowledges an incident, for whoever paired the phone: nil once the deployment says someone
    /// is on it, or why not.
    func acknowledge(_ incident: PushAlert.Incident) async -> Problem? {
        do {
            _ = try await api.acknowledge(project: incident.project, incident: incident.id)
            return nil
        } catch .unauthorized {
            keyRejected()
            return .unreadable
        } catch {
            return Self.problem(error)
        }
    }

    /// Rings this phone with a test alarm, through the deployment and APNs.
    public func ringTestAlarm() async {
        testAlarm = .sending
        do {
            try await api.testAlert(phone: phone)
            testAlarm = .sent
        } catch .unauthorized {
            keyRejected()
            testAlarm = .idle
        } catch {
            testAlarm = .failed(Self.problem(error))
        }
    }

    /// Puts the test alarm's result away, once shown.
    public func dismissTestAlarm() {
        testAlarm = .idle
    }

    private static func problem(_ error: APIError) -> Problem {
        switch error {
        case .unreachable: .unreachable
        case .pushNotSetUp: .notSetUp
        case .noPushToken: .noPushToken
        case .pushRejected(let rejected): .rejected(rejected.reason)
        case .pushUnavailable: .apnsUnavailable
        case .projectNotFound, .incidentNotFound: .incidentNotFound
        default: .unreadable
        }
    }
}
