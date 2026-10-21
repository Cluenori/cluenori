import { MemberId, ProjectKey } from "@cluenori/foundation"
import { Email } from "@cluenori/members"
import { Console, Effect } from "effect"
import { Argument, Command, Flag } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import { apiTarget } from "./api-settings.ts"
import { local, parsed } from "./question.ts"
import { columns, utcMinute } from "./terminal-text.ts"

const projectsFlag = Flag.String("projects").pipe(
  Flag.withDescription("The projects they see, by key, separated by commas: notes,atlas."),
)

// The projects a comma-separated flag names, each checked as a project key.
const projectsOf = (text: string) =>
  Effect.forEach(
    text
      .split(",")
      .map((key) => key.trim())
      .filter((key) => key !== ""),
    (key) => parsed(ProjectKey, key, "a project key"),
  )

/** `cluenori members`. */
export const members = Command.make("members", { local }, (input) =>
  Effect.gen(function* () {
    const target = yield* apiTarget(input.local)
    const client = yield* apiClient(target)
    const list = yield* client.members.members().pipe(
      Effect.catchTags({
        ...reachFailures(target),
        NotAllowed: () => refuse("Only an owner sees the members."),
      }),
    )
    yield* Console.log(
      columns([
        ["Member", "Role", "Sees", "Passkeys", "Added", "ID"],
        ...list.members.map((member) => [
          member.email ?? "you",
          member.role,
          member.projects === undefined ? "every project" : member.projects.join(", "),
          String(member.passkeys),
          utcMinute(member.addedAt),
          member.id,
        ]),
      ]).join("\n"),
    )
  }),
).pipe(Command.withDescription("The deployment's members, and the projects each sees."))

/** `cluenori member invite <email> --projects <keys>`. */
export const memberInvite = Command.make(
  "invite",
  {
    email: Argument.String("email").pipe(Argument.withDescription("Their email address.")),
    projects: projectsFlag,
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const email = yield* parsed(Email, input.email.trim().toLowerCase(), "an email address")
      const projects = yield* projectsOf(input.projects)
      if (projects.length === 0) {
        return yield* refuse("Name the projects they see: --projects notes,atlas")
      }
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const invite = yield* client.members.invite({ payload: { email, projects } }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          NotAllowed: () => refuse("Only an owner invites."),
          MemberExists: () => refuse(`${email} is a member already. To invite them again, remove them first.`),
          ProjectNotFound: (missing) => refuse(`${target.url} has no project ${missing.project}.`),
        }),
      )
      yield* Console.log(
        `Send ${email} this link, by ${utcMinute(invite.expiresAt)}. It makes their passkey and signs them in, once:\n\n${invite.link}`,
      )
    }),
).pipe(Command.withDescription("Invite someone to see some projects: a link, good once for 7 days."))

/** `cluenori member projects <member> --projects <keys>`. */
export const memberProjects = Command.make(
  "projects",
  {
    member: Argument.String("member").pipe(Argument.withDescription("The member's ID, from ./cluenori members.")),
    projects: projectsFlag,
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const id = yield* parsed(MemberId, input.member, "a member's ID")
      const projects = yield* projectsOf(input.projects)
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const member = yield* client.members.setProjects({ params: { member: id }, payload: { projects } }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          NotAllowed: () => refuse("Only an owner changes what a member sees, and an owner sees everything."),
          MemberNotFound: () => refuse(`${target.url} has no member ${id}. See them: ./cluenori members`),
          ProjectNotFound: (missing) => refuse(`${target.url} has no project ${missing.project}.`),
        }),
      )
      yield* Console.log(
        `${member.email ?? id} sees ${member.projects === undefined || member.projects.length === 0 ? "no project" : member.projects.join(", ")}.`,
      )
    }),
).pipe(Command.withDescription("Set the projects a member sees."))

/** `cluenori member remove <member>`. */
export const memberRemove = Command.make(
  "remove",
  {
    member: Argument.String("member").pipe(Argument.withDescription("The member's ID, from ./cluenori members.")),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const id = yield* parsed(MemberId, input.member, "a member's ID")
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      yield* client.members.removeMember({ params: { member: id } }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          NotAllowed: () => refuse("Only an owner removes members, and an owner can't be removed."),
          MemberNotFound: () => refuse(`${target.url} has no member ${id}. See them: ./cluenori members`),
        }),
      )
      yield* Console.log("Removed. Their passkeys, their browsers' sign-ins and their phones stopped working.")
    }),
).pipe(Command.withDescription("Remove a member: their passkeys, sign-ins and phones stop working at once."))

/** `cluenori member ...`. */
export const member = Command.make("member").pipe(
  Command.withDescription("Invite members, change what they see, and remove them."),
  Command.withSubcommands([memberInvite, memberProjects, memberRemove]),
)
