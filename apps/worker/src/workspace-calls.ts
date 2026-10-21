import { Actor, Envelope } from "@cluenori/foundation"
import { NoPushToken, PushNotSetUp, PushRejected, PushUnavailable } from "@cluenori/notifications"
import {
  Caller,
  PairedPhone,
  Pairing,
  PairingCodeRejected,
  PairPhone,
  PhoneId,
  PhoneKey,
  PhoneKeyRejected,
  PhoneList,
  PhoneNotFound,
  RegisterPush,
} from "@cluenori/phones"
import { Project, ProjectList } from "@cluenori/projects"
import { Schema } from "effect"

import type { ObjectCall, PlainSchema } from "./object-calls.ts"
import { objectCall } from "./object-calls.ts"

export type WorkspaceCallName =
  | "recordProject"
  | "projects"
  | "phones"
  | "startPairing"
  | "pair"
  | "authenticatePhone"
  | "removePhone"
  | "registerPush"
  | "notify"
  | "testAlert"

/** One thing the Worker asks the workspace's Durable Object: its input, its answer, and how it fails. */
export type WorkspaceCall<I extends PlainSchema, S extends PlainSchema, F extends PlainSchema> = ObjectCall<
  WorkspaceCallName,
  I,
  S,
  F
>

const workspaceCall = <I extends PlainSchema, S extends PlainSchema, F extends PlainSchema>(
  name: WorkspaceCallName,
  input: I,
  success: S,
  error: F,
): WorkspaceCall<I, S, F> => objectCall(name, input, success, error)

/** What the Worker asks the workspace's Durable Object, one entry per call. */
export const workspaceCalls = {
  recordProject: workspaceCall("recordProject", Project, Schema.Void, Schema.Never),
  projects: workspaceCall("projects", Schema.Void, ProjectList, Schema.Never),
  phones: workspaceCall("phones", Schema.Void, PhoneList, Schema.Never),
  startPairing: workspaceCall(
    "startPairing",
    Schema.Struct({ actor: Actor, deployment: Schema.String }),
    Pairing,
    Schema.Never,
  ),
  // The phone's new key crosses to the Worker only in the answer, and then to the phone.
  pair: workspaceCall("pair", Schema.Struct({ phone: PairPhone, caller: Caller }), PairedPhone, PairingCodeRejected),
  authenticatePhone: workspaceCall(
    "authenticatePhone",
    Schema.Struct({ key: PhoneKey, caller: Caller }),
    Actor,
    PhoneKeyRejected,
  ),
  removePhone: workspaceCall(
    "removePhone",
    Schema.Struct({ actor: Actor, phone: PhoneId }),
    Schema.Void,
    PhoneNotFound,
  ),
  registerPush: workspaceCall(
    "registerPush",
    Schema.Struct({ key: PhoneKey, caller: Caller, push: RegisterPush }),
    Schema.Void,
    PhoneKeyRejected,
  ),
  notify: workspaceCall("notify", Schema.Array(Envelope), Schema.Void, PushUnavailable),
  testAlert: workspaceCall(
    "testAlert",
    Schema.Struct({ phone: PhoneId }),
    Schema.Void,
    Schema.Union([PushNotSetUp, NoPushToken, PushRejected, PushUnavailable]),
  ),
}
