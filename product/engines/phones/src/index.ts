/**
 * The phones paired with a deployment: pairing one by a link shown as a QR code, the key each calls
 * the API with, when and where each last called, and removing one. Runs in the workspace's Durable
 * Object.
 */
export {
  AppVersion,
  Caller,
  isPhoneKey,
  LastSeen,
  ModelIdentifier,
  PairedPhone,
  Pairing,
  PairingCode,
  PairingCodeRejected,
  PairPhone,
  Phone,
  PhoneDetails,
  PhoneId,
  PhoneKey,
  PhoneKeyRejected,
  PhoneList,
  PhoneNotFound,
  SystemVersion,
} from "./phone.ts"
export { PhonePaired, PhoneRemoved, PhoneUpdated } from "./phones-activity.ts"
export { PairingGroup, PhonesGroup } from "./phones-api.ts"
export { Phones } from "./phones.ts"
