import type { Effect, Schema } from "effect"
import type { HttpApiGroup } from "effect/http-api"

/**
 * A Schema that needs no services to encode or decode, as a module query's input, answer and
 * failures must: they cross into the project's Durable Object and back as JSON.
 */
export type PlainSchema = Schema.Top & { readonly DecodingServices: never; readonly EncodingServices: never }

/** The failures of a module query: tagged errors, as every failure a caller acts on is (PATTERNS.md, "Errors"). */
export type ErrorSchema = PlainSchema & { readonly Type: { readonly _tag: string } }

/**
 * One question a module answers: its input, its answer, the failures a caller can act on, and how
 * it is answered, inside the project's Durable Object, with the engines there (`R`).
 */
export interface ModuleQuery<
  I extends PlainSchema = PlainSchema,
  S extends PlainSchema = PlainSchema,
  F extends ErrorSchema = ErrorSchema,
  R = never,
> {
  readonly input: I
  readonly success: S
  readonly error: F
  run(input: I["Type"]): Effect.Effect<S["Type"], F["Type"], R>
}

/** A query, with its input's type, and so `run`'s, taken from its Schemas. */
export const moduleQuery = <I extends PlainSchema, S extends PlainSchema, F extends ErrorSchema, R>(
  query: ModuleQuery<I, S, F, R>,
): ModuleQuery<I, S, F, R> => query

/** A module's queries, each under its name, whatever engines they read. */
export type ModuleQueries<Queries> = Readonly<
  Record<keyof Queries, ModuleQuery<PlainSchema, PlainSchema, ErrorSchema, unknown>>
>

/**
 * What a module adds to Cluenori, from its one definition: its ID, what it is about, the questions
 * it answers, and their routes in the public API. The host serves every query in the project's
 * Durable Object under `<id>.<query>`, and adds `api` to the public API, translating each route to
 * its query on a visible line. A module's sidebar entry, actions, records and the rest of
 * `concept/Foundation.md`'s module contract come with the first module that needs each.
 */
export interface ModuleDefinition<
  Id extends string = string,
  Queries extends ModuleQueries<Queries> = ModuleQueries<Record<string, unknown>>,
  Api extends HttpApiGroup.Constraint = HttpApiGroup.Constraint,
> {
  /** Its key, as its folder and package are named: `releases`. */
  readonly id: Id
  /** What it is about: one project, answered inside the project's Durable Object. */
  readonly scope: "project"
  readonly queries: Queries
  /** Its routes, one for each query, which the host adds to the public API. */
  readonly api: Api
}

/** Defines a module: the one value its package's contract exports for the host. */
export const defineModule = <
  const Id extends string,
  Queries extends ModuleQueries<Queries>,
  Api extends HttpApiGroup.Constraint,
>(
  definition: ModuleDefinition<Id, Queries, Api>,
): ModuleDefinition<Id, Queries, Api> => definition
