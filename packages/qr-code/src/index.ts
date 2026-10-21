/**
 * Encodes text as a QR code (ISO/IEC 18004), such as a link a phone's camera opens, and draws it as
 * SVG path data. Versions 1 to 10 at error correction level M, in byte mode: up to 213 bytes of UTF-8.
 */
export type { QrCode } from "./qr-code.ts"
export { encodeQrCode } from "./qr-code.ts"
export { qrCodePath } from "./qr-code-path.ts"
export { QrCodeTooLong } from "./qr-code-too-long.ts"
