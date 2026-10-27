import { NotAllowed } from "@cluenori/foundation"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { SetWatcher, WatcherStatus } from "./watcher-status.ts"

/** The outside watcher: the public API's part for this engine, for owners. */
export class WatcherGroup extends HttpApiGroup.make("watcher")
  .add(
    HttpApiEndpoint.get("watcher", "/watcher", {
      success: WatcherStatus,
      error: NotAllowed.pipe(HttpApiSchema.status(403)),
    }).annotate(
      OpenApi.Description,
      "The outside watcher (Cluenori/cluenori-watch): the repository it runs in, absent until named, how many owners' phones its secrets hold and when they were last written, and what is wrong. Never the tokens or the key. Owners only.",
    ),
  )
  .add(
    HttpApiEndpoint.put("setWatcher", "/watcher", {
      payload: SetWatcher,
      success: WatcherStatus,
      error: NotAllowed.pipe(HttpApiSchema.status(403)),
    }).annotate(
      OpenApi.Description,
      "Names the outside watcher's repository, `owner/name`, and writes its Actions secrets there at once, as the workspace's GitHub App: CLUENORI_APNS_KEY, the deployment's APNs key, and CLUENORI_PHONES, the push tokens of every owner's phone, written again whenever they change. The app needs Secrets: write on it. Owners only; `problem` says why a write failed.",
    ),
  ) {}
