import { MemberId, ProjectKey } from "@cluenori/foundation"
import { Schema } from "effect"

import { Email } from "./member.ts"

/** An owner invited someone to these projects. */
export const MemberInvited = Schema.TaggedStruct("member.invited", {
  email: Email,
  projects: Schema.Array(ProjectKey),
})

/** Someone joined by their invitation, with their first passkey. */
export const MemberJoined = Schema.TaggedStruct("member.joined", { member: MemberId, email: Email })

/** An owner changed the projects a member sees. */
export const MemberProjectsChanged = Schema.TaggedStruct("member.projects_changed", {
  member: MemberId,
  projects: Schema.Array(ProjectKey),
})

/** An owner removed a member: their passkeys and sign-ins stopped working. */
export const MemberRemoved = Schema.TaggedStruct("member.removed", { member: MemberId })

/** A member added a passkey. */
export const PasskeyAdded = Schema.TaggedStruct("passkey.added", { member: MemberId })
