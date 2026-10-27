// How a command-line program decides whether to send its telemetry, and how it tells the person: the
// conventions people expect of a CLI. It sends only to the deployment it is configured for, says so
// the first time, and stops when asked, by its own setting or by `DO_NOT_TRACK`.

/** Whether a program's telemetry is on, and why: the variable that turned it off, if one did. */
export type TelemetryChoice =
  | { readonly _tag: "On" }
  | { readonly _tag: "Off"; readonly because: "DO_NOT_TRACK" | "CLUENORI_TELEMETRY" }

const off = new Set(["0", "false", "off", "no"])

/**
 * The choice the environment makes, from the variables a program passes: `CLUENORI_TELEMETRY` of
 * `0`, `false`, `off` or `no`, or `DO_NOT_TRACK` set to anything but `0` or empty, turn it off.
 */
export const telemetryChoice = (environment: Readonly<Record<string, string | undefined>>): TelemetryChoice => {
  const dnt = environment["DO_NOT_TRACK"]
  if (dnt !== undefined && dnt !== "" && dnt !== "0") {
    return { _tag: "Off", because: "DO_NOT_TRACK" }
  }
  const setting = environment["CLUENORI_TELEMETRY"]
  if (setting !== undefined && off.has(setting.trim().toLowerCase())) {
    return { _tag: "Off", because: "CLUENORI_TELEMETRY" }
  }
  return { _tag: "On" }
}

/** What a program prints the first time it sends telemetry: what goes, where to, and how to stop it. */
export const telemetryNotice = (program: string, deployment: string) =>
  [
    `${program} sends usage and errors to ${new URL(deployment).origin}, the Cluenori it is set up for, and nowhere else:`,
    "the commands run, how long they took, and errors, with this machine's installation ID. Never arguments, files or output.",
    "Turn it off with CLUENORI_TELEMETRY=off or DO_NOT_TRACK=1.",
  ].join("\n")
