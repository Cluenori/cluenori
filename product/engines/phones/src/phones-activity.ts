import { Schema } from "effect"

import { AppVersion, ModelIdentifier, PhoneId, SystemVersion } from "./phone.ts"

/** A phone paired with the deployment, for whoever started the pairing. */
export const PhonePaired = Schema.TaggedStruct("phone.paired", { phone: PhoneId, model: ModelIdentifier })

/** A phone's iOS or app version changed. */
export const PhoneUpdated = Schema.TaggedStruct("phone.updated", {
  phone: PhoneId,
  systemVersion: SystemVersion,
  appVersion: AppVersion,
})

/** A phone was removed: its key no longer works. */
export const PhoneRemoved = Schema.TaggedStruct("phone.removed", { phone: PhoneId })
