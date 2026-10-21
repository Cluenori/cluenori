/**
 * Passkeys for a site: the options a browser or an app makes or uses one with, and the checks of
 * what it returns, on the platform's Web Crypto. Stateless: the caller keeps challenges and passkeys.
 */
export {
  AssertionResponse,
  challengeOf,
  CreationOptions,
  creationOptions,
  RegistrationResponse,
  RequestOptions,
  requestOptions,
  verifyAssertion,
  verifyRegistration,
  WebAuthnRejected,
} from "./webauthn.ts"
export type { CreationInput, Expected, Passkey, WebAuthnCrypto } from "./webauthn.ts"
export { softwareAuthenticator } from "./software-authenticator.ts"
export type { AuthenticatorCrypto, Ceremony, SoftwareAuthenticator } from "./software-authenticator.ts"
