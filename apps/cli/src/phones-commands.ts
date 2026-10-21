import { PhoneId } from "@cluenori/phones"
import { Console, Effect, Option } from "effect"
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

// What to do about each of Apple's reasons people can fix.
const rejectionHints: Readonly<Record<string, string>> = {
  BadDeviceToken:
    "The phone's token is for the other APNs: a build Xcode installs uses development, TestFlight production. Open the app on the phone again.",
  InvalidProviderToken: "The key ID or the team ID is wrong: ./cluenori push setup again.",
  InvalidSigningKey: "The key isn't an APNs key: ./cluenori push setup again with the .p8 file.",
  TopicDisallowed: "The key's team doesn't own the app: check --app and --team in ./cluenori push setup.",
  BadTopic: "The bundle ID is wrong: ./cluenori push setup again with the app's.",
}

/** `cluenori phone test-alert [phone]`. */
export const phoneTestAlert = Command.make(
  "test-alert",
  {
    phone: Argument.String("phone").pipe(
      Argument.optional,
      Argument.withDescription("The phone's ID, from ./cluenori phones; not needed when one is paired."),
    ),
    local,
  },
  (input) =>
    Effect.gen(function* () {
      const target = yield* apiTarget(input.local)
      const client = yield* apiClient(target)
      const id = Option.isSome(input.phone)
        ? yield* parsed(PhoneId, input.phone.value, "a phone's ID")
        : yield* client.phones.phones().pipe(
            Effect.catchTags(reachFailures(target)),
            Effect.flatMap(({ phones: listed }) =>
              listed.length === 1 && listed[0] !== undefined
                ? Effect.succeed(listed[0].id)
                : refuse(
                    listed.length === 0
                      ? `No phones are paired with ${target.url}. Pair one: ./cluenori phone pair`
                      : "More than one phone is paired: give the ID of one, from ./cluenori phones.",
                  ),
            ),
          )
      yield* client.notifications.testAlert({ params: { phone: id } }).pipe(
        Effect.catchTags({
          ...reachFailures(target),
          PushNotSetUp: () =>
            refuse(
              `Push isn't set up on ${target.url}: ./cluenori push setup <AuthKey_….p8> --team <team ID> --app <bundle ID>`,
            ),
          NoPushToken: () =>
            refuse(
              "That phone hasn't registered for pushes: open the Cluenori app on it, and allow notifications. A removed phone has none either.",
            ),
          PushRejected: (rejected) =>
            refuse(`APNs refused the test alarm: ${rejected.reason}. ${rejectionHints[rejected.reason] ?? ""}`.trim()),
          PushUnavailable: (unavailable) =>
            refuse(`APNs didn't take the test alarm now (${unavailable.reason}). Try again in a minute.`),
        }),
      )
      yield* Console.log("APNs took the test alarm: the phone rings within seconds. Acknowledge stops it.")
    }),
).pipe(Command.withDescription("Ring a phone with a test alarm, as a project that is down would."))

/** `cluenori phone ...`. */
export const phone = Command.make("phone").pipe(
  Command.withDescription("Pair and remove phones, and ring one with a test alarm."),
  Command.withSubcommands([phonePair, phoneRemove, phoneTestAlert]),
)
