import { Schema } from "effect"

/**
 * The rule of every ID in Cluenori: a lowercase UUIDv7, so IDs sort by when they were made and
 * compare as text. A package brands it for each of its IDs: `Uuidv7.pipe(Schema.brand("FeatureId"))`.
 */
export const Uuidv7 = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, {
    expected: "a lowercase UUIDv7",
  }),
)

/**
 * An envelope's ID, unique in its workspace: what removes duplicates at ingest and in queries. It is
 * made where the data is first recorded, such as in an SDK, so a retry sends the same ID.
 */
export const EnvelopeId = Uuidv7.pipe(Schema.brand("EnvelopeId"))
export type EnvelopeId = typeof EnvelopeId.Type

/**
 * One end user in one project. Cluenori assigns it and keeps which user IDs and installations it
 * stands for in the project's database, so the person's data elsewhere points to no one once that
 * link is deleted. Never the app's own user ID.
 */
export const PersonId = Uuidv7.pipe(Schema.brand("PersonId"))
export type PersonId = typeof PersonId.Type

/** One app on one device. Cluenori assigns it, like a person's ID; never the device's own install ID. */
export const InstallationId = Uuidv7.pipe(Schema.brand("InstallationId"))
export type InstallationId = typeof InstallationId.Type

/** The group that pays, in a B2B app. Cluenori assigns it, like a person's ID. */
export const AccountId = Uuidv7.pipe(Schema.brand("AccountId"))
export type AccountId = typeof AccountId.Type

/** One visit or app session. The SDK makes it when the session starts. */
export const SessionId = Uuidv7.pipe(Schema.brand("SessionId"))
export type SessionId = typeof SessionId.Type

/** A member of the workspace: someone who uses Cluenori itself. */
export const MemberId = Uuidv7.pipe(Schema.brand("MemberId"))
export type MemberId = typeof MemberId.Type

/** One run of an agent. */
export const AgentRunId = Uuidv7.pipe(Schema.brand("AgentRunId"))
export type AgentRunId = typeof AgentRunId.Type
