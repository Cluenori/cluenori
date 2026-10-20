import { useAtom } from "@effect/atom-react"
import { Cause, Option } from "effect"
import { AsyncResult } from "effect/reactivity"
import { useState } from "react"

import { signInAtom } from "@/project-data"
import { failureText } from "@/views/loaded"
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

/**
 * Signing this browser in with the deployment's API token, which the dashboard keeps as a cookie its
 * scripts can't read; the token itself isn't stored in the page.
 */
export function SignIn() {
  const [result, signIn] = useAtom(signInAtom)
  const [token, setToken] = useState("")
  return (
    <main className="grid min-h-svh place-items-center bg-background p-4">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          signIn(token.trim())
        }}
        className="flex w-full max-w-md flex-col gap-5 border bg-card p-6"
      >
        <div className="flex items-center gap-2.5">
          <span className="grid size-7 place-items-center bg-primary font-mono text-sm font-semibold text-primary-foreground">
            C
          </span>
          <h1 className="text-lg font-semibold">Sign in to Cluenori</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          With the deployment&apos;s API token: <span className="font-mono">token</span> in{" "}
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
        <Button type="submit" disabled={result.waiting} className="self-start">
          {result.waiting ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </main>
  )
}
