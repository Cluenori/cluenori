import { Effect, Schema } from "effect"

/** A Schema that needs no services to encode or decode, as every call's do. */
export type PlainSchema = Schema.Top & { readonly DecodingServices: never; readonly EncodingServices: never }

/** One thing the Worker asks a Durable Object: its name, its input, its answer, and how it fails. */
export interface ObjectCall<Name extends string, I extends PlainSchema, S extends PlainSchema, F extends PlainSchema> {
  readonly name: Name
  readonly input: I
  readonly success: S
  readonly error: F
}

export const objectCall = <Name extends string, I extends PlainSchema, S extends PlainSchema, F extends PlainSchema>(
  name: Name,
  input: I,
  success: S,
  error: F,
): ObjectCall<Name, I, S, F> => ({ name, input, success, error })

// Both sides encode with these, as JSON text, so typed values and tagged errors cross a Durable
// Object's RPC boundary, which carries only plain data.

/** A call's input as JSON text. */
export const inputText = <I extends PlainSchema>(input: I) => Schema.fromJsonString(Schema.toCodecJson(input))

/** A call's exit, its answer or its failure, as JSON text. */
export const exitText = <S extends PlainSchema, F extends PlainSchema>(success: S, error: F) =>
  Schema.fromJsonString(Schema.toCodecJson(Schema.Exit(success, error, Schema.Defect())))

/** A Durable Object's stub, as far as calls go: every object the Worker calls has this one method. */
export interface CallsObject<Name extends string> {
  call(name: Name, input: string): Promise<string>
}

/** Sends `call` to `stub` and returns its answer, or fails with its error. One request to the object. */
export const send = Effect.fn("send")(function* <
  Name extends string,
  I extends PlainSchema,
  S extends PlainSchema,
  F extends PlainSchema,
>(stub: CallsObject<Name>, call: ObjectCall<Name, I, S, F>, input: I["Type"]): Effect.fn.Return<S["Type"], F["Type"]> {
  const encoded = yield* Schema.encodeEffect(inputText(call.input))(input).pipe(Effect.orDie)
  const reply = yield* Effect.tryPromise(() => stub.call(call.name, encoded)).pipe(Effect.orDie)
  const exit = yield* Schema.decodeEffect(exitText(call.success, call.error))(reply).pipe(Effect.orDie)
  return yield* exit
})

/**
 * How an object serves `call`: decodes the input, runs `handler`, and encodes its exit, failure or
 * not, for the Worker.
 */
export const serve =
  <Name extends string, I extends PlainSchema, S extends PlainSchema, F extends PlainSchema, R>(
    call: ObjectCall<Name, I, S, F>,
    handler: (input: I["Type"]) => Effect.Effect<S["Type"], F["Type"], R>,
  ) =>
  (input: string): Effect.Effect<string, never, R> =>
    Schema.decodeEffect(inputText(call.input))(input).pipe(
      Effect.orDie,
      Effect.flatMap(handler),
      Effect.exit,
      Effect.flatMap(Schema.encodeEffect(exitText(call.success, call.error))),
      Effect.orDie,
    )
