import type { Caller } from "@cluenori/phones"
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
