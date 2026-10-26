import { NotAllowed } from "@cluenori/foundation"
import { ProjectNotFound } from "@cluenori/projects"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { Feed, FeedEntries, FeedId, FeedInput, FeedList, FeedNotFound } from "./feed.ts"

/** The workspace's feeds, and a feed's entries: the public API's part for this engine. */
export class FeedsGroup extends HttpApiGroup.make("feeds")
  .add(
    HttpApiEndpoint.get("feeds", "/feeds", { success: FeedList }).annotate(
      OpenApi.Description,
      "The feeds the caller sees, by name: each with the sources of the projects they see, how many entries arrived in the last 24 hours and 7 days, the last 7 days' by project, and when the newest arrived. A feed whose projects the caller sees none of isn't listed.",
    ),
  )
  .add(
    HttpApiEndpoint.get("feed", "/feeds/:feed", {
      params: { feed: FeedId },
      query: { before: Schema.optionalKey(Schema.Int) },
      success: FeedEntries,
      error: FeedNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(
      OpenApi.Description,
      "One feed's entries of the projects the caller sees, newest first, 100 at a time; `before` continues from an earlier answer's `next`. Each entry is one event a project's app tracked in production: the project, the event, when, the component, environment and release, the country, and the app's own user ID when the app identified the person. Kept 90 days.",
    ),
  )
  .add(
    HttpApiEndpoint.post("createFeed", "/feeds", {
      payload: FeedInput,
      success: Feed.pipe(HttpApiSchema.status(201)),
      error: [NotAllowed.pipe(HttpApiSchema.status(403)), ProjectNotFound.pipe(HttpApiSchema.status(404))],
    }).annotate(
      OpenApi.Description,
      "Makes a feed, for an owner: its name, its alert level (none, quiet, timeSensitive), and 1 to 50 sources, each a project and the event its apps track there, such as `user.registered`. From then on, each such event a project's app sends in production becomes an entry. A source in a project the deployment doesn't have answers 404; anyone but an owner, 403.",
    ),
  )
  .add(
    HttpApiEndpoint.put("saveFeed", "/feeds/:feed", {
      params: { feed: FeedId },
      payload: FeedInput,
      success: Feed,
      error: [
        FeedNotFound.pipe(HttpApiSchema.status(404)),
        ProjectNotFound.pipe(HttpApiSchema.status(404)),
        NotAllowed.pipe(HttpApiSchema.status(403)),
      ],
    }).annotate(
      OpenApi.Description,
      "Changes a feed, for an owner: its name, level and sources, in place of those before. Its entries stay. Saving the same again is safe. A source in a project the deployment doesn't have answers 404; anyone but an owner, 403.",
    ),
  )
  .add(
    HttpApiEndpoint.delete("removeFeed", "/feeds/:feed", {
      params: { feed: FeedId },
      success: HttpApiSchema.NoContent,
      error: [FeedNotFound.pipe(HttpApiSchema.status(404)), NotAllowed.pipe(HttpApiSchema.status(403))],
    }).annotate(
      OpenApi.Description,
      "Deletes a feed and its entries, for an owner; the events stay in the projects' analytics. Anyone else answers 403.",
    ),
  ) {}
