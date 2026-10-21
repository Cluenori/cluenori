/// What a phone says about itself when it pairs, and on every call in its User-Agent.
public struct PhoneDetails: Hashable, Sendable {
    /// Apple's identifier of its model: `iPhone19,3`.
    public let model: String
    /// Its iOS version: `27.1`.
    public let systemVersion: String
    /// The app's version and build: `1.0 (12)`.
    public let appVersion: String

    public init(model: String, systemVersion: String, appVersion: String) {
        self.model = model
        self.systemVersion = systemVersion
        self.appVersion = appVersion
    }

    /// The User-Agent the deployment keeps a phone's versions from: `Cluenori/1.0 (12) iOS/27.1`.
    public var userAgent: String { "Cluenori/\(appVersion) iOS/\(systemVersion)" }
}
