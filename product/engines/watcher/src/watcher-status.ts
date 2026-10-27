import { Instant } from "@cluenori/foundation"
import { Repository } from "@cluenori/github"
import { Schema } from "effect"

/**
 * The outside watcher, as an owner sees it: its repository, absent until named; how many owners'
 * phones its secrets hold and when they were last written; and what is wrong, when its secrets
 * couldn't be written or push isn't set up. Never the tokens or the key.
 */
export const WatcherStatus = Schema.Struct({
  repository: Schema.optionalKey(Repository),
  phones: Schema.optionalKey(Schema.Int),
  writtenAt: Schema.optionalKey(Instant),
  problem: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "WatcherStatus" })
export type WatcherStatus = typeof WatcherStatus.Type

/** The repository the outside watcher runs in, `owner/name`: Cluenori writes its secrets there. */
export const SetWatcher = Schema.Struct({ repository: Repository }).annotate({ identifier: "SetWatcher" })
export type SetWatcher = typeof SetWatcher.Type
