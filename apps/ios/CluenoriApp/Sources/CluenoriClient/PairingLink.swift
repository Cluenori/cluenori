import Foundation

/// A pairing link from the web, which a phone opens to pair:
/// `cluenori://pair?url=<deployment>&code=<pairing code>`. Its code is good once, for 10 minutes.
public struct PairingLink: Hashable, Sendable {
    /// Where the deployment is, as the web reached it: `https://cluenori.example`.
    public let deployment: URL
    /// The pairing code: 43 characters of base64url.
    public let code: String

    /// The link `url` holds, or nil when it isn't one: another scheme or action, a deployment that
    /// isn't an http or https address, or a code of another shape.
    public init?(_ url: URL) {
        guard url.scheme == "cluenori", url.host() == "pair",
            let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
            let address = items.first(where: { $0.name == "url" })?.value,
            let deployment = URL(string: address), deployment.scheme == "https" || deployment.scheme == "http",
            deployment.host() != nil,
            let code = items.first(where: { $0.name == "code" })?.value,
            code.count == 43, code.allSatisfy(Self.codeCharacters.contains)
        else {
            return nil
        }
        self.deployment = deployment
        self.code = code
    }

    private static let codeCharacters = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
}
