import { cn } from "cn"

const methods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])

/**
 * An endpoint as people scan it: the HTTP method quiet in a fixed column, so routes line up, then
 * the route with its parameters (`{id}`) dimmed. A name that isn't HTTP shows as it is.
 */
export function EndpointName({ endpoint, className }: { readonly endpoint: string; readonly className?: string }) {
  const [method = "", ...rest] = endpoint.split(" ")
  const isHttp = methods.has(method) && rest.length > 0
  const route = isHttp ? rest.join(" ") : endpoint
  return (
    <span className={cn("flex min-w-0 items-baseline gap-2", className)}>
      {isHttp && <span className="shrink-0 font-mono text-xs text-muted-foreground sm:w-12">{method}</span>}
      <span className="truncate">
        {route.split(/(\{[^}]+\})/).map((part, index) =>
          part.startsWith("{") ? (
            <span key={index} className="text-muted-foreground">
              {part}
            </span>
          ) : (
            part
          ),
        )}
      </span>
    </span>
  )
}
