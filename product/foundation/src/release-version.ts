import { Schema } from "effect"

/**
 * The version that names a release within its component, as the component reports it: `2.4.0+312`
 * is version 2.4.0, build 312. Letters, digits, `.`, `_`, `+` and `-`, starting with a letter or a
 * digit, up to 64 characters. Compared as text; an order between versions is a rule of whoever
 * needs one.
 */
export const ReleaseVersion = Schema.String.check(
  Schema.isMaxLength(64),
  Schema.isPattern(/^[0-9A-Za-z][0-9A-Za-z._+-]*$/, {
    expected: "letters, digits, '.', '_', '+' and '-', starting with a letter or a digit, such as 2.4.0+312",
  }),
).pipe(Schema.brand("ReleaseVersion"))
export type ReleaseVersion = typeof ReleaseVersion.Type
