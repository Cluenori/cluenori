import { Schema } from "effect"

/**
 * App Store Connect refused the request, and sending the same again won't help until what `reason`
 * names changes. 401 or 403: the key is wrong or revoked, or its role doesn't allow this (writing
 * needs App Manager). 409: Apple won't take the change in the current state, such as a build still
 * processing, a text over its limit, or a version that isn't pending release; or this client won't
 * make it, such as pausing a version without a phased release. 0, with nothing sent: the key can't
 * sign. `reason` is Apple's error code and detail, or says what was refused.
 */
export class AppStoreConnectRefused extends Schema.TaggedError<AppStoreConnectRefused>()("AppStoreConnectRefused", {
  status: Schema.Int,
  reason: Schema.String,
}) {}

/**
 * App Store Connect didn't answer now: nothing within 15 seconds, too many requests (429, the
 * key's hourly limit), or a server error. Asking again later may work; a write may have been made
 * all the same, and every method is safe to call again.
 */
export class AppStoreConnectUnavailable extends Schema.TaggedError<AppStoreConnectUnavailable>()(
  "AppStoreConnectUnavailable",
  { reason: Schema.String },
) {}
