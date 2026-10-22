import { Schema } from "effect"

import { GitHubAccount } from "./connection.ts"

/** An owner connected Cluenori to GitHub with a new app. */
export const GitHubAppConnected = Schema.TaggedStruct("github_app.connected", {
  app: Schema.String,
  name: Schema.String,
  organization: Schema.optionalKey(GitHubAccount),
})

/** An owner disconnected Cluenori's app; it stays on GitHub until its owner deletes it there. */
export const GitHubAppDisconnected = Schema.TaggedStruct("github_app.disconnected", { app: Schema.String })
