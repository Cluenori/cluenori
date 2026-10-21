import { useAtom } from "@effect/atom-react"
import { Cause, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { KeyRoundIcon } from "lucide-react"
import { useState } from "react"

import { signInAtom, signInWithPasskeyAtom } from "@/project-data"
import { failureText } from "@/views/loaded"
import { passkeyProblem } from "@/views/passkey-problems"
import { Button } from "@/views/ui/button"

// The API says why a token was refused in a sentence of its own, such as "The API token is wrong.";
// anything else is the API not answering.
const refusalOf = (cause: Cause.Cause<unknown>) => {
  const error = Cause.findErrorOption(cause)
  return Option.isSome(error) &&
    typeof error.value === "object" &&
    error.value !== null &&
    "_tag" in error.value &&
    error.value._tag === "Unauthorized" &&
    "message" in error.value &&
    typeof error.value.message === "string"
    ? error.value.message
    : failureText(cause)
}

/** Signing in with the deployment's API token: an owner's way in, kept as a cookie the page can't read. */
function WithApiToken() {
  const [result, signIn] = useAtom(signInAtom)
  const [token, setToken] = useState("")
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        signIn(token.trim())
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-sm text-muted-foreground">
        <span className="font-mono">token</span> in{" "}
        <span className="font-mono">~/.config/cluenori/deployment.json</span> on the computer that set it up, or{" "}
        <span className="font-mono">CLUENORI_API_TOKEN</span> in{" "}
        <span className="font-mono">apps/worker/.dev.vars</span> when it runs with{" "}
        <span className="font-mono">./run</span>.
      </p>
      <label className="flex flex-col gap-2 text-sm">
        API token
        <input
          type="password"
          autoComplete="current-password"
          required
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="h-10 border bg-background px-3 font-mono outline-none focus:border-ring"
        />
      </label>
      {AsyncResult.isFailure(result) && (
        <p role="alert" className="text-sm text-failure">
          {refusalOf(result.cause)}
        </p>
      )}
      <Button type="submit" variant="outline" disabled={result.waiting} className="self-start">
        {result.waiting ? "Signing in…" : "Sign in with the token"}
      </Button>
    </form>
  )
}

/**
 * Signing this browser in: with a passkey, which the browser asks the person to pick and confirm, or
 * with the deployment's API token, an owner's way in. Either way the browser keeps a cookie its
 * scripts can't read.
 */
export function SignIn() {
  const [result, signIn] = useAtom(signInWithPasskeyAtom)
  const [withToken, setWithToken] = useState(false)
  return (
    <main className="grid min-h-svh place-items-center bg-background p-4">
      <div className="flex w-full max-w-md flex-col gap-5 border bg-card p-6">
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center bg-primary font-mono text-sm font-semibold text-primary-foreground">
            C
          </span>
          <h1 className="text-lg font-semibold">Sign in to Cluenori</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          With your passkey: Face ID, Touch ID, or your device&apos;s PIN.
        </p>
        <Button onClick={() => signIn()} disabled={result.waiting} className="self-start">
          <KeyRoundIcon data-icon="inline-start" />
          {result.waiting ? "Waiting for the passkey…" : "Sign in with a passkey"}
        </Button>
        {AsyncResult.isFailure(result) && (
          <p role="alert" className="text-sm text-failure">
            {passkeyProblem(result.cause)}
          </p>
        )}
        <div className="border-t pt-4">
          {withToken ? (
            <WithApiToken />
          ) : (
            <Button variant="link" className="h-auto p-0 text-muted-foreground" onClick={() => setWithToken(true)}>
              Use the API token instead
            </Button>
          )}
        </div>
      </div>
    </main>
  )
}
