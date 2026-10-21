import { Instant, Uuidv7 } from "@cluenori/foundation"
import { Schema } from "effect"

/** A phone's ID. */
export const PhoneId = Uuidv7.pipe(Schema.brand("PhoneId"))
export type PhoneId = typeof PhoneId.Type

/**
 * A phone's key, which the API takes in place of the API token: `cluenori.phone.<phone ID>.<secret>`,
 * the secret 43 characters of base64url. Shown once, when the phone pairs; Cluenori keeps only its
 * SHA-256 digest.
 */
export const PhoneKey = Schema.String.check(
  Schema.isPattern(
    /^cluenori\.phone\.[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[\w-]{43}$/,
    {
      expected: "a phone's key: cluenori.phone.<phone ID>.<secret>",
    },
  ),
).pipe(Schema.brand("PhoneKey"))
export type PhoneKey = typeof PhoneKey.Type

/** Whether a bearer token is meant as a phone's key, by its prefix, before it is checked. */
export const isPhoneKey = (token: string) => token.startsWith("cluenori.phone.")

/** A pairing code: 43 characters of base64url, good once, for 10 minutes. */
export const PairingCode = Schema.String.check(
  Schema.isPattern(/^[\w-]{43}$/, { expected: "a pairing code of 43 letters, digits, - and _" }),
).pipe(Schema.brand("PairingCode"))
export type PairingCode = typeof PairingCode.Type

/** The model a phone reports, by Apple's identifier: `iPhone19,3`. */
export const ModelIdentifier = Schema.String.check(
  Schema.isPattern(/^[A-Za-z]{2,20}\d{1,3},\d{1,3}$/, { expected: "an Apple model identifier, such as iPhone19,3" }),
).pipe(Schema.brand("ModelIdentifier"))
export type ModelIdentifier = typeof ModelIdentifier.Type

/** An iOS version: `27.1`, `27.0.1`. */
export const SystemVersion = Schema.String.check(
  Schema.isPattern(/^\d{1,3}(\.\d{1,3}){1,2}$/, { expected: "an iOS version, such as 27.1" }),
).pipe(Schema.brand("SystemVersion"))
export type SystemVersion = typeof SystemVersion.Type

/** The app's version and build: `1.0 (12)`. 1 to 32 characters, starting with a digit. */
export const AppVersion = Schema.String.check(
  Schema.isPattern(/^\d[\w .()+-]{0,31}$/, { expected: "an app version, such as 1.0 (12)" }),
).pipe(Schema.brand("AppVersion"))
export type AppVersion = typeof AppVersion.Type

/** What a phone says about itself: its model, and its iOS and app versions. */
export const PhoneDetails = Schema.Struct({
  model: ModelIdentifier,
  systemVersion: SystemVersion,
  appVersion: AppVersion,
})
export type PhoneDetails = typeof PhoneDetails.Type

/**
 * Where a call came from: the caller's IP address and the country Cloudflare places it in, when
 * known, and its `User-Agent`, in which the app says its own and its iOS version:
 * `Cluenori/1.0 (12) iOS/27.1`.
 */
export const Caller = Schema.Struct({
  address: Schema.optionalKey(Schema.String),
  country: Schema.optionalKey(Schema.String),
  userAgent: Schema.optionalKey(Schema.String),
})
export type Caller = typeof Caller.Type

/** When a phone last called the API, from which address, and in which country. */
export const LastSeen = Schema.Struct({
  at: Instant,
  /** Absent when the call came without one, as it can outside Cloudflare. */
  address: Schema.optionalKey(Schema.String),
  /** Two letters, as Cloudflare places the address; absent when it couldn't. */
  country: Schema.optionalKey(Schema.String),
}).annotate({ identifier: "LastSeen" })
export type LastSeen = typeof LastSeen.Type

/** A phone paired with the deployment, which calls the API with its own key, for whoever paired it. */
export class Phone extends Schema.Class<Phone>("Phone")({
  id: PhoneId,
  model: ModelIdentifier,
  /** What people call its model, `iPhone 18 Pro Max`; its identifier for a model Cluenori doesn't know. */
  modelName: Schema.String,
  systemVersion: SystemVersion,
  appVersion: AppVersion,
  pairedAt: Instant,
  /** Absent until its first call after pairing. */
  lastSeen: Schema.optionalKey(LastSeen),
}) {}

/** The phones paired with the deployment, the latest paired first. */
export const PhoneList = Schema.Struct({ phones: Schema.Array(Phone) }).annotate({ identifier: "PhoneList" })
export type PhoneList = typeof PhoneList.Type

/**
 * A pairing started on the web: the link a phone opens to pair, shown as a QR code, good once until
 * `expiresAt`. The link is `cluenori://pair?url=<the deployment>&code=<pairing code>`; the phone pairs
 * by sending the code to `<the deployment>/api/phones`.
 */
export const Pairing = Schema.Struct({ link: Schema.String, expiresAt: Instant }).annotate({ identifier: "Pairing" })
export type Pairing = typeof Pairing.Type

/** What a phone sends to pair: the code it was shown, and what it says about itself. */
export const PairPhone = Schema.Struct({ code: PairingCode, ...PhoneDetails.fields }).annotate({
  identifier: "PairPhone",
})
export type PairPhone = typeof PairPhone.Type

/** A phone just paired, with its key: the only time the key is shown. */
export const PairedPhone = Schema.Struct({ phone: Phone, key: PhoneKey }).annotate({ identifier: "PairedPhone" })
export type PairedPhone = typeof PairedPhone.Type

/** The token APNs gave the app on one phone, as lowercase hex: 64 characters today, up to 200. */
export const PushToken = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64,200}$/, { expected: "a push token: 64 to 200 lowercase hex digits" }),
).pipe(Schema.brand("PushToken"))
export type PushToken = typeof PushToken.Type

/**
 * Which APNs a push token belongs to: `development` for a build Xcode installs, `production` for one
 * from TestFlight.
 */
export const PushEnvironment = Schema.Literals(["development", "production"]).annotate({
  identifier: "PushEnvironment",
})
export type PushEnvironment = typeof PushEnvironment.Type

/** What a phone sends so pushes reach it: the token iOS gave the app, and its environment. */
export const RegisterPush = Schema.Struct({ token: PushToken, environment: PushEnvironment }).annotate({
  identifier: "RegisterPush",
})
export type RegisterPush = typeof RegisterPush.Type

/** A phone pushes reach, by the token it last registered. */
export const PushTarget = Schema.Struct({ phone: PhoneId, token: PushToken, environment: PushEnvironment })
export type PushTarget = typeof PushTarget.Type

/** The pairing code is wrong, already used, or older than 10 minutes: show a new one on the web. */
export class PairingCodeRejected extends Schema.TaggedError<PairingCodeRejected>()("PairingCodeRejected", {}) {}

/** The key isn't a paired phone's: the phone was removed, or the key is wrong. */
export class PhoneKeyRejected extends Schema.TaggedError<PhoneKeyRejected>()("PhoneKeyRejected", {}) {}

/** The deployment has no phone with this ID. */
export class PhoneNotFound extends Schema.TaggedError<PhoneNotFound>()("PhoneNotFound", { phone: PhoneId }) {}
