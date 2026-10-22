import { ComponentKey, EnvironmentKey, Instant, ProjectKey, ReleaseVersion } from "@cluenori/foundation"
import { ProjectNotFound } from "@cluenori/projects"
import { DateTime, Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { DraftUnavailable, NotesDraft, NotesStyle, ReleaseNotes } from "./note.ts"
import {
  AppStoreSubmission,
  Promotion,
  PromotionId,
  PromotionInProgress,
  PromotionNotFound,
  PromotionReason,
  PromotionRefused,
  PromotionUnavailable,
  Runner,
} from "./promotion.ts"
import { ReleaseDetail, ReleaseList, ReleaseNotFound } from "./release.ts"
import { BuildNumber, ComponentVersion, ComponentVersions, SemanticVersion, VersionRefused } from "./version.ts"

/** The filters of a list of releases, as query parameters: `from` and `to` are ISO 8601 UTC. */
export const ReleaseFilters = Schema.Struct({
  from: Instant,
  to: Instant,
  environment: Schema.optionalKey(EnvironmentKey),
  component: Schema.optionalKey(ComponentKey),
}).check(
  Schema.makeFilter(
    (query: { readonly from: DateTime.Utc; readonly to: DateTime.Utc }) => DateTime.isLessThan(query.from, query.to),
    { expected: "a period whose from is before its to" },
  ),
)

/** A project's releases, each compared with the one before it: the public API's part for this module. */
export class ReleasesGroup extends HttpApiGroup.make("releases")
  .add(
    HttpApiEndpoint.get("releases", "/projects/:project/releases", {
      params: { project: ProjectKey },
      query: ReleaseFilters,
      success: ReleaseList,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "The releases whose operations ran in a period, the latest first seen first, at most 30: each component's versions as it reports them in `service.version`, from the first minute each ran to the last, with a verdict against the release before it of the same component and environment. Worse when an operation got slower (a p95 at least 1.5 times and 100 ms more) or fails more (at least 5 failures, 2%, and three times the rate before), or an error was first seen in it; too early until it ran an hour and an operation ran 100 times in both. Operations are counted by release from October 2026.",
    ),
  )
  .add(
    HttpApiEndpoint.get("release", "/projects/:project/releases/:component/:release", {
      params: { project: ProjectKey, component: ComponentKey, release: ReleaseVersion },
      query: { environment: Schema.optionalKey(EnvironmentKey) },
      success: ReleaseDetail,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), ReleaseNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "One release compared with the one before it, in `environment`, or without it the environment it last ran in: the operations that got slower, fail more, got faster, or fail less, each the biggest change first; the operations new in it; the errors first seen in it; the incidents that opened while it ran, of those the project keeps; its promotions; and the environments it can be promoted to, its component's deploy workflows.",
    ),
  )
  .add(
    HttpApiEndpoint.post("promote", "/projects/:project/releases/:component/:release/promotions", {
      params: { project: ProjectKey, component: ComponentKey, release: ReleaseVersion },
      payload: Schema.Struct({
        environment: EnvironmentKey,
        reason: Schema.optionalKey(PromotionReason),
        runner: Schema.optionalKey(Runner),
        submission: Schema.optionalKey(AppStoreSubmission),
      }).annotate({ identifier: "PromoteTo" }),
      success: Promotion.pipe(HttpApiSchema.status(201)),
      error: [
        ProjectNotFound.pipe(HttpApiSchema.status(404)),
        ReleaseNotFound.pipe(HttpApiSchema.status(404)),
        PromotionInProgress.pipe(HttpApiSchema.status(409)),
        PromotionRefused.pipe(HttpApiSchema.status(422)),
        PromotionUnavailable.pipe(HttpApiSchema.status(503)),
      ],
    }).annotate(
      OpenApi.Description,
      "Promotes a release to an environment, for the member who asks, by its component's deploy target there: starts its workflow on the repository's default branch with the inputs `release`, `environment`, `commit` (when known) and `runner` (`auto` unless given), as the workspace's GitHub App; and, when the target has an App Store Connect app, follows its build there once processed: for TestFlight, sets What to Test from the release's notes; for the App Store, submits it for review with its notes as What's New, as `submission` says (as soon as approved, phased, unless given). Cluenori follows it each minute until it ends, and records who started it and why. 409 while the component's last promotion to that environment hasn't ended; 422 when it can't start until someone fixes what `reason` says, where `fix` says; 503 when GitHub didn't answer. Each call that succeeds starts a run.",
    ),
  )
  .add(
    HttpApiEndpoint.post("releaseApproved", "/projects/:project/promotions/:promotion/release", {
      params: { project: ProjectKey, promotion: PromotionId },
      success: Promotion,
      error: [
        ProjectNotFound.pipe(HttpApiSchema.status(404)),
        PromotionNotFound.pipe(HttpApiSchema.status(404)),
        PromotionRefused.pipe(HttpApiSchema.status(422)),
        PromotionUnavailable.pipe(HttpApiSchema.status(503)),
      ],
    }).annotate(
      OpenApi.Description,
      "Releases a promotion that App Store review approved and that waits for a member, submitted to be released manually: App Store Connect makes it live, and the promotion ends once it is. 404 for no promotion of that ID waiting so.",
    ),
  )
  .add(
    HttpApiEndpoint.get("versions", "/projects/:project/versions", {
      params: { project: ProjectKey },
      success: ComponentVersions,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "Each component's version, `MAJOR.MINOR.PATCH`, which its next builds are numbered in, and the last build number given: a commit built for the first time becomes `<version>+<last + 1>`, for good. A component whose version was never set isn't listed; its CI can't number builds until it is.",
    ),
  )
  .add(
    HttpApiEndpoint.put("setVersion", "/projects/:project/versions/:component", {
      params: { project: ProjectKey, component: ComponentKey },
      payload: Schema.Struct({ version: SemanticVersion, firstBuild: Schema.optionalKey(BuildNumber) }).annotate({
        identifier: "VersionTo",
      }),
      success: ComponentVersion,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), VersionRefused.pipe(HttpApiSchema.status(422))],
    }).annotate(
      OpenApi.Description,
      "Sets a component's version, such as a bump of its patch, minor or major: the same or higher than now. Its build numbers continue, or from `firstBuild`, above the last given. 422 for a lower version, a first build at or below the last, or a component the project lacks.",
    ),
  )
  .add(
    HttpApiEndpoint.put("saveNotes", "/projects/:project/releases/:component/:release/notes", {
      params: { project: ProjectKey, component: ComponentKey, release: ReleaseVersion },
      payload: Schema.Struct({ notes: ReleaseNotes }).annotate({ identifier: "NotesOf" }),
      success: ReleaseNotes,
      error: [ProjectNotFound.pipe(HttpApiSchema.status(404)), ReleaseNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "Replaces a release's notes for its users, one for each language, up to 4000 characters each: its What's New when it goes to the App Store, and What to Test in TestFlight.",
    ),
  )
  .add(
    HttpApiEndpoint.post("draftNotes", "/projects/:project/releases/:component/:release/notes/draft", {
      params: { project: ProjectKey, component: ComponentKey, release: ReleaseVersion },
      payload: Schema.Struct({ environment: EnvironmentKey }).annotate({ identifier: "DraftFor" }),
      success: NotesDraft,
      error: [
        ProjectNotFound.pipe(HttpApiSchema.status(404)),
        ReleaseNotFound.pipe(HttpApiSchema.status(404)),
        DraftUnavailable.pipe(HttpApiSchema.status(503)),
      ],
    }).annotate(
      OpenApi.Description,
      "Drafts a release's notes for where it goes: written by the project's language model from the commits since the release current in `environment` (on the App Store, the live one), in the project's notes style, with its last notes as examples; one for each language of the app the environment's builds go to, or English. Saves nothing: edit the draft and save it. 503 when its commits aren't known, or GitHub or the model don't answer.",
    ),
  )
  .add(
    HttpApiEndpoint.get("notesStyle", "/projects/:project/notes-style", {
      params: { project: ProjectKey },
      success: NotesStyle,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "How the project's release notes read, in its own words, which drafts follow: the project's, or Cluenori's default until it sets one.",
    ),
  )
  .add(
    HttpApiEndpoint.put("setNotesStyle", "/projects/:project/notes-style", {
      params: { project: ProjectKey },
      payload: NotesStyle,
      success: NotesStyle,
      error: ProjectNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(OpenApi.Description, "Sets how the project's release notes read, up to 2000 characters."),
  ) {}
