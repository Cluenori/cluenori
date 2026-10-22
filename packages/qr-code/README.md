# @cluenori/qr-code

Encodes text, such as a link a phone's camera opens, as a QR code (ISO/IEC 18004), and draws it as
SVG path data.

## Use it

```ts
import { encodeQrCode, qrCodePath } from "@cluenori/qr-code"
import { Result } from "effect"

const encoded = encodeQrCode("https://example.com/pair?code=Zk3Pq9TzX2mV8wYb4LdR7nHs1cFgJ0uE")
if (Result.isSuccess(encoded)) {
  const code = encoded.success
  // 4 light modules around the code: the quiet zone readers need.
  const svg = `<svg viewBox="-4 -4 ${code.size + 8} ${code.size + 8}" shape-rendering="crispEdges">
    <path d="${qrCodePath(code)}" fill="currentColor" /></svg>`
} else {
  encoded.failure // QrCodeTooLong { byteLength: 240, limit: 213 }: the text needs a shorter form.
}
```

## Contract

`src/index.ts`. Callers turn text into a code, which is plain data, a square of dark and light
modules (the standard's word for its squares), and draw it with `qrCodePath`, or any other way.

## Depends on

`effect`, for `Result` and the error's Schema.

## Decisions and constraints

- **One kind of code:** byte mode, error correction level M (about 15% of the code may be
  unreadable), versions 1 to 10, so at most 213 bytes of UTF-8 and at most 57 modules a side: enough
  for links and short texts.
- **The mask is the standard's choice:** all eight are scored by its four penalty rules, and the
  lowest wins, the lower number on a tie. Rule 3, finder-like patterns, is read the way Apple's
  encoder reads it: the 11 modules `1011101` and `0000` side by side, inside the symbol. So for text
  Apple's `CIQRCodeGenerator` writes in byte mode, its code at level M and this one are the same,
  module for module.
- **UTF-8 without an ECI header,** as Apple's encoder writes it and Apple's Vision reads it. A lone
  surrogate in the text, which UTF-8 can't hold, is encoded as U+FFFD, as `TextEncoder` does.
- **Rows of rectangles:** `qrCodePath` draws each run of dark modules along a row as one rectangle,
  which keeps the path short and leaves no seams between adjacent modules.
