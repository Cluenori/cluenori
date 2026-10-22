/**
 * Reads a GitHub repository through GitHub's REST API, read-only, with a token: the tags that name
 * a version, the commit a ref names, what changed between two commits, and a pull request.
 */
export { CommitSha } from "./commit-sha.ts"
export type { Comparison, Commit, GitHubCredentials, PullRequest, Tag } from "./github.ts"
export { GitHub, GitHubRefused, GitHubUnavailable } from "./github.ts"
export { Repository } from "./repository.ts"
