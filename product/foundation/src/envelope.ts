import { Schema } from "effect"

import { Actor } from "./actor.ts"
import { FeatureKey } from "./feature-key.ts"
import { AccountId, EnvelopeId, InstallationId, PersonId, SessionId } from "./ids.ts"
import { namePattern, sourcePattern, sourceRule } from "./patterns.ts"
import { ReleaseVersion } from "./release-version.ts"
import { ComponentKey, EnvironmentKey, ProjectKey, WorkspaceKey } from "./scope-keys.ts"
import { TraceId } from "./trace-id.ts"

/** A kind of envelope a module adds, named `<module>.<kind>`: `uptime.check`. Up to 64 characters. */
export const ModuleKind = Schema.String.check(
  Schema.isMaxLength(64),
  Schema.isPattern(namePattern, {
    expected: "one of the kinds above, or a module's: two snake_case parts joined by a dot, such as uptime.check",
  }),
).pipe(Schema.brand("ModuleKind"))
export type ModuleKind = typeof ModuleKind.Type

/**
 * What an envelope holds:
 * - `event`: a product event an app tracks, such as `export.completed`.
 * - `request`: one unit of work in a service (an HTTP request, a queue message, a scheduled job),
 *   from its trace.
 * - `span`: one operation of a trace that is kept.
 * - `log`: one log record.
 * - `error`: one error, with what is known about where it happened.
 * - `activity`: a fact about a change to a record.
 * - `cost`: what a provider charged.
 * - `money`: a payment, a refund, or a fee.
 * - a module's own kind, such as `uptime.check`.
 */
export const EnvelopeKind = Schema.Union([
  Schema.Literals(["event", "request", "span", "log", "error", "activity", "cost", "money"]),
  ModuleKind,
])
export type EnvelopeKind = typeof EnvelopeKind.Type

/**
 * What happened, in the words of its kind: an event's or an activity's name (`export.completed`,
 * `release.published`), a request's route, a log's category. 1 to 256 characters, without control
 * characters or space at either end.
 */
export const EnvelopeName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isTrimmed(),
  Schema.isPattern(/^\P{Cc}*$/u, { expected: "text without control characters" }),
).pipe(Schema.brand("EnvelopeName"))
export type EnvelopeName = typeof EnvelopeName.Type

/**
 * Where the data comes from: `sdk-ios`, `otel`, `stripe`, `module:releases`. A key, optionally
 * followed by `:` and another key, up to 64 characters.
 */
export const Source = Schema.String.check(
  Schema.isMaxLength(64),
  Schema.isPattern(sourcePattern, { expected: sourceRule }),
).pipe(Schema.brand("Source"))
export type Source = typeof Source.Type

/**
 * The one shape of every signal and every activity entry: what happened, when, and where it belongs.
 *
 * Every envelope has a workspace, a source and a time, and a project unless it belongs to the
 * workspace itself. The other scope keys are present when they are known; an absent key is unknown,
 * never a guess. Fields are only ever added, and only as optional ones, because stored rows and
 * shipped SDK builds keep this shape for years.
 */
export class Envelope extends Schema.Class<Envelope>("Envelope")({
  id: EnvelopeId,
  /** When it happened. */
  ts: Schema.DateTimeUtcFromString,
  kind: EnvelopeKind,
  name: EnvelopeName,
  workspace: WorkspaceKey,
  /** Absent only for the workspace's own data. */
  project: Schema.optionalKey(ProjectKey),
  /** Where it ran: `notes-api`. */
  component: Schema.optionalKey(ComponentKey),
  /** The app that started it, from baggage: `notes-ios` for an API call the iOS app made. */
  originComponent: Schema.optionalKey(ComponentKey),
  /** The release of `originComponent` that started it: `2.4.0+312`. */
  originRelease: Schema.optionalKey(ReleaseVersion),
  environment: Schema.optionalKey(EnvironmentKey),
  /** The release of `component` that ran it. */
  release: Schema.optionalKey(ReleaseVersion),
  /** The feature that owns the code that ran: a key in code wins over a catalog rule. */
  feature: Schema.optionalKey(FeatureKey),
  /** The feature of the screen that started it, from baggage. */
  callerFeature: Schema.optionalKey(FeatureKey),
  person: Schema.optionalKey(PersonId),
  installation: Schema.optionalKey(InstallationId),
  account: Schema.optionalKey(AccountId),
  session: Schema.optionalKey(SessionId),
  trace: Schema.optionalKey(TraceId),
  /** Who made the change: on every activity entry, never on a signal. */
  actor: Schema.optionalKey(Actor),
  source: Source,
  /** The payload, in the shape its kind and name define. Never secrets. */
  attrs: Schema.JsonObject,
}) {}
