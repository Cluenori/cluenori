import type { ProjectKey } from "@cluenori/foundation"
import type { Invite, Member } from "@cluenori/members"
import { Email } from "@cluenori/members"
import type { Project } from "@cluenori/projects"
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import { DateTime, Option, Schema } from "effect"
import { Atom, AsyncResult } from "effect/reactivity"
import { CheckIcon, Trash2Icon, UserPlusIcon, UsersIcon } from "lucide-react"
import { useState } from "react"

import { moment } from "@/lib/format"
import { inviteAtom, membersAtom, projectsAtom, removeMemberAtom, setProjectsAtom } from "@/project-data"
import { failureText, Loaded } from "@/views/loaded"
import { Panel } from "@/views/panel"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/views/ui/alert-dialog"
import { Button } from "@/views/ui/button"
import { Checkbox } from "@/views/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/views/ui/dialog"
import { Input } from "@/views/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/views/ui/table"

const decodeEmail = Schema.decodeUnknownOption(Email)

// The deployment's projects, or none while they load.
const useProjects = (): ReadonlyArray<Project> => {
  const projects = useAtomValue(projectsAtom)
  return AsyncResult.isSuccess(projects) ? projects.value.projects : []
}

/** A checkbox for each project, the chosen ones checked. */
function ProjectChoice({
  projects,
  chosen,
  onChange,
}: {
  readonly projects: ReadonlyArray<Project>
  readonly chosen: ReadonlySet<ProjectKey>
  readonly onChange: (chosen: ReadonlySet<ProjectKey>) => void
}) {
  return (
    <fieldset className="flex flex-col gap-2.5">
      <legend className="mb-2.5 text-sm">Projects they see</legend>
      {projects.map((project) => (
        <label key={project.key} className="flex items-center gap-2.5 text-[15px]">
          <Checkbox
            checked={chosen.has(project.key)}
            onCheckedChange={(checked) => {
              const next = new Set(chosen)
              if (checked) {
                next.add(project.key)
              } else {
                next.delete(project.key)
              }
              onChange(next)
            }}
          />
          {project.name}
          <span className="font-mono text-sm text-muted-foreground">{project.key}</span>
        </label>
      ))}
    </fieldset>
  )
}

function CopyLink({ link }: { readonly link: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant="outline"
      size="sm"
      className="self-start"
      onClick={() => {
        void navigator.clipboard.writeText(link).then(() => setCopied(true))
      }}
    >
      {copied ? <CheckIcon data-icon="inline-start" /> : null}
      {copied ? "Copied" : "Copy the link"}
    </Button>
  )
}

/** The invitation made: the link to send, until when it works. */
function Invited({ invite, email }: { readonly invite: Invite; readonly email: string }) {
  return (
    <div className="flex flex-col gap-4 px-5 py-6">
      <p className="text-[15px]">
        Send <span className="font-medium">{email}</span> this link. It works once, until{" "}
        {moment(DateTime.toEpochMillis(invite.expiresAt))}, and makes their passkey.
      </p>
      <pre className="overflow-x-auto border bg-background px-3 py-2 font-mono text-sm">{invite.link}</pre>
      <CopyLink link={invite.link} />
    </div>
  )
}

/** Inviting someone: their email and the projects they see, then the link to send them. */
function InviteSomeone({ onClose }: { readonly onClose: () => void }) {
  const projects = useProjects()
  const [result, invite] = useAtom(inviteAtom)
  const close = () => {
    // The next invitation starts empty.
    invite(Atom.Reset)
    onClose()
  }
  const [email, setEmail] = useState("")
  const [chosen, setChosen] = useState<ReadonlySet<ProjectKey>>(new Set())
  const valid = decodeEmail(email.trim().toLowerCase())
  return (
    <Panel
      icon={UserPlusIcon}
      title="Invite someone"
      subtitle="They see the projects you choose, and sign in with a passkey"
      action={
        <Button variant="ghost" size="sm" onClick={close}>
          {AsyncResult.isSuccess(result) ? "Done" : "Cancel"}
        </Button>
      }
    >
      {AsyncResult.isSuccess(result) ? (
        <Invited invite={result.value} email={email.trim().toLowerCase()} />
      ) : (
        <form
          className="flex max-w-xl flex-col gap-5 px-5 py-6"
          onSubmit={(event) => {
            event.preventDefault()
            if (Option.isSome(valid) && chosen.size > 0) {
              invite({ email: valid.value, projects: [...chosen] })
            }
          }}
        >
          <label htmlFor="invite-email" className="flex flex-col gap-2 text-sm">
            Email
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="ada@example.com"
            />
          </label>
          <ProjectChoice projects={projects} chosen={chosen} onChange={setChosen} />
          {AsyncResult.isFailure(result) && (
            <p role="alert" className="text-sm text-failure">
              {failureText(result.cause)}
            </p>
          )}
          <Button
            type="submit"
            className="self-start"
            disabled={result.waiting || Option.isNone(valid) || chosen.size === 0}
          >
            {result.waiting ? "Making the link…" : "Make the invitation link"}
          </Button>
        </form>
      )}
    </Panel>
  )
}

function ChangeProjects({ member }: { readonly member: Member }) {
  const projects = useProjects()
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<ReadonlySet<ProjectKey>>(new Set(member.projects ?? []))
  const save = useAtomSet(setProjectsAtom)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setChosen(new Set(member.projects ?? []))
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Change projects</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>What {member.email} sees</DialogTitle>
          <DialogDescription>
            They see these projects&apos; data, incidents and alerts, and nothing else.
          </DialogDescription>
        </DialogHeader>
        <ProjectChoice projects={projects} chosen={chosen} onChange={setChosen} />
        <DialogFooter>
          <Button
            onClick={() => {
              setOpen(false)
              save({ member: member.id, projects: [...chosen] })
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RemoveMember({ member }: { readonly member: Member }) {
  const [open, setOpen] = useState(false)
  const remove = useAtomSet(removeMemberAtom)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>Remove</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>Remove {member.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            Their passkeys, their browsers&apos; sign-ins and their phones stop working at once. To let them in again,
            invite them again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep the member</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              setOpen(false)
              remove(member.id)
            }}
          >
            Remove the member
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// The projects a member sees, by their names.
function Sees({ member, nameOf }: { readonly member: Member; readonly nameOf: (key: ProjectKey) => string }) {
  if (member.projects === undefined) {
    return <span className="text-muted-foreground">Every project</span>
  }
  if (member.projects.length === 0) {
    return <span className="text-muted-foreground">No project</span>
  }
  return <>{member.projects.map(nameOf).join(", ")}</>
}

function MemberTable({ members }: { readonly members: ReadonlyArray<Member> }) {
  const projects = useProjects()
  const nameOf = (key: ProjectKey) => projects.find((project) => project.key === key)?.name ?? key
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-5">Member</TableHead>
          <TableHead>Sees</TableHead>
          <TableHead>Passkeys</TableHead>
          <TableHead>Joined</TableHead>
          <TableHead className="pr-5">
            <span className="sr-only">Change</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.id}>
            <TableCell className="pl-5">
              <span className="flex flex-col">
                <span className="font-medium">{member.email ?? "You"}</span>
                {member.role === "owner" && <span className="text-sm text-muted-foreground">Owner</span>}
              </span>
            </TableCell>
            <TableCell className="whitespace-normal">
              <Sees member={member} nameOf={nameOf} />
            </TableCell>
            <TableCell className="font-mono">{member.passkeys}</TableCell>
            <TableCell className="text-muted-foreground">{moment(DateTime.toEpochMillis(member.addedAt))}</TableCell>
            <TableCell className="pr-5 text-right">
              {member.role === "member" && (
                <span className="inline-flex gap-1">
                  <ChangeProjects member={member} />
                  <RemoveMember member={member} />
                </span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** The deployment's members, the projects each sees, and inviting more. Owners only. */
export function MembersPage() {
  const members = useAtomValue(membersAtom)
  const [inviting, setInviting] = useState(false)
  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 pb-2">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Members</h1>
          <p className="text-sm text-muted-foreground">Who signs in, and the projects each sees</p>
        </div>
        {!inviting && (
          <Button className="ml-auto" onClick={() => setInviting(true)}>
            Invite someone
          </Button>
        )}
      </header>

      {inviting && <InviteSomeone key="invite" onClose={() => setInviting(false)} />}

      <Panel icon={UsersIcon} title="Members" subtitle="Owners see every project; members, the ones chosen">
        <Loaded result={members}>{({ members: list }) => <MemberTable members={list} />}</Loaded>
      </Panel>
    </div>
  )
}
