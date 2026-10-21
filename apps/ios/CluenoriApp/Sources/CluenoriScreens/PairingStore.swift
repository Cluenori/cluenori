import CluenoriClient

/// Where the deployment this phone is paired with is kept between launches; the app keeps it in the
/// Keychain. Each method fails when the store can't be read or written.
public protocol PairingStore {
    /// The paired deployment, or nil when the phone isn't paired.
    func load() throws -> PairedDeployment?
    /// Keeps `deployment`, replacing any other.
    func save(_ deployment: PairedDeployment) throws
    /// Forgets the paired deployment, if there is one.
    func remove() throws
}
