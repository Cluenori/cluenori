/**
 * Signs JSON Web Tokens with ES256 keys, such as Apple's `.p8` keys, through the platform's Web
 * Crypto: a header and claims in, a compact JWS out.
 */
export type { Es256Signing } from "./sign-es256.ts"
export { InvalidSigningKey, signEs256 } from "./sign-es256.ts"
