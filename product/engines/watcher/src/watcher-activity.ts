import { Repository } from "@cluenori/github"
import { Schema } from "effect"

/** An owner named the repository the outside watcher runs in; Cluenori writes its secrets there. */
export const WatcherRepositorySet = Schema.TaggedStruct("watcher.repository_set", { repository: Repository })
