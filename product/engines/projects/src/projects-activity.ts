import { ComponentKey, EnvironmentKey, Instant, ProjectKey } from "@cluenori/foundation"
import { Repository } from "@cluenori/github"
import { Schema } from "effect"

import { BundleId, ComponentName, DeployTarget } from "./component.ts"
import { IngestKeyId, IngestKeyName } from "./issued-ingest-key.ts"
import { ProjectName } from "./project.ts"
import { SdkKey } from "./sdk-key.ts"

/** A project was created. */
export const ProjectCreated = Schema.TaggedStruct("project.created", { project: ProjectKey, name: ProjectName })

/** A component was added to a project, with its ingest key. */
export const ComponentAdded = Schema.TaggedStruct("component.added", { component: ComponentKey, name: ComponentName })

/**
 * A component's links changed: its repository and deploy targets, each absent when unlinked.
 * `appStoreBundleId` is only in entries from before deploy targets, which hold it now.
 */
export const ComponentLinked = Schema.TaggedStruct("component.linked", {
  component: ComponentKey,
  repository: Schema.optionalKey(Repository),
  appStoreBundleId: Schema.optionalKey(BundleId),
  deployTargets: Schema.optionalKey(Schema.Array(DeployTarget)),
  shipsWith: Schema.optionalKey(ComponentKey),
})

/** The project's settings changed: the environments it calls production. */
export const ProjectSettingsChanged = Schema.TaggedStruct("project.settings_changed", {
  productionEnvironments: Schema.Array(EnvironmentKey),
})

/** A component got a new SDK key, which its app's builds can carry; its other keys stay active. */
export const SdkKeyIssued = Schema.TaggedStruct("sdk_key.issued", { component: ComponentKey, key: SdkKey })

/** A component's SDK key was revoked: builds that carry it are refused from then on. */
export const SdkKeyRevoked = Schema.TaggedStruct("sdk_key.revoked", { component: ComponentKey, key: SdkKey })

/** A component got a new ingest key; its other keys keep working. Never the key itself. */
export const IngestKeyAdded = Schema.TaggedStruct("ingest_key.added", {
  component: ComponentKey,
  key: IngestKeyId,
  name: IngestKeyName,
  expiresAt: Schema.optionalKey(Instant),
})

/** A component's ingest key was revoked: it stops working `at`, now or later. */
export const IngestKeyRevoked = Schema.TaggedStruct("ingest_key.revoked", {
  component: ComponentKey,
  key: IngestKeyId,
  name: IngestKeyName,
  at: Instant,
})

/**
 * A component's ingest key expires soon, at `expiresAt`: said a week before and again a day before,
 * each once, so a key can be added and deployed in time; not for a key revoked before it would
 * expire. Owners' phones are told (`@cluenori/notifications`).
 */
export const IngestKeyExpiring = Schema.TaggedStruct("ingest_key.expiring", {
  component: ComponentKey,
  key: IngestKeyId,
  name: IngestKeyName,
  expiresAt: Instant,
})
