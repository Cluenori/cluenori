import { Schema } from "effect"

/** A full commit SHA: 40 lowercase hex characters, as GitHub writes them. */
export const CommitSha = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}$/, { expected: "a full commit SHA: 40 lowercase hex characters" }),
).pipe(Schema.brand("CommitSha"))
export type CommitSha = typeof CommitSha.Type
