import CluenoriClient
import Foundation
import Observation

/// Whether this phone is paired with a deployment, pairing it by a link from the web, and unpairing
/// it. While paired, it holds the models of the screens that read the deployment, and where the
/// app is among them.
@Observable
public final class PairingModel {
    /// Where pairing is.
    public enum State: Equatable, Sendable {
        case unpaired
        case pairing
        case paired
    }

    /// Why the phone isn't paired, or why unpairing didn't happen.
    public enum Problem: Equatable, Sendable {
        /// The link isn't a pairing link from the web.
        case notAPairingLink
        /// The code is wrong, used, or older than 10 minutes.
        case codeRejected
        /// The deployment removed this phone, or no longer knows its key.
        case removed
        /// The deployment didn't answer.
        case unreachable
        /// The deployment answered in a way this app doesn't understand, such as from a newer version.
        case unreadable
        /// The phone's key couldn't be kept or read in the Keychain.
        case keychain
        /// No passkey was used: the person cancelled, or let the request time out.
        case passkeyNotUsed
        /// The deployment refused the passkey: it doesn't know it, or its answer didn't hold.
        case passkeyRejected
        /// This phone can't use the deployment's passkeys: the app isn't associated with its site,
        /// or it holds none of them.
        case passkeysUnavailable
    }

    /// Why the phone's passkey request gave no passkey, as the app tells it.
    public enum PasskeyRefusal: Error, Sendable {
        /// The person cancelled, or let it time out.
        case cancelled
        /// The phone can't use the site's passkeys.
        case unavailable
    }

    public private(set) var state = State.unpaired
    public private(set) var problem: Problem? = nil
    /// Whether the last pairing link can be tried again: its pairing failed before reaching the
    /// deployment, so its code wasn't used. The first call to a deployment on the local network
    /// fails this way while iOS asks for permission.
    public private(set) var canRetry = false
    /// The paired deployment's host, `cluenori.example`; nil when unpaired.
    public private(set) var host: String? = nil
    /// The paired deployment's screens; nil when unpaired.
    public private(set) var models: DeploymentModels? = nil
    /// Which tab shows, and the screens opened in each.
    public let navigation = Navigation()
    /// The deployment this app's passkeys sign in to, by the site it is built for; nil when it is
    /// built for none, and pairs by links alone.
    public let passkeyDeployment: URL?

    @ObservationIgnored private let store: any PairingStore
    @ObservationIgnored private let details: PhoneDetails
    @ObservationIgnored private let transport: CluenoriAPI.Transport?
    @ObservationIgnored private let cacheDirectory: URL?
    @ObservationIgnored private let alertSystem: (any AlertSystem)?
    @ObservationIgnored private var paired: PairedDeployment? = nil
    @ObservationIgnored private var unsent: URL? = nil
    @ObservationIgnored private var pushToken: RegisterPush? = nil

    /// Starts as the phone was left: paired with the deployment `store` holds, or unpaired.
    /// `details` is what the phone says about itself; `transport` sends requests, URLSession's
    /// unless a test gives its own. What the screens last saw is kept in `cacheDirectory`, if any.
    /// `alertSystem` is the phone's side of alerts; without one, alerts stay off.
    public init(
        store: any PairingStore,
        details: PhoneDetails,
        transport: CluenoriAPI.Transport? = nil,
        cacheDirectory: URL? = nil,
        alertSystem: (any AlertSystem)? = nil,
        passkeyDeployment: URL? = nil
    ) {
        self.store = store
        self.details = details
        self.transport = transport
        self.cacheDirectory = cacheDirectory
        self.alertSystem = alertSystem
        self.passkeyDeployment = passkeyDeployment
        do {
            if let deployment = try store.load() {
                become(deployment)
            }
        } catch {
            problem = .keychain
        }
    }

    /// Opens a link: a screen's, `cluenori://projects/...`, while paired; or a pairing link, which
    /// pairs with the deployment it names in place of any pairing before. When pairing fails, a
    /// phone paired before stays paired, and `problem` says why.
    public func open(_ url: URL) async {
        if let route = Route(url), state == .paired {
            navigation.open(route)
            return
        }
        guard let link = PairingLink(url) else {
            problem = .notAPairingLink
            return
        }
        let before = state
        state = .pairing
        problem = nil
        canRetry = false
        unsent = nil
        do {
            let deployment = try await PairedDeployment.pair(link, as: details, transport: transport)
            do {
                try store.save(deployment)
            } catch {
                // Paired at the deployment, but the key can't be kept: the web lists a phone that
                // can no longer call; removing it there is all that's left to do.
                state = before
                problem = .keychain
                return
            }
            become(deployment)
            await registerPushToken()
        } catch {
            state = before
            switch error {
            case .pairingCodeRejected:
                problem = .codeRejected
            case .unreachable:
                problem = .unreachable
                unsent = url
                canRetry = true
            default:
                problem = .unreadable
            }
        }
    }

    /// Pairs with `passkeyDeployment` by one of its passkeys, which `askForPasskey` asks the person
    /// for with the deployment's options, in place of a pairing link. A phone paired before stays
    /// paired when it fails, and `problem` says why.
    public func signInWithPasskey(
        _ askForPasskey:
            (PublicKeyCredentialRequestOptionsJSON) async throws(PasskeyRefusal) -> AuthenticationResponseJSON
    ) async {
        guard let deployment = passkeyDeployment else { return }
        let before = state
        state = .pairing
        problem = nil
        canRetry = false
        do throws(APIError) {
            let options = try await PairedDeployment.passkeyOptions(at: deployment, as: details, transport: transport)
            let assertion: AuthenticationResponseJSON
            do throws(PasskeyRefusal) {
                assertion = try await askForPasskey(options)
            } catch {
                state = before
                switch error {
                case .cancelled: problem = .passkeyNotUsed
                case .unavailable: problem = .passkeysUnavailable
                }
                return
            }
            let paired = try await PairedDeployment.pair(
                at: deployment, with: assertion, as: details, transport: transport)
            do {
                try store.save(paired)
            } catch {
                state = before
                problem = .keychain
                return
            }
            become(paired)
            await registerPushToken()
        } catch {
            state = before
            switch error {
            case .passkeyRejected: problem = .passkeyRejected
            case .unreachable: problem = .unreachable
            default: problem = .unreadable
            }
        }
    }

    /// Tries the last pairing link again, when `canRetry`.
    public func retry() async {
        guard let unsent else { return }
        await open(unsent)
    }

    /// Removes this phone from its deployment, so its key stops working, and forgets the deployment.
    /// When the deployment doesn't answer, the phone stays paired, and `problem` says why.
    public func unpair() async {
        guard let paired else { return }
        problem = nil
        do {
            try await paired.api(details, transport: transport).removePhone(phone: paired.phone)
            forget(nil)
        } catch .phoneNotFound, .unauthorized {
            // Already removed on the web: nothing is left to remove.
            forget(nil)
        } catch .unreachable {
            problem = .unreachable
        } catch {
            problem = .unreadable
        }
    }

    /// Keeps the push token iOS gave the app, as hex, for the APNs `environment` it belongs to, and
    /// gives it to the paired deployment, and to each one the phone pairs with after.
    public func registerPush(token: String, environment: PushEnvironment) async {
        pushToken = RegisterPush(token: token, environment: environment)
        await registerPushToken()
    }

    /// Acknowledges an incident from an alert, for whoever paired the phone: nil once the deployment
    /// says someone is on it, or why not. Unpaired, the incident is no longer this phone's to tell.
    public func acknowledge(_ incident: PushAlert.Incident) async -> AlertsModel.Problem? {
        guard let models else { return .incidentNotFound }
        return await models.alerts.acknowledge(incident)
    }

    /// Opens the screen an alert is about, while paired.
    public func open(_ alert: PushAlert) {
        if let route = alert.route, state == .paired {
            navigation.open(route)
        }
    }

    private func registerPushToken() async {
        if let pushToken, let models {
            await models.alerts.register(token: pushToken.token, environment: pushToken.environment)
        }
    }

    // The deployment refused the phone's key: it was removed on the web.
    func keyRejected() {
        forget(.removed)
    }

    private func become(_ deployment: PairedDeployment) {
        paired = deployment
        host = deployment.deployment.host()
        let context = AnswerContext(store: store(of: deployment)) { [weak self] in self?.keyRejected() }
        models = DeploymentModels(
            api: deployment.api(details, transport: transport),
            context: context,
            phone: deployment.phone,
            alertSystem: alertSystem
        )
        state = .paired
    }

    // Where a pairing's answers are kept: a folder of its own, so another deployment's never show.
    private func store(of deployment: PairedDeployment) -> AnswerStore {
        AnswerStore(folder: cacheDirectory?.appending(path: "pairing-\(deployment.phone)", directoryHint: .isDirectory))
    }

    private func forget(_ reason: Problem?) {
        do {
            try store.remove()
        } catch {
            problem = .keychain
        }
        if let paired {
            // What a removed phone saw goes with it.
            store(of: paired).removeAll()
        }
        paired = nil
        host = nil
        models = nil
        navigation.path = []
        state = .unpaired
        if let reason {
            problem = reason
        }
    }
}
