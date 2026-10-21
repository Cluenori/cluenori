import { PhoneId } from "@cluenori/phones"
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import { NoPushToken, PushNotSetUp, PushRejected, PushUnavailable } from "./alert.ts"

/** Alerts on phones: the public API's part for this engine. */
export class NotificationsGroup extends HttpApiGroup.make("notifications").add(
  HttpApiEndpoint.post("testAlert", "/phones/:phone/test-alert", {
    params: { phone: PhoneId },
    success: HttpApiSchema.NoContent,
    error: [
      PushNotSetUp.pipe(HttpApiSchema.status(409)),
      NoPushToken.pipe(HttpApiSchema.status(409)),
      PushRejected.pipe(HttpApiSchema.status(502)),
      PushUnavailable.pipe(HttpApiSchema.status(503)),
    ],
  }).annotate(
    OpenApi.Description,
    "Rings a phone with a test alarm, as a project that is down would, and answers 204 once APNs took it. 409 when push isn't set up or the phone has no push token yet; 502 with Apple's reason when APNs refused it, such as for a wrong key; 503 when APNs didn't answer.",
  ),
) {}
