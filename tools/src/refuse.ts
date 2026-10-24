import { Console, Effect, Schema } from "effect"

/** A command refused, and has printed why. */
export class Refused extends Schema.TaggedError<Refused>()("Refused", { message: Schema.String }) {}

/** Prints `message` for the person at the terminal and fails, so the command exits with code 1. */
export const refuse = (message: string) => Console.error(message).pipe(Effect.andThen(new Refused({ message })))
