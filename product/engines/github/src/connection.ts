import { Instant } from "@cluenori/foundation"
import { Schema } from "effect"

/** A GitHub account's login, a user's or an organization's, such as `octo-org`. */
export const GitHubAccount = Schema.String.check(
  Schema.isMaxLength(39),
  Schema.isPattern(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/, {
    expected: "a GitHub account's login: letters, digits and hyphens, such as octo-org",
  }),
).pipe(Schema.brand("GitHubAccount"))
export type GitHubAccount = typeof GitHubAccount.Type

/** The workspace's GitHub App, as GitHub knows it. */
export const GitHubAppSummary = Schema.Struct({
  name: Schema.String,
  slug: Schema.String,
  /** Its page on GitHub. */
  url: Schema.String,
  /** Where someone installs it on an account of theirs, and chooses which repositories it reaches. */
  installUrl: Schema.String,
  /** The organization it belongs to; absent when it belongs to the account of whoever made it. */
  organization: Schema.optionalKey(GitHubAccount),
  connectedAt: Instant,
}).annotate({ identifier: "GitHubAppSummary" })
export type GitHubAppSummary = typeof GitHubAppSummary.Type

/** What kind of account the app is installed on. */
export const GitHubAccountType = Schema.Literals(["User", "Organization"]).annotate({
  identifier: "GitHubAccountType",
})

/** Which of an account's repositories the app reaches: all of them, or those its owner chose. */
export const GitHubRepositoryAccess = Schema.Literals(["all", "selected"]).annotate({
  identifier: "GitHubRepositoryAccess",
})

/** An account the app is installed on. */
export const GitHubInstallation = Schema.Struct({
  account: Schema.String,
  accountType: GitHubAccountType,
  repositories: GitHubRepositoryAccess,
  /** Where the account's owner chooses its repositories, or removes the app. */
  url: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "GitHubInstallation" })
export type GitHubInstallation = typeof GitHubInstallation.Type

/**
 * Whether Cluenori is connected to GitHub: its app, absent until connected, and the accounts it is
 * installed on, read from GitHub now. `problem` says why they couldn't be read.
 */
export const GitHubStatus = Schema.Struct({
  app: Schema.optionalKey(GitHubAppSummary),
  installations: Schema.Array(GitHubInstallation),
  problem: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "GitHubStatus" })
export type GitHubStatus = typeof GitHubStatus.Type

/** Connect GitHub, with an app that belongs to `organization`, or else to the owner's own account. */
export const ConnectGitHub = Schema.Struct({ organization: Schema.optionalKey(GitHubAccount) }).annotate({
  identifier: "ConnectGitHub",
})
export type ConnectGitHub = typeof ConnectGitHub.Type

/**
 * The form an owner's browser posts to GitHub to create the app: to `action`, with one field,
 * `manifest`, as it is. GitHub then sends the browser back to the deployment to finish.
 */
export const GitHubAppForm = Schema.Struct({ action: Schema.String, manifest: Schema.String }).annotate({
  identifier: "GitHubAppForm",
})
export type GitHubAppForm = typeof GitHubAppForm.Type

/** What GitHub sends a browser back with, once the app is created: a code, and the connect's state. */
export const ManifestCode = Schema.String.check(
  Schema.isMaxLength(200),
  Schema.isPattern(/^[A-Za-z0-9_-]+$/, { expected: "GitHub's code: letters, digits, _ and -" }),
).pipe(Schema.brand("ManifestCode"))
export type ManifestCode = typeof ManifestCode.Type

/** Cluenori is connected to GitHub already: disconnect it first to connect another app. */
export class GitHubAlreadyConnected extends Schema.TaggedError<GitHubAlreadyConnected>()(
  "GitHubAlreadyConnected",
  {},
) {}

/** Connecting couldn't finish, for the reason given, which says what to do. */
export class ConnectRejected extends Schema.TaggedError<ConnectRejected>()("ConnectRejected", {
  reason: Schema.String,
}) {}
