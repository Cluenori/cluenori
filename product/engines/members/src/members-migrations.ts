import { Effect } from "effect"
import { Migrator, SqlClient } from "effect/sql"

/** Creates and updates the engine's tables in the workspace's database. */
export const migrateMembers = Migrator.make({})({
  table: "members_migrations",
  loader: Migrator.fromRecord({
    // Members and the projects each sees; open invitations by their code's digest, with who they are
    // for; passkeys with their public key (SPKI) and counter; the challenges of passkey ceremonies,
    // each good once for 5 minutes; and browsers' sign-ins by ID, with their token's digest, their
    // User-Agent, and when and where from each signed in and was last seen. Times are Unix ms, but
    // when a member was added.
    "0001_members": Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE TABLE members_members (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL,
        email TEXT UNIQUE,
        added_at TEXT NOT NULL
      )`
      yield* sql`CREATE TABLE members_projects (
        member TEXT NOT NULL,
        project TEXT NOT NULL,
        PRIMARY KEY (member, project)
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE members_invites (
        code_digest TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        projects TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE members_passkeys (
        id TEXT PRIMARY KEY,
        member TEXT NOT NULL,
        rp_id TEXT NOT NULL,
        public_key TEXT NOT NULL,
        sign_count INTEGER NOT NULL,
        added_at INTEGER NOT NULL
      ) WITHOUT ROWID`
      yield* sql`CREATE INDEX members_passkeys_member ON members_passkeys (member)`
      yield* sql`CREATE TABLE members_challenges (
        challenge TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        subject TEXT NOT NULL,
        origin TEXT NOT NULL,
        rp_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      ) WITHOUT ROWID`
      yield* sql`CREATE TABLE members_sign_ins (
        id TEXT PRIMARY KEY,
        digest TEXT NOT NULL,
        member TEXT NOT NULL,
        user_agent TEXT,
        signed_in_at INTEGER NOT NULL,
        seen_at INTEGER NOT NULL,
        address TEXT,
        country TEXT,
        expires_at INTEGER NOT NULL
      ) WITHOUT ROWID`
      yield* sql`CREATE INDEX members_sign_ins_member ON members_sign_ins (member)`
    }),
  }),
})
