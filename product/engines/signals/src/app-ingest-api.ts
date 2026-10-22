import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { AppBatch, AppBatchAccepted, TooManySignals } from "./app-batch.ts"

/**
 * Where apps' SDKs send what they recorded. Served at `/ingest/v1/app/batch` with the component's SDK
 * key as a bearer token, which the host checks before the batch is read.
 */
export class AppIngestGroup extends HttpApiGroup.make("appIngest").add(
  HttpApiEndpoint.post("sendBatch", "/ingest/v1/app/batch", {
    payload: AppBatch,
    success: AppBatchAccepted,
    error: TooManySignals.pipe(HttpApiSchema.status(429)),
  }).annotate(
    OpenApi.Description,
    "Records a batch of an app's signals: sessions, launches, memory, screens, events, and MetricKit's reports, from one installation of one release. A signal sent before, by its ID, is counted once, so a batch may be sent again after a failure. The country is read from the request's address, which isn't kept. 401 for an SDK key the deployment doesn't know or revoked: stop sending. 429 when the key or the installation sent too much lately: keep the batch and send it after `retryAfterSeconds`. 413 for a body over 1 MB: send fewer signals at once. 503 when Cluenori couldn't keep the batch: nothing of it was counted; send it again after `Retry-After`.",
  ),
) {}
