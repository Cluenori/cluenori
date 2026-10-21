import type { Caller } from "@cluenori/foundation"
import type { Site } from "@cluenori/members"
import type { HttpServerRequest } from "effect/http"

/**
 * Where a request came from, as Cloudflare says: its address, its country unless Cloudflare couldn't
 * place it (`XX`), and its User-Agent. Outside Cloudflare, as under `./run`, address and country are
 * absent.
 */
export const callerOf = (request: HttpServerRequest.HttpServerRequest): Caller => {
  const address = request.headers["cf-connecting-ip"]
  const country = request.headers["cf-ipcountry"]
  const userAgent = request.headers["user-agent"]
  return {
    ...(address === undefined ? {} : { address }),
    ...(country === undefined || country === "XX" ? {} : { country }),
    ...(userAgent === undefined ? {} : { userAgent }),
  }
}

/**
 * Where a passkey ceremony runs: the origin the browser reached, and its hostname, which a passkey
 * belongs to. Behind a custom domain, that domain; on workers.dev, the workers.dev name.
 */
export const siteOf = (request: HttpServerRequest.HttpServerRequest): Site => {
  const url = new URL(request.originalUrl)
  return { origin: url.origin, rpId: url.hostname }
}
