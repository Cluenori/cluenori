import { hsalsa, xsalsa20poly1305 } from "@noble/ciphers/salsa.js"
import { x25519 } from "@noble/curves/ed25519.js"
import { blake2b } from "@noble/hashes/blake2.js"

// libsodium's `crypto_box_seal`, which GitHub asks for to write a secret: a fresh X25519 key pair,
// the nonce BLAKE2b-24 of its public key and the recipient's, and XSalsa20-Poly1305 with the key
// HSalsa20 derives from their shared secret. The sealed box is the ephemeral public key, then the
// ciphertext with its tag. Checked against libsodium's `crypto_box_seal_open` in the tests.

const words = (bytes: Uint8Array) => {
  const copy = Uint8Array.from(bytes)
  return new Uint32Array(copy.buffer, 0, copy.byteLength / 4)
}
// "expand 32-byte k", Salsa20's constant, as little-endian words.
const sigma = words(Uint8Array.from("expand 32-byte k", (character) => character.charCodeAt(0)))

/**
 * `message` sealed for `recipient`, a 32-byte X25519 public key: only its secret key opens it, and
 * nothing tells who sealed it. Throws for a recipient that isn't a usable X25519 key.
 */
export const seal = (recipient: Uint8Array, message: Uint8Array): Uint8Array => {
  const ephemeral = x25519.keygen()
  const shared = x25519.getSharedSecret(ephemeral.secretKey, recipient)
  const key = new Uint32Array(8)
  hsalsa(sigma, words(shared), new Uint32Array(4), key)
  const nonceInput = new Uint8Array(64)
  nonceInput.set(ephemeral.publicKey)
  nonceInput.set(recipient, 32)
  const nonce = blake2b(nonceInput, { dkLen: 24 })
  const sealed = xsalsa20poly1305(new Uint8Array(key.buffer), nonce).encrypt(message)
  const box = new Uint8Array(32 + sealed.length)
  box.set(ephemeral.publicKey)
  box.set(sealed, 32)
  return box
}
