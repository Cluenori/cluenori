import { Repository, WorkflowFile } from "@bagatka/github"
import { ComponentKey, EnvironmentKey, Instant } from "@cluenori/foundation"
import { Schema } from "effect"

/** What people call a component: 1 to 100 characters, without space at either end. */
export const ComponentName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(100),
  Schema.isTrimmed(),
).pipe(Schema.brand("ComponentName"))
export type ComponentName = typeof ComponentName.Type

/** An app's bundle ID, as Apple's stores know it, such as `com.example.notes`. */
export const BundleId = Schema.String.check(
  Schema.isMaxLength(155),
  Schema.isPattern(/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, {
    expected: "letters, digits and hyphens in parts joined by dots, such as com.example.notes",
  }),
).pipe(Schema.brand("BundleId"))
export type BundleId = typeof BundleId.Type

/**
 * How far an App Store Connect app's builds go in an environment: TestFlight only, or on to App Store
 * review and the App Store.
 */
export const AppStoreDistribution = Schema.Literals(["testFlight", "appStore"]).annotate({
  identifier: "AppStoreDistribution",
})
export type AppStoreDistribution = typeof AppStoreDistribution.Type

/** The App Store Connect app an environment's builds go to, by its bundle ID, and how far. */
export const AppStoreTarget = Schema.Struct({ bundleId: BundleId, distribution: AppStoreDistribution }).annotate({
  identifier: "AppStoreTarget",
})
export type AppStoreTarget = typeof AppStoreTarget.Type

/**
 * Where a component's releases go in one environment, and how they get there:
 * - `workflow`: the GitHub Actions workflow in its repository that builds a release's commit and
 *   deploys or uploads it there, started with the inputs `release`, `environment`, `commit` and
 *   `runner`;
 * - `appStore`: for an app, the App Store Connect app its builds go to there.
 * At least one of them.
 */
export const DeployTarget = Schema.Struct({
  environment: EnvironmentKey,
  workflow: Schema.optionalKey(WorkflowFile),
  appStore: Schema.optionalKey(AppStoreTarget),
})
  .check(
    Schema.makeFilter(
      (target: { readonly workflow?: unknown; readonly appStore?: unknown }) =>
        target.workflow !== undefined || target.appStore !== undefined,
      { expected: "a workflow, an App Store app, or both" },
    ),
  )
  .annotate({ identifier: "DeployTarget" })
export type DeployTarget = typeof DeployTarget.Type

/** A component's deploy targets: at most 20, one for each environment. */
const DeployTargets = Schema.Array(DeployTarget).check(
  Schema.isMaxLength(20),
  Schema.makeFilter(
    (targets: ReadonlyArray<DeployTarget>) => new Set(targets.map((each) => each.environment)).size === targets.length,
    { expected: "one deploy target for each environment" },
  ),
)

/**
 * Where a component's releases come from beside its telemetry, and where they go: its repository on
 * GitHub, whose commits they are, and its deploy target in each environment; or, for a part deployed
 * with another component, by its deploy targets, that component. Each absent until linked.
 */
export const ComponentLinks = Schema.Struct({
  repository: Schema.optionalKey(Repository),
  deployTargets: Schema.optionalKey(DeployTargets),
  /**
   * The component whose deploys deploy this one too, from the same commit with the same release,
   * such as a background service built and deployed by the API's workflow; another of the project's.
   */
  shipsWith: Schema.optionalKey(ComponentKey),
}).annotate({ identifier: "ComponentLinks" })
export type ComponentLinks = typeof ComponentLinks.Type

/** A part of a project that ships separately, such as `notes-api`. Its key is permanent. */
export class Component extends Schema.Class<Component>("Component")({
  key: ComponentKey,
  name: ComponentName,
  createdAt: Instant,
  ...ComponentLinks.fields,
}) {}

export const AddComponent = Schema.Struct({ key: ComponentKey, name: ComponentName }).annotate({
  identifier: "AddComponent",
})
export type AddComponent = typeof AddComponent.Type

/** The project has no component with this key. */
export class ComponentNotFound extends Schema.TaggedError<ComponentNotFound>()("ComponentNotFound", {
  component: ComponentKey,
}) {}

/** The project already has a component with this key. */
export class ComponentExists extends Schema.TaggedError<ComponentExists>()("ComponentExists", {
  component: ComponentKey,
}) {}
