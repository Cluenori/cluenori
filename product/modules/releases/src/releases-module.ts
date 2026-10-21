import { defineModule, moduleQuery } from "@cluenori/foundation"
import { Schema } from "effect"

import { ReleaseDetail, ReleaseKey, ReleaseList, ReleaseListQuery, ReleaseNotFound } from "./release.ts"
import { ReleasesGroup } from "./releases-api.ts"
import { listReleases, releaseDetail } from "./releases.ts"

/** The module, as the host serves it: its queries run in the project's Durable Object. */
export const releasesModule = defineModule({
  id: "releases",
  scope: "project",
  queries: {
    /** The releases that ran in a period, each compared with the one before it. Reads only. */
    list: moduleQuery({ input: ReleaseListQuery, success: ReleaseList, error: Schema.Never, run: listReleases }),
    /** One release compared with the one before it. Fails with `ReleaseNotFound`. Reads only. */
    release: moduleQuery({ input: ReleaseKey, success: ReleaseDetail, error: ReleaseNotFound, run: releaseDetail }),
  },
  api: ReleasesGroup,
})
