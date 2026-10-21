import { Cause, Option } from "effect"

import { failureText } from "@/views/loaded"

// The tag of the error a cause failed with, if it failed with a tagged one.
const tagOf = (cause: Cause.Cause<unknown>) => {
  const error = Cause.findErrorOption(cause)
  return Option.isSome(error) && typeof error.value === "object" && error.value !== null && "_tag" in error.value
    ? { tag: String(error.value._tag), error: error.value }
    : undefined
}

/**
 * What to tell the person when a passkey ceremony didn't end in one: in the browser, at the
 * deployment, or with an invitation that is no longer open. Anything else says what any call says.
 */
export const passkeyProblem = (cause: Cause.Cause<unknown>) => {
  const failed = tagOf(cause)
  if (failed?.tag === "PasskeyNotMade") {
    const reason = "reason" in failed.error ? failed.error.reason : undefined
    if (reason === "unsupported") {
      return "This browser can't use passkeys. Use Safari, Chrome, Edge or Firefox."
    }
    if (reason === "exists") {
      return "This device has a passkey for Cluenori already. Sign in with it instead."
    }
    return "No passkey was used. Try again when you're ready."
  }
  if (failed?.tag === "PasskeyRejected") {
    return "That passkey didn't work here: it may be another deployment's. Try another, or ask for an invitation."
  }
  if (failed?.tag === "InviteRejected") {
    return "This invitation is used, or older than 7 days. Ask for a new one."
  }
  return failureText(cause)
}
