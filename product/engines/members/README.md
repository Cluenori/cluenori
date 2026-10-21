# @cluenori/members

The deployment's members: who signs in, with passkeys, which projects each sees, and the browsers
signed in. An owner sees every project and invites members to some of them.

## Use it

```ts
const members = yield* Members

// An owner invites; the link carries a code good once for 7 days.
const invite = yield* members.invite(owner, { email, projects: [notes] }, site)

// The invited person's browser makes a passkey and joins, signed in.
const options = yield* members.startJoining(code, site)
const { member, signIn } = yield* members.join(code, registration, site, caller)

// Each request with the sign-in cookie: who, and what they see.
const { access } = yield* members.signedIn(token, caller)
canSee(access, notes) // true; for any other project, false
// A removed member's sign-ins fail with SignInRejected.
```

## Owns

- **Data:** members, their roles and the projects each sees (`members_members`,
  `members_projects`); open invitations by their code's digest; passkeys with their public key and
  counter; the challenges of passkey ceremonies, good once for 5 minutes; browsers' sign-ins by
  their token's digest, with what each browser is and when and where it signed in and was last seen.
- **Rules:**
  - Owners see every project and manage members; a member sees the projects chosen for them.
  - An invitation is good once, for 7 days; at most 20 are open.
  - A sign-in lasts 30 days; when it calls is recorded at most once a minute from one address.
  - What people call a browser, `Safari on macOS`, from its User-Agent.

## Does not own

- **Enforcing access:** the Worker keeps each request to what its member sees (`MemberProjects`),
  and Notifications tells only the phones whose member sees a project.
- **Phones:** a member's phones act for them (Phones); removing a member removes them, in the host.
- **The API token:** the owner `./setup` made signs in with it too (the Worker's `ApiToken`).

## Contract

`src/index.ts`. The host asks `accessOf` and `signedIn` for every request, runs the passkey
ceremonies, and serves `MembersGroup` and `PasskeysGroup`.

## Depends on

`@bagatka/webauthn` for passkeys, `@cluenori/projects`' index to check projects, Foundation's
`ActivityLog`, and `Crypto` for codes, tokens, IDs and digests.

## Activity

`member.invited`, `member.projects_changed` and `member.removed` by the owner who acts;
`member.joined` and `passkey.added` by the member.

## Settings

The owner `./setup` made, `CLUENORI_OWNER`, listed when the engine starts; and the platform's Web
Crypto, which checks passkeys.

## Decisions and constraints

- **Passkeys, no passwords** (`concept/Platform.md`): the browser keeps them, in iCloud Keychain or
  another manager; a passkey belongs to the site's hostname, so one made on workers.dev doesn't
  sign in at a custom domain.
- **The invitation's code is in the link's fragment,** `/invite#<code>`, so it never reaches a
  server's logs; the page sends it in a body.
- **Unknown passkeys and bad answers fail the same way,** `PasskeyRejected`; why goes to the log.
- **A browser signed in with the API token has no sign-in record,** so the list doesn't show it.
