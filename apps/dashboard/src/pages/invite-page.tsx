import { InviteCode } from "@cluenori/members"
import { useAtom, useAtomValue } from "@effect/atom-react"
import { Option, Schema } from "effect"
import { AsyncResult } from "effect/reactivity"
import { KeyRoundIcon } from "lucide-react"
import { useEffect } from "react"

import { invitationAtom, joinAtom } from "@/project-data"
import { navigate } from "@/router"
import { passkeyProblem } from "@/views/passkey-problems"
import { Button } from "@/views/ui/button"

const decodeCode = Schema.decodeUnknownOption(InviteCode)

function Frame({ children }: { readonly children: React.ReactNode }) {
  return (
    <main className="grid min-h-svh place-items-center bg-background p-4">
      <div className="flex w-full max-w-md flex-col gap-5 border bg-card p-6">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center bg-primary font-mono text-sm font-semibold text-primary-foreground">
            C
          </span>
          <h1 className="text-lg font-semibold">Join Cluenori</h1>
        </div>
        {children}
      </div>
    </main>
  )
}

function Join({ code }: { readonly code: InviteCode }) {
  const invitation = useAtomValue(invitationAtom(code))
  const [joined, join] = useAtom(joinAtom)

  // Joined and signed in: on to the projects, without the invitation in the history.
  useEffect(() => {
    if (AsyncResult.isSuccess(joined)) {
      navigate({ page: "now" }, { replace: true })
    }
  }, [joined])

  if (AsyncResult.isFailure(invitation)) {
    return (
      <p role="alert" className="text-[15px] text-failure">
        {passkeyProblem(invitation.cause)}
      </p>
    )
  }
  if (!AsyncResult.isSuccess(invitation)) {
    return (
      <p aria-busy className="text-sm text-muted-foreground">
        Opening the invitation…
      </p>
    )
  }
  return (
    <>
      <p className="text-[15px]">
        You&apos;re invited as <span className="font-medium">{invitation.value.user.name}</span>.
      </p>
      <p className="text-sm text-muted-foreground">
        Make a passkey to sign in. It stays in your password manager, such as iCloud Keychain, and Face ID, Touch ID or
        your device&apos;s PIN unlocks it. There is no password.
      </p>
      {AsyncResult.isFailure(joined) && (
        <p role="alert" className="text-sm text-failure">
          {passkeyProblem(joined.cause)}
        </p>
      )}
      <Button onClick={() => join(code)} disabled={joined.waiting} className="self-start">
        <KeyRoundIcon data-icon="inline-start" />
        {joined.waiting ? "Making the passkey…" : "Make a passkey"}
      </Button>
    </>
  )
}

/**
 * Accepting an invitation, `/invite#<code>`: the code stays in the browser's address, never sent in
 * one. Making a passkey joins and signs this browser in.
 */
export function InvitePage() {
  const code = decodeCode(window.location.hash.slice(1))
  return (
    <Frame>
      {Option.isSome(code) ? (
        <Join code={code.value} />
      ) : (
        <p role="alert" className="text-[15px] text-failure">
          This link isn&apos;t a whole invitation. Open it again from the message it came in.
        </p>
      )}
    </Frame>
  )
}
