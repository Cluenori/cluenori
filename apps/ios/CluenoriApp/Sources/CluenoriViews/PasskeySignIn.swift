import AuthenticationServices
import CluenoriClient
import CluenoriScreens
import Foundation
import SwiftUI

/// Signing in with a passkey of the deployment this app is built for, in place of a pairing link:
/// the system shows the person's passkeys for its site, and Face ID confirms.
struct PasskeySignInButton: View {
    let pairing: PairingModel
    @Environment(\.authorizationController) private var authorizationController

    var body: some View {
        Button {
            Task {
                await pairing.signInWithPasskey { options throws(PairingModel.PasskeyRefusal) in
                    try await assertion(for: options)
                }
            }
        } label: {
            Label {
                Text("Sign In with a Passkey", bundle: #bundle, comment: "Pairs the phone by a passkey.")
            } icon: {
                Image(systemName: "person.badge.key")
            }
            .padding(.horizontal, 12)
        }
        .buttonStyle(.glass)
        .controlSize(.large)
    }

    // The person's passkey for the options' site, as the deployment takes it.
    private func assertion(
        for options: PublicKeyCredentialRequestOptionsJSON
    ) async throws(PairingModel.PasskeyRefusal) -> AuthenticationResponseJSON {
        guard let challenge = Data(base64URL: options.challenge) else { throw .unavailable }
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: options.rpId)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        request.userVerificationPreference = .required
        let result: ASAuthorizationResult
        do {
            result = try await authorizationController.performRequest(request)
        } catch let error as ASAuthorizationError where error.code == .canceled {
            throw .cancelled
        } catch {
            // Not handled: telling the reasons apart; each is the site's passkeys being out of
            // reach here: the app isn't associated with it yet, or this phone has none of them.
            throw .unavailable
        }
        guard case .passkeyAssertion(let credential) = result else { throw .unavailable }
        return AuthenticationResponseJSON(
            id: credential.credentialID.base64URLEncoded,
            type: "public-key",
            response: AuthenticatorAssertionResponseJSON(
                clientDataJSON: credential.rawClientDataJSON.base64URLEncoded,
                authenticatorData: credential.rawAuthenticatorData.base64URLEncoded,
                signature: credential.signature.base64URLEncoded,
                userHandle: credential.userID.base64URLEncoded
            )
        )
    }
}

extension Data {
    /// Bytes from base64url, as WebAuthn writes them, without padding; nil for anything else.
    init?(base64URL text: String) {
        var base64 = text.replacing("-", with: "+").replacing("_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        self.init(base64Encoded: base64)
    }

    /// The bytes as base64url, without padding, as WebAuthn writes them.
    var base64URLEncoded: String {
        base64EncodedString().replacing("+", with: "-").replacing("/", with: "_").replacing("=", with: "")
    }
}
