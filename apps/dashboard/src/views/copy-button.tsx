import { CheckIcon, CopyIcon } from "lucide-react"
import { useState } from "react"

import { Button } from "@/views/ui/button"

/**
 * A button that copies `text` to the clipboard and then says "Copied". `label` says what it copies,
 * "Copy the link", and `name`, when given, which one, for a screen reader among several.
 */
export function CopyButton({
  text,
  label,
  name,
  className,
}: {
  readonly text: string
  readonly label: string
  readonly name?: string
  readonly className?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      className={className}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true))
      }}
    >
      {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
      {copied ? "Copied" : label}
      {name !== undefined && <span className="sr-only"> {name}</span>}
    </Button>
  )
}
