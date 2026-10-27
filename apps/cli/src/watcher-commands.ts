import { Repository } from "@cluenori/github"
import type { DateTime } from "effect"
import { Console, Effect } from "effect"
import { Argument, Command } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import { apiTarget } from "./api-settings.ts"
import { local, parsed } from "./question.ts"
import { utcMinute } from "./terminal-text.ts"

// What the watcher's status says, in lines: the repository, what its secrets hold, what is wrong.
const statusLines = (status: {
  readonly repository?: string
  readonly phones?: number
  readonly writtenAt?: DateTime.Utc
  readonly problem?: string
}) => [
  status.repository === undefined
    ? "No outside watcher yet. Name its repository: ./cluenori watcher set <owner/name>"
    : `The outside watcher runs in ${status.repository}.`,
  ...(status.writtenAt === undefined || status.phones === undefined
    ? []
    : [
        `Its secrets hold ${status.phones === 1 ? "1 owner's phone" : `${status.phones} owners' phones`}, written ${utcMinute(status.writtenAt)}.`,
      ]),
  ...(status.problem === undefined ? [] : [`Problem: ${status.problem}`]),
]

/** `cluenori watcher`. */
export const watcherStatus = Command.make("status", { local }, (input) =>
  Effect.gen(function* () {
    const target = yield* apiTarget(input.local)
    const client = yield* apiClient(target)
    const status = yield* client.watcher
      .watcher()
      .pipe(Effect.catchTags({ ...reachFailures(target), NotAllowed: () => refuse("Only an owner sees the watcher.") }))
    yield* Console.log(statusLines(status).join("\n"))
  }),
).pipe(Command.withDescription("The outside watcher: its repository, and when its secrets were last written."))

/** `cluenori watcher set <owner/name>`. */
export const watcherSet = Command.make(
  "set",
  {
    repository: Argument.String("repository").pipe(
      Argument.withDescription("The watcher's repository, owner/name, such as octo-org/cluenori-watch."),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const repository = yield* parsed(Repository, input.repository.trim(), "a repository, owner/name")
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const status = yield* client.watcher
        .setWatcher({ payload: { repository } })
        .pipe(
          Effect.catchTags({ ...reachFailures(target), NotAllowed: () => refuse("Only an owner names the watcher.") }),
        )
      yield* Console.log(statusLines(status).join("\n"))
    }),
).pipe(
  Command.withDescription(
    "Name the outside watcher's repository: Cluenori writes the APNs key and its owners' push tokens there as Actions secrets, through its GitHub App, and again whenever they change.",
  ),
)

/** `cluenori watcher ...`. */
export const watcher = Command.make("watcher").pipe(
  Command.withDescription("The outside watcher, which alerts owners when this deployment is down."),
  Command.withSubcommands([watcherStatus, watcherSet]),
)
