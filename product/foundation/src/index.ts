/**
 * The product model every engine and module shares: the scope keys that place every record, the
 * envelope every signal and activity entry uses, who acts, the one way to change records, which
 * commits each write with its activity, and the contract a module is defined by.
 */
export { ActivityLog } from "./activity-log.ts"
export type { ActivityLogSettings, Change } from "./activity-log.ts"
export { ActivityName } from "./activity.ts"
export type { ActivityEntry, ActivityPayload } from "./activity.ts"
export { Actor, NotAllowed, ProcessName } from "./actor.ts"
export { Caller } from "./caller.ts"
export { Envelope, EnvelopeKind, EnvelopeName, ModuleKind, Source } from "./envelope.ts"
export { FeatureKey } from "./feature-key.ts"
export { Instant } from "./instant.ts"
export { AccountId, AgentRunId, EnvelopeId, InstallationId, MemberId, PersonId, SessionId, Uuidv7 } from "./ids.ts"
export { defineModule, moduleIngest, moduleQuery } from "./module.ts"
export type {
  ErrorSchema,
  ModuleDefinition,
  ModuleIngest,
  ModuleIngests,
  ModuleQueries,
  ModuleQuery,
  PlainSchema,
} from "./module.ts"
export { Period } from "./period.ts"
export { ReleaseVersion } from "./release-version.ts"
export { ComponentKey, EnvironmentKey, ProjectKey, WorkspaceKey } from "./scope-keys.ts"
export { TraceId } from "./trace-id.ts"
