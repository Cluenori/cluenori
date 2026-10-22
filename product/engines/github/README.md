# @cluenori/github

Cluenori's connection to GitHub: the workspace's own GitHub App, which an owner connects from the
web in one step and installs on their accounts, and the client a project reads and acts with as
that app.

## Use it

```ts
// In the workspace's object, for an owner on the web: the form their browser posts to GitHub.
const form = yield* connection.startConnecting(owner, access, "https://cluenori.example", undefined)
// { action: "https://github.com/settings/apps/new?state=…", manifest: "{\"name\":\"Cluenori example\",…}" }

// GitHub creates the app and sends the browser to /api/github/connected?code=…&state=…
const app = yield* connection.finishConnecting(code, state)
// { name: "Cluenori example", slug, url, installUrl: "https://github.com/apps/<slug>/installations/new" }
// A used or expired state fails with ConnectRejected, saying to connect again.

// In a project's object, the host builds the GitHub client from the workspace's tokens.
const layer = gitHubAsApp((repository) => askWorkspace(repository))
const github = yield* GitHub
yield* github.dispatchWorkflow(repository, workflow, "main", { release, environment })
// Before the app is connected or installed on the repository: GitHubRefused, saying what to do.
```

## Owns

- **Data,** in the workspace's database:
  - the app GitHub created, one at most, with its private key and webhook secret (`github_app`);
  - connects started, by their state's SHA-256 digest, with who started each (`github_connects`).
- **Rules:**
  - Only an owner connects, disconnects, or sees the connection.
  - A connect's state is good once, for an hour; at most 5 are open.
  - What the app may do where it is installed: read code (Contents) and pull requests, start
    workflows (Actions, write), and see an organization's self-hosted runners (read), to tell
    whether a build can run on the founder's own machine. It has no webhook yet.
  - The app is public, so it can be installed on organizations as well as the account that made
    it; installed on an account whose repositories no component links, it does nothing.
  - A token acts on the repository asked about, through the installation that reaches it; it is
    reused until 5 minutes before it expires, in the workspace and in each project.
- **Integrations:** GitHub, through `@bagatka/github`.

## Does not own

- **Which repository a component has:** `@cluenori/projects`, its links.
- **What a project does on GitHub:** its modules, such as Releases, which read commits and start
  deploy workflows with the `GitHub` client.
- **Who is an owner:** `@cluenori/members`; the host passes the caller's access.

## Contract

`src/index.ts`. `GitHubConnection` runs in the workspace's object: the connect flow, the status an
owner sees, and `tokenFor`, which the host serves to projects' objects. `gitHubAsApp` is the
`GitHub` client a project's object uses. `GitHubGroup` is the API's part; the host serves GitHub's
return, `/api/github/connected`, itself.

## Depends on

- `@bagatka/github`: the app's tokens, the manifest flow, and the client.
- `@bagatka/rs256-jwt`: the app's JSON Web Tokens, with its private key.
- `@cluenori/members`: `Access`, to tell an owner.
- Foundation's `ActivityLog`, and `Crypto` for states and digests.

## Activity

`github_app.connected` by the owner who started connecting; `github_app.disconnected` by the owner
who disconnected.

## Settings

`GitHubConnection.layer({ signing })`: the platform's Web Crypto, which signs the app's tokens.

## Decisions and constraints

- **One step for the owner,** with GitHub's manifest flow: no token to create, paste or renew. The
  key GitHub gives stays in the workspace's object; projects get only tokens, good for an hour.
- **GitHub's return carries no sign-in.** The sign-in cookie is SameSite=Strict, so the browser
  doesn't send it on GitHub's redirect: the state, which an owner started, is the credential, good
  once within the hour.
- **Disconnecting doesn't delete the app.** Only its owner can, on GitHub, which also removes its
  installations.
- **Not handled:** webhooks. The app is created without one; following a workflow's run is done by
  asking each minute. Adding them takes the app's webhook set through GitHub's API, and events the
  owner accepts on each installation.
