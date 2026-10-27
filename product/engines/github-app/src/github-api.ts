import { NotAllowed } from "@cluenori/foundation"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { ConnectGitHub, GitHubAlreadyConnected, GitHubAppForm, GitHubStatus } from "./connection.ts"

/** Cluenori's connection to GitHub: the public API's part for this engine, for owners. */
export class GitHubGroup extends HttpApiGroup.make("github")
  .add(
    HttpApiEndpoint.get("github", "/github", {
      success: GitHubStatus,
      error: NotAllowed.pipe(HttpApiSchema.status(403)),
    }).annotate(
      OpenApi.Description,
      "Whether Cluenori is connected to GitHub: its GitHub App, absent until an owner connects it, and the accounts it is installed on, read from GitHub now; `problem` says why they couldn't be. Owners only.",
    ),
  )
  .add(
    HttpApiEndpoint.post("connectGitHub", "/github/connect", {
      payload: ConnectGitHub,
      success: GitHubAppForm,
      error: [NotAllowed.pipe(HttpApiSchema.status(403)), GitHubAlreadyConnected.pipe(HttpApiSchema.status(409))],
    }).annotate(
      OpenApi.Description,
      "Starts connecting GitHub: the form the owner's browser posts to `action`, with the field `manifest`, so GitHub creates Cluenori's app in `organization` or their own account. It may read code and pull requests, start workflows, and write the outside watcher's Actions secrets, where it is installed. GitHub then sends the browser back to `/api/github/connected`, which finishes, good once within an hour. Owners only; 409 while an app is connected.",
    ),
  )
  .add(
    HttpApiEndpoint.delete("disconnectGitHub", "/github", {
      success: HttpApiSchema.NoContent,
      error: NotAllowed.pipe(HttpApiSchema.status(403)),
    }).annotate(
      OpenApi.Description,
      "Disconnects GitHub: Cluenori forgets its app, and stops reading and promoting through it. The app stays on GitHub until its owner deletes it there. Owners only.",
    ),
  ) {}
