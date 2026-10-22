/**
 * Signs JSON Web Tokens with RS256 keys, such as a GitHub App's private key, through the platform's
 * Web Crypto: a header and claims in, a compact JWS out.
 */
export type { Rs256Signing } from "./sign-rs256.ts"
export { InvalidSigningKey, signRs256 } from "./sign-rs256.ts"
