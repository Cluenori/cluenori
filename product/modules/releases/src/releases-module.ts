import { defineModule, moduleIngest, moduleQuery } from "@cluenori/foundation"
import { Layer, Schema } from "effect"

import { ReleaseRecords } from "./records.ts"
import {
  LastReport,
  LastReportQuery,
  ReleaseDetail,
  ReleaseKey,
  ReleaseList,
  ReleaseListQuery,
  ReleaseNotFound,
  ReleaseReport,
} from "./release.ts"
import { ReleasesGroup } from "./releases-api.ts"
import { listReleases, releaseDetail } from "./releases.ts"
import { lastDeploy, reportDeploy } from "./report.ts"
import type { ReleasesSettings } from "./sources.ts"
import { ReleaseSources } from "./sources.ts"
import { syncReleases } from "./sync.ts"

/**
 * The module's own services in a project's Durable Object: its records, on the project's database,
 * and its clients for GitHub and App Store Connect, from the settings the host reads.
 */
export const releasesLayer = (settings: ReleasesSettings) =>
  Layer.mergeAll(ReleaseRecords.layer, ReleaseSources.layer(settings))

/**
 * The module, as the host serves it: its queries and ingest writes run in the project's Durable
 * Object, its records and clients are built there from its settings, and its background work
 * finds commits and store builds on the project's alarm.
 */
export const releasesModule = defineModule({
  id: "releases",
  scope: "project",
  queries: {
    /** The releases of a period, each compared with the one before it. Reads only. */
    list: moduleQuery({ input: ReleaseListQuery, success: ReleaseList, error: Schema.Never, run: listReleases }),
    /** One release compared with the one before it. Fails with `ReleaseNotFound`. Reads only. */
    release: moduleQuery({ input: ReleaseKey, success: ReleaseDetail, error: ReleaseNotFound, run: releaseDetail }),
  },
  api: ReleasesGroup,
  layer: releasesLayer,
  background: syncReleases,
  ingest: {
    /** A deploy, from `cluenori-release`. */
    report: moduleIngest({ input: ReleaseReport, success: Schema.Void, error: Schema.Never, run: reportDeploy }),
    /** The last deploy reported, which the next report's commits start after. */
    last: moduleIngest({ input: LastReportQuery, success: LastReport, error: Schema.Never, run: lastDeploy }),
  },
})
