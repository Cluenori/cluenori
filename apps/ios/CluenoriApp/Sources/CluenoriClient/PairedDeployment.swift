import Foundation

/// The deployment a phone is paired with: where it is, which phone this is there, and the key the
/// phone calls it with. The key is a credential: keep it in the Keychain, never in logs.
public struct PairedDeployment: Codable, Hashable, Sendable {
    public let deployment: URL
    /// This phone's ID at the deployment.
    public let phone: String
    /// The phone's key: `cluenori.phone.<phone ID>.<secret>`.
    public let key: String

    public init(deployment: URL, phone: String, key: String) {
        self.deployment = deployment
        self.phone = phone
        self.key = key
    }

    /// Pairs this phone with the deployment `link` names, using its code, which is then used up.
    /// Fails with `APIError.pairingCodeRejected` for a code that is wrong, used, or expired, and
    /// `.unreachable` when the deployment doesn't answer.
    @concurrent
    public static func pair(
        _ link: PairingLink,
        as details: PhoneDetails,
        transport: CluenoriAPI.Transport? = nil,
    ) async throws(APIError) -> PairedDeployment {
        let api = CluenoriAPI(baseURL: link.deployment, userAgent: details.userAgent, transport: transport)
        let paired = try await api.pair(
            PairPhone(
                code: link.code,
                model: details.model,
                systemVersion: details.systemVersion,
                appVersion: details.appVersion,
            )
        )
        return PairedDeployment(deployment: link.deployment, phone: paired.phone.id, key: paired.key)
    }

    /// A client of the deployment that calls as this phone.
    public func api(_ details: PhoneDetails, transport: CluenoriAPI.Transport? = nil) -> CluenoriAPI {
        CluenoriAPI(baseURL: deployment, bearerToken: key, userAgent: details.userAgent, transport: transport)
    }
}
