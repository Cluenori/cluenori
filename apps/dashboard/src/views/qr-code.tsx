import { encodeQrCode, qrCodePath } from "@cluenori/qr-code"
import { Result } from "effect"

/**
 * `text` as a QR code a phone's Camera reads: dark squares on white, whatever the theme, with the
 * light margin of 4 squares readers need. A text too long for one says so instead.
 */
export function QrCode({
  text,
  label,
  className,
}: {
  readonly text: string
  readonly label: string
  readonly className?: string
}) {
  const encoded = encodeQrCode(text)
  if (Result.isFailure(encoded)) {
    return (
      <p role="alert" className="text-sm text-failure">
        This link is too long for a QR code: {encoded.failure.byteLength} bytes, of {encoded.failure.limit} at most.
      </p>
    )
  }
  const { size } = encoded.success
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`-4 -4 ${size + 8} ${size + 8}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect x={-4} y={-4} width={size + 8} height={size + 8} fill="#fff" />
      <path d={qrCodePath(encoded.success)} fill="#000" />
    </svg>
  )
}
