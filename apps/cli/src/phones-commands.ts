import { PhoneId } from "@cluenori/phones"
import { Console, Effect } from "effect"
import { Argument, Command } from "effect/cli"

import { apiClient, reachFailures, refuse } from "./api-client.ts"
import { apiTarget } from "./api-settings.ts"
import { local, parsed } from "./question.ts"
import { columns, utcMinute } from "./terminal-text.ts"

/** `cluenori phones`. */
export const phones = Command.make("phones", { local }, (input) =>
  Effect.gen(function* () {
    const target = yield* apiTarget(input.local)
    const client = yield* apiClient(target)
    const list = yield* client.phones.phones().pipe(Effect.catchTags(reachFailures(target)))
    if (list.phones.length === 0) {
      return yield* Console.log(`No phones are paired with ${target.url}. Pair one: ./cluenori phone pair`)
    }
    yield* Console.log(
      columns([
        ["Phone", "iOS", "App", "Last seen", "From", "ID"],
        ...list.phones.map((phone) => [
          phone.modelName,
          phone.systemVersion,
          phone.appVersion,
          phone.lastSeen === undefined ? "not yet" : utcMinute(phone.lastSeen.at),
          [phone.lastSeen?.address, phone.lastSeen?.country].filter((part) => part !== undefined).join(", "),
          phone.id,
        ]),
      ]).join("\n"),
    )
  }),
).pipe(Command.withDescription("The phones paired with the deployment, and when and where each last called."))

/** `cluenori phone pair`. */
export const phonePair = Command.make("pair", { local }, (input) =>
  Effect.gen(function* () {
    const target = yield* apiTarget(input.local)
    const client = yield* apiClient(target)
    const pairing = yield* client.phones.startPairing().pipe(Effect.catchTags(reachFailures(target)))
    yield* Console.log(
      `Open this link on the phone, with the Cluenori app installed, by ${utcMinute(pairing.expiresAt)}. It pairs one phone, for you:\n\n${pairing.link}`,
    )
  }),
).pipe(Command.withDescription("A link that pairs a phone with the deployment, good once for 10 minutes."))

/** `cluenori phone remove <phone>`. */
export const phoneRemove = Command.make(
  "remove",
  {
    phone: Argument.String("phone").pipe(Argument.withDescription("The phone's ID, from ./cluenori phones.")),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const id = yield* parsed(PhoneId, input.phone, "a phone's ID")
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      yield* client.phones.removePhone({ params: { phone: id } }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          PhoneNotFound: () => refuse(`${target.url} has no phone ${id}. See them: ./cluenori phones`),
        }),
      )
      yield* Console.log("Removed the phone. Its key stopped working; to use it again, pair it again.")
    }),
).pipe(Command.withDescription("Remove a paired phone, whose key stops working at once."))

/** `cluenori phone ...`. */
export const phone = Command.make("phone").pipe(
  Command.withDescription("Pair and remove phones."),
  Command.withSubcommands([phonePair, phoneRemove]),
)
