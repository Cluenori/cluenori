import { cn } from "cn"

import { TemplateText } from "@/views/template-text"

const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])

/**
 * An endpoint as people scan it: the HTTP method quiet in a fixed column, so routes line up, then
 * the route with its parameters (`{id}`) dimmed. A name that isn't HTTP shows as it is. In a row it
 * is cut to one line; with `wrap`, where there is room, such as a title, it wraps whole.
 */
export function EndpointName({
  endpoint,
  wrap = false,
  className,
}: {
  readonly endpoint: string
  readonly wrap?: boolean
  readonly className?: string
}) {
  const [method = "", ...rest] = endpoint.split(" ")
  const isHttp = methods.has(method) && rest.length > 0
  const route = isHttp ? rest.join(" ") : endpoint
  return (
    <span className={cn("flex min-w-0 items-baseline gap-2", className)}>
      {isHttp && <span className="shrink-0 font-mono text-xs text-muted-foreground sm:w-12">{method}</span>}
      <span className={wrap ? "wrap-anywhere" : "truncate"}>
        <TemplateText text={route} />
      </span>
    </span>
  )
}
