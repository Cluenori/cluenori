import type { Member, SignIn } from "@cluenori/members"
import { useAtom, useAtomSet, useAtomValue } from "@effect/atom-react"
import { DateTime } from "effect"
import { AsyncResult } from "effect/reactivity"
import { CheckIcon, KeyRoundIcon, LogOutIcon, MonitorIcon } from "lucide-react"
import { useState } from "react"

import { ago, countryName, moment } from "@/lib/format"
import { addPasskeyAtom, endSignInAtom, meAtom, membersAtom, signInsAtom } from "@/project-data"
import { navigate } from "@/router"
import { Loaded } from "@/views/loaded"
import { Panel } from "@/views/panel"
import { passkeyProblem } from "@/views/passkey-problems"
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/views/ui/table"

const clockNow = () => DateTime.toEpochMillis(DateTime.nowUnsafe())

function SignOut({ signIn }: { readonly signIn: SignIn }) {
  const [open, setOpen] = useState(false)
  const end = useAtomSet(endSignInAtom)
  const name = signIn.browser ?? "this browser"
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>Sign out</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-destructive/10 text-destructive">
            <LogOutIcon />
          </AlertDialogMedia>
          <AlertDialogTitle>{signIn.current ? "Sign out here?" : `Sign out ${name}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            {signIn.current
              ? "This browser stops showing your projects. Your passkey signs you in again."
              : "It stops showing the projects at once. Its passkey still signs in again."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay signed in</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => {
              setOpen(false)
              end(signIn.id)
              if (signIn.current) {
                // Signed out here: the start shows the sign-in.
                navigate({ page: "start" }, { replace: true })
                window.location.reload()
              }
            }}
          >
            Sign out
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function BrowserTable({
  signIns,
  members,
}: {
  readonly signIns: ReadonlyArray<SignIn>
  /** Each member's email, for an owner, who sees every member's browsers; undefined for a member. */
  readonly members: ReadonlyArray<Member> | undefined
}) {
  const now = clockNow()
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-5">Browser</TableHead>
          {members !== undefined && <TableHead>Member</TableHead>}
          <TableHead>Last seen</TableHead>
          <TableHead>Signed in</TableHead>
          <TableHead className="pr-5">
            <span className="sr-only">Sign out</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {signIns.map((signIn) => (
          <TableRow key={signIn.id}>
            <TableCell className="pl-5">
              <span className="flex flex-col">
                <span className="font-medium">{signIn.browser ?? "A browser"}</span>
                {signIn.current && <span className="text-sm text-mint">This browser</span>}
              </span>
            </TableCell>
            {members !== undefined && (
              <TableCell>{members.find((member) => member.id === signIn.member)?.email ?? "You"}</TableCell>
            )}
            <TableCell>
              <span className="flex flex-col">
                <span>{ago(DateTime.toEpochMillis(signIn.seenAt), now)}</span>
                {(signIn.address !== undefined || signIn.country !== undefined) && (
                  <span className="text-muted-foreground">
                    {[signIn.address, signIn.country && countryName(signIn.country)]
                      .filter((part) => part !== undefined && part !== "")
                      .join(", ")}
                  </span>
                )}
              </span>
            </TableCell>
            <TableCell className="text-muted-foreground">{moment(DateTime.toEpochMillis(signIn.signedInAt))}</TableCell>
            <TableCell className="pr-5 text-right">
              <SignOut signIn={signIn} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** Adding a passkey on this device: what happened, once it has. */
function AddPasskey() {
  const [result, add] = useAtom(addPasskeyAtom)
  return (
    <div className="ml-auto flex flex-col items-end gap-2">
      <Button onClick={() => add()} disabled={result.waiting}>
        <KeyRoundIcon data-icon="inline-start" />
        {result.waiting ? "Adding…" : "Add a passkey"}
      </Button>
      {AsyncResult.isSuccess(result) && (
        <p className="flex items-center gap-1.5 text-sm text-mint">
          <CheckIcon className="size-4" />
          Added. Sign in with it next time.
        </p>
      )}
      {AsyncResult.isFailure(result) && (
        <p role="alert" className="max-w-sm text-right text-sm text-failure">
          {passkeyProblem(result.cause)}
        </p>
      )}
    </div>
  )
}

/**
 * The browsers signed in with passkeys, what each is, and when and where it last called, each with a
 * way to sign it out; and adding a passkey on this device. An owner sees every member's browsers.
 */
export function BrowsersPage() {
  const signIns = useAtomValue(signInsAtom)
  const me = useAtomValue(meAtom)
  const owner = AsyncResult.isSuccess(me) && me.value.role === "owner"
  const members = useAtomValue(membersAtom)
  const listedMembers = owner && AsyncResult.isSuccess(members) ? members.value.members : undefined
  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-start gap-x-6 gap-y-3 pb-2">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Browsers</h1>
          <p className="text-sm text-muted-foreground">
            {owner ? "Where members are signed in with passkeys" : "Where you're signed in with a passkey"}
          </p>
        </div>
        <AddPasskey />
      </header>

      <Panel
        icon={MonitorIcon}
        title="Signed in"
        subtitle="The latest seen first, with when and where each last called"
      >
        <Loaded result={signIns}>
          {({ signIns: list }) =>
            list.length === 0 ? (
              <div className="flex flex-col items-start gap-3 px-5 py-6">
                <p className="text-[15px]">No browser is signed in with a passkey.</p>
                <p className="text-sm text-muted-foreground">
                  This one signed in with the API token. Add a passkey to sign in with Face ID or Touch ID instead.
                </p>
              </div>
            ) : (
              <BrowserTable signIns={list} members={listedMembers} />
            )
          }
        </Loaded>
      </Panel>
    </div>
  )
}
