import type { GitHubRefused, GitHubUnavailable, IssuedToken, Repository } from "@bagatka/github"
import { GitHub } from "@bagatka/github"
import { DateTime, Duration, Effect, Layer } from "effect"

// A token is used until this long before it expires.
const renewBefore = Duration.minutes(5)

/**
 * The GitHub client a project's Durable Object reads and acts with, as the workspace's app: each
 * repository's token is asked of `issue`, which the host answers from the workspace's object with
 * `GitHubConnection.tokenFor`, and kept until 5 minutes before it expires. A call fails as
 * `issue` does when no app is connected or installed on its repository.
 */
export const gitHubAsApp = (
  issue: (repository: Repository) => Effect.Effect<IssuedToken, GitHubRefused | GitHubUnavailable>,
) =>
  Layer.unwrap(
    Effect.sync(() => {
      // Owned here: one token for each repository asked about, replaced when it nears its expiry.
      const tokens = new Map<Repository, IssuedToken>()
      const tokenFor = Effect.fn("GitHub.tokenFor")(function* (repository: Repository) {
        const now = yield* DateTime.now
        const kept = tokens.get(repository)
        if (kept !== undefined && Duration.isGreaterThan(DateTime.distance(now, kept.expiresAt), renewBefore)) {
          return kept.token
        }
        const issued = yield* issue(repository)
        tokens.set(repository, issued)
        return issued.token
      })
      return GitHub.layerFor(tokenFor)
    }),
  )
