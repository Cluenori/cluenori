import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"

import {
  Pairing,
  PairedPhone,
  PairingCodeRejected,
  PairPhone,
  PhoneId,
  PhoneKeyRejected,
  PhoneList,
  PhoneNotFound,
  RegisterPush,
} from "./phone.ts"

/** The phones paired with the deployment, and pairing another: the public API's part for this engine. */
export class PhonesGroup extends HttpApiGroup.make("phones")
  .add(
    HttpApiEndpoint.get("phones", "/phones", { success: PhoneList }).annotate(
      OpenApi.Description,
      "The phones paired with the deployment, the latest paired first, each with its model, iOS and app versions, and when, from which address and country, it last called.",
    ),
  )
  .add(
    HttpApiEndpoint.post("startPairing", "/phones/pairings", {
      success: Pairing.pipe(HttpApiSchema.status(201)),
    }).annotate(
      OpenApi.Description,
      "Starts pairing a phone for whoever calls: the link a phone opens to pair, shown as a QR code, `cluenori://pair?url=<deployment>&code=<pairing code>`, good once for 10 minutes. At most 5 are good at once; another drops the oldest.",
    ),
  )
  .add(
    HttpApiEndpoint.delete("removePhone", "/phones/:phone", {
      params: { phone: PhoneId },
      success: HttpApiSchema.NoContent,
      error: PhoneNotFound.pipe(HttpApiSchema.status(404)),
    }).annotate(OpenApi.Description, "Removes a phone: its key stops working at once."),
  ) {}

/** A phone pairing itself, with the code it was shown: the one call that needs no credential. */
export class PairingGroup extends HttpApiGroup.make("pairing").add(
  HttpApiEndpoint.post("pair", "/phones", {
    payload: PairPhone,
    success: PairedPhone.pipe(HttpApiSchema.status(201)),
    error: PairingCodeRejected.pipe(HttpApiSchema.status(403)),
  }).annotate(
    OpenApi.Description,
    "Pairs a phone with a code from a pairing link, and answers with its key, shown only this once: the phone calls the API with it as its bearer token, acting for whoever started the pairing, and sends `User-Agent: Cluenori/<app version> iOS/<iOS version>` so the deployment keeps its versions. A code that is wrong, used, or expired answers 403.",
  ),
) {}

/**
 * A phone registering where pushes reach it. It calls with its own key as its bearer token, which the
 * call checks itself: no other credential registers a phone's push token.
 */
export class PhonePushGroup extends HttpApiGroup.make("phonePush").add(
  HttpApiEndpoint.put("registerPush", "/phones/push", {
    payload: RegisterPush,
    success: HttpApiSchema.NoContent,
    error: PhoneKeyRejected.pipe(HttpApiSchema.status(401)),
  }).annotate(
    OpenApi.Description,
    "Keeps the push token of the phone whose key is the bearer token, and the APNs environment it belongs to, in place of any before: the phone calls it each time iOS gives the app a token. Any other credential, or a removed phone's key, answers 401.",
  ),
) {}
