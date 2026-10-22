// GitHub's answers, shaped like the examples in its REST API's description
// (github/rest-api-description, descriptions/api.github.com/api.github.com.json, version 2022-11-28),
// with fewer of their fields and values of these tests' own. Written by hand: tests never call GitHub.

const repo = "https://api.github.com/repos/octocat/Hello-World"
const page = "https://github.com/octocat/Hello-World"

/** Commits' SHAs. */
export const shas = {
  released: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
  previous: "bbcd538c8e72b8c175046e27cc8f907076331401",
  fix: "0328041d1152db8ae77652d1618a02e57f745f17",
  candidate: "c5b97d5ae6c19d5c5df71a34c7fbeeda2479ccbc",
  old: "7638417db6d59f3c431d3e1f261cc637155684cd",
} as const

/** One entry of `GET /repos/{owner}/{repo}/tags`, lightweight and annotated alike: `commit` is the commit it names. */
export const tagJson = (name: string, sha: string) => ({
  name,
  commit: { sha, url: `${repo}/commits/${sha}` },
  zipball_url: `${page}/zipball/${name}`,
  tarball_url: `${page}/tarball/${name}`,
  node_id: "MDM6UmVmcmVmcy90YWdzL3YwLjE=",
})

const account = (login: string, id: number) => ({
  login,
  id,
  node_id: "MDQ6VXNlcjE=",
  avatar_url: "https://github.com/images/error/octocat_happy.gif",
  url: `https://api.github.com/users/${login}`,
  html_url: `https://github.com/${login}`,
  type: "User",
  site_admin: false,
})

/** A commit, as a comparison lists it: `login` is null when GitHub knows no account for its author. */
export const commitJson = (commit: {
  readonly sha: string
  readonly message: string
  readonly login: string | null
  readonly name: string
  readonly date: string
}) => ({
  url: `${repo}/commits/${commit.sha}`,
  sha: commit.sha,
  node_id: "MDY6Q29tbWl0NmRjYjA5YjViNTc4NzVmMzM0ZjYxYWViZWQ2OTVlMmU0MTkzZGI1ZQ==",
  html_url: `${page}/commit/${commit.sha}`,
  comments_url: `${repo}/commits/${commit.sha}/comments`,
  commit: {
    url: `${repo}/git/commits/${commit.sha}`,
    author: { name: commit.name, email: "mona@example.com", date: commit.date },
    committer: { name: "GitHub", email: "noreply@example.com", date: commit.date },
    message: commit.message,
    tree: { url: `${repo}/tree/${commit.sha}`, sha: commit.sha },
    comment_count: 0,
    verification: { verified: false, reason: "unsigned", signature: null, payload: null, verified_at: null },
  },
  author: commit.login === null ? null : account(commit.login, 1),
  committer: account("web-flow", 19864447),
  parents: [{ url: `${repo}/commits/${shas.previous}`, sha: shas.previous }],
})

const fileJson = (filename: string, additions: number, deletions: number) => ({
  sha: "bbcd538c8e72b8c175046e27cc8f907076331401",
  filename,
  status: "modified",
  additions,
  deletions,
  changes: additions + deletions,
  blob_url: `${page}/blob/${shas.released}/${filename}`,
  raw_url: `${page}/raw/${shas.released}/${filename}`,
  contents_url: `${repo}/contents/${filename}?ref=${shas.released}`,
  patch: "@@ -132,7 +132,7 @@ module Test @@ -1000,7 +1000,7 @@ module Test",
})

/** `GET /repos/{owner}/{repo}/commits/{ref}`: a commit, with its stats and files. */
export const singleCommitJson = (commit: Parameters<typeof commitJson>[0]) => ({
  ...commitJson(commit),
  stats: { additions: 104, deletions: 4, total: 108 },
  files: [fileJson("file1.txt", 104, 4)],
})

/** `GET /repos/{owner}/{repo}/compare/{previous}...{released}`: two commits ahead. */
export const comparisonJson = {
  url: `${repo}/compare/${shas.previous}...${shas.released}`,
  html_url: `${page}/compare/${shas.previous}...${shas.released}`,
  permalink_url: `${page}/compare/octocat:${shas.previous}...octocat:${shas.released}`,
  diff_url: `${page}/compare/${shas.previous}...${shas.released}.diff`,
  patch_url: `${page}/compare/${shas.previous}...${shas.released}.patch`,
  base_commit: commitJson({
    sha: shas.previous,
    message: "Release 2.3.0",
    login: "octocat",
    name: "Monalisa Octocat",
    date: "2026-10-14T09:12:00Z",
  }),
  merge_base_commit: commitJson({
    sha: shas.previous,
    message: "Release 2.3.0",
    login: "octocat",
    name: "Monalisa Octocat",
    date: "2026-10-14T09:12:00Z",
  }),
  status: "ahead",
  ahead_by: 2,
  behind_by: 0,
  total_commits: 2,
  commits: [
    commitJson({
      sha: shas.fix,
      message: "Fix the export of empty notes (#1347)\n\nAn empty note exported as a file of zero bytes.",
      login: "octocat",
      name: "Monalisa Octocat",
      date: "2026-10-20T15:30:00Z",
    }),
    commitJson({
      sha: shas.released,
      message: "Release 2.4.0",
      login: null,
      name: "Release Bot",
      date: "2026-10-21T08:00:00+02:00",
    }),
  ],
  files: [fileJson("src/export.ts", 103, 21), fileJson("CHANGELOG.md", 4, 0)],
}

/** `GET /repos/{owner}/{repo}/pulls/{pull_number}`: merged, with a label. */
export const pullRequestJson = {
  url: `${repo}/pulls/1347`,
  id: 1,
  node_id: "MDExOlB1bGxSZXF1ZXN0MQ==",
  html_url: `${page}/pull/1347`,
  number: 1347,
  state: "closed",
  locked: false,
  title: "Fix the export of empty notes",
  user: account("octocat", 1),
  body: "Please pull these awesome changes in!",
  labels: [
    {
      id: 208045946,
      node_id: "MDU6TGFiZWwyMDgwNDU5NDY=",
      url: `${repo}/labels/bug`,
      name: "bug",
      description: "Something isn't working",
      color: "f29513",
      default: true,
    },
  ],
  created_at: "2026-10-19T11:00:00Z",
  updated_at: "2026-10-20T15:31:00Z",
  closed_at: "2026-10-20T15:30:00Z",
  merged_at: "2026-10-20T15:30:00Z",
  merge_commit_sha: shas.fix,
  merged: true,
}

/** What GitHub answers when it doesn't answer what was asked. */
export const errorJson = (message: string, status: number) => ({
  message,
  documentation_url: "https://docs.github.com/rest",
  status: String(status),
})

/** `GET /repos/{owner}/{repo}`: the repository, with fewer of its fields. */
export const repositoryJson = {
  id: 1296269,
  node_id: "MDEwOlJlcG9zaXRvcnkxMjk2MjY5",
  name: "Hello-World",
  full_name: "octocat/Hello-World",
  owner: account("octocat", 1),
  private: false,
  html_url: page,
  url: repo,
  default_branch: "main",
}

/** A workflow run, as GitHub answers one and lists them: `conclusion` is null until it completes. */
export const workflowRunJson = (run: {
  readonly id: number
  readonly status: string
  readonly conclusion: string | null
  readonly createdAt: string
  readonly updatedAt?: string
  readonly event?: string
  readonly title?: string
}) => ({
  id: run.id,
  name: "Promote to production",
  node_id: "MDEyOldvcmtmbG93IFJ1bjI2OTI4OQ==",
  check_suite_id: 42,
  head_branch: "main",
  head_sha: shas.released,
  path: ".github/workflows/promote-to-prod.yml@main",
  run_number: 562,
  event: run.event ?? "workflow_dispatch",
  display_title: run.title ?? "Promote to production",
  status: run.status,
  conclusion: run.conclusion,
  workflow_id: 159038,
  url: `${repo}/actions/runs/${run.id}`,
  html_url: `${page}/actions/runs/${run.id}`,
  pull_requests: [],
  created_at: run.createdAt,
  updated_at: run.updatedAt ?? run.createdAt,
  actor: account("octocat", 1),
  triggering_actor: account("octocat", 1),
  run_attempt: 1,
  run_started_at: run.createdAt,
  jobs_url: `${repo}/actions/runs/${run.id}/jobs`,
  logs_url: `${repo}/actions/runs/${run.id}/logs`,
  workflow_url: `${repo}/actions/workflows/159038`,
})

/** `GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs`: one page. */
export const workflowRunsJson = (runs: ReadonlyArray<ReturnType<typeof workflowRunJson>>) => ({
  total_count: runs.length,
  workflow_runs: runs,
})

/** A GitHub App's installation on an account, with fewer of its fields. */
export const installationJson = (installation: {
  readonly id: number
  readonly login: string
  readonly type: "User" | "Organization"
  readonly selection: "all" | "selected"
}) => ({
  id: installation.id,
  account: { ...account(installation.login, 2), type: installation.type },
  repository_selection: installation.selection,
  access_tokens_url: `https://api.github.com/app/installations/${installation.id}/access_tokens`,
  repositories_url: "https://api.github.com/installation/repositories",
  html_url:
    installation.type === "Organization"
      ? `https://github.com/organizations/${installation.login}/settings/installations/${installation.id}`
      : `https://github.com/settings/installations/${installation.id}`,
  app_id: 123456,
  app_slug: "cluenori-test",
  target_id: 2,
  target_type: installation.type,
  permissions: { actions: "write", contents: "read", metadata: "read" },
  events: [],
  created_at: "2026-10-01T09:00:00Z",
  updated_at: "2026-10-01T09:00:00Z",
  single_file_name: null,
  suspended_at: null,
  suspended_by: null,
})

/** `POST /app/installations/{installation_id}/access_tokens`: a token, of the tests' own. */
export const installationTokenJson = (token: string, expiresAt: string) => ({
  token,
  expires_at: expiresAt,
  permissions: { actions: "write", contents: "read", metadata: "read" },
  repository_selection: "all",
})

/** `POST /app-manifests/{code}/conversions`: the app created, its secrets the tests' own. */
export const manifestConversionJson = (secrets: { readonly pem: string; readonly webhookSecret: string | null }) => ({
  id: 123456,
  slug: "cluenori-test",
  node_id: "MDxOkludGVncmF0aW9uMQ==",
  owner: account("octocat", 1),
  name: "Cluenori Test",
  description: "",
  external_url: "https://example.com",
  html_url: "https://github.com/apps/cluenori-test",
  created_at: "2026-10-22T10:00:00Z",
  updated_at: "2026-10-22T10:00:00Z",
  permissions: { actions: "write", contents: "read", metadata: "read" },
  events: [],
  client_id: "Iv23liTestClientNotReal",
  client_secret: "test-client-secret-not-a-real-one",
  webhook_secret: secrets.webhookSecret,
  pem: secrets.pem,
})
