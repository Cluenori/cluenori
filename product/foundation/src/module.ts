import type { Effect, Layer, Schema } from "effect"
import type { HttpApiGroup } from "effect/http-api"

import type { ComponentKey } from "./scope-keys.ts"

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

/**
 * A write a component's own tooling sends with the component's ingest key, as telemetry is sent, such
 * as a deploy its CI reports: its input, its answer, its tagged errors, and how it runs in the
 * project's Durable Object for the component the key belongs to.
 */
export interface ModuleIngest<
  I extends PlainSchema = PlainSchema,
  S extends PlainSchema = PlainSchema,
  F extends ErrorSchema = ErrorSchema,
  R = never,
> {
  readonly input: I
  readonly success: S
  readonly error: F
  run(component: ComponentKey, input: I["Type"]): Effect.Effect<S["Type"], F["Type"], R>
}

/** An ingest write, with its input's type, and so `run`'s, taken from its Schemas. */
export const moduleIngest = <I extends PlainSchema, S extends PlainSchema, F extends ErrorSchema, R>(
  ingest: ModuleIngest<I, S, F, R>,
): ModuleIngest<I, S, F, R> => ingest

/** A module's ingest writes, each under its name. */
export type ModuleIngests<Ingests> = Readonly<
  Record<keyof Ingests, ModuleIngest<PlainSchema, PlainSchema, ErrorSchema, unknown>>
>

/** A module's queries, each under its name, whatever engines they read. */
export type ModuleQueries<Queries> = Readonly<
  Record<keyof Queries, ModuleQuery<PlainSchema, PlainSchema, ErrorSchema, unknown>>
>

/**
 * What a module adds to Cluenori, from its one definition: its ID, what it is about, the questions
 * it answers and their routes in the public API, its own services, and its background work. The
 * host serves every query in the project's Durable Object under `<id>.<query>`, adds `api` to the
 * public API, translating each route to its query on a visible line, builds `layer` in each
 * project's object from the settings it reads, runs `background` on the project's alarm, and serves
 * `ingest` to components' own tooling. A
 * module's sidebar entry, actions and the rest of `concept/Foundation.md`'s module contract come with
 * the first module that needs each.
 */
export interface ModuleDefinition<
  Id extends string = string,
  Queries extends ModuleQueries<Queries> = ModuleQueries<Record<string, unknown>>,
  Api extends HttpApiGroup.Constraint = HttpApiGroup.Constraint,
  Settings = never,
  Services = never,
  Requirements = never,
  Background = unknown,
  Ingests extends ModuleIngests<Ingests> = ModuleIngests<Record<string, unknown>>,
> {
  /** Its key, as its folder and package are named: `releases`. */
  readonly id: Id
  /** What it is about: one project, answered inside the project's Durable Object. */
  readonly scope: "project"
  readonly queries: Queries
  /** Its routes, one for each query, which the host adds to the public API. */
  readonly api: Api
  /**
   * Its own services, built once in each project's Durable Object from `settings`, which the host
   * reads from the deployment's configuration: its records, whose tables it creates or updates
   * first, and its clients. Absent for a module that keeps nothing. Its queries and background work
   * may use them.
   */
  readonly layer?: (settings: Settings) => Layer.Layer<Services, never, Requirements>
  /**
   * What it does on its own, run on the project's alarm every minute: it keeps its own pace from
   * when it last did each thing, bounds each run, and logs its own failures. The next minute runs it
   * again whatever happened.
   */
  readonly background?: Effect.Effect<void, never, Background>
  /**
   * Its ingest writes, which the host serves at `POST /ingest/v1/<id>/<name>` with a component's
   * ingest key as a bearer token: JSON in, JSON out, not in the public API. `{}` for a module that
   * takes none.
   */
  readonly ingest: Ingests
}

/** Defines a module: the one value its package's contract exports for the host. */
export const defineModule = <
  const Id extends string,
  Queries extends ModuleQueries<Queries>,
  Api extends HttpApiGroup.Constraint,
  Settings = never,
  Services = never,
  Requirements = never,
  Background = never,
  Ingests extends ModuleIngests<Ingests> = ModuleIngests<Record<string, never>>,
>(
  definition: ModuleDefinition<Id, Queries, Api, Settings, Services, Requirements, Background, Ingests>,
): ModuleDefinition<Id, Queries, Api, Settings, Services, Requirements, Background, Ingests> => definition
