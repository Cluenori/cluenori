import { Schema } from "effect"

/**
 * The text takes more UTF-8 bytes than the largest QR code made here holds: version 10 at level M,
 * `limit` bytes (213). `byteLength` is how many the text takes. Shorten the text; nothing longer can
 * be encoded.
 */
export class QrCodeTooLong extends Schema.TaggedError<QrCodeTooLong>()("QrCodeTooLong", {
  byteLength: Schema.Int,
  limit: Schema.Int,
}) {}
